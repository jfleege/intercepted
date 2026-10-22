"""Fixed research configurations, time-separated calibration and untouched-year tests."""
import math
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_absolute_error, brier_score_loss, log_loss
from src.ml.projection_features import SCORE_FEATURES, PLAYER_FEATURES

REGRESSION_CONFIG = dict(max_iter=140, learning_rate=.06, max_leaf_nodes=15, min_samples_leaf=35, l2_regularization=10, random_state=42)


def matrix(rows, columns):
    values = np.array([[r['x'][k] for k in columns] for r in rows], dtype=float)
    if not np.isfinite(values).all():
        raise ValueError('Nonfinite pregame features')
    return values


def radius(errors, coverage=.8):
    errors = np.asarray(errors)
    if not len(errors):
        raise ValueError('Calibration sample is empty')
    level = min(1, math.ceil((len(errors) + 1) * coverage) / len(errors))
    return float(np.quantile(errors, level, method='higher'))


def fit_regression(train, calibration, columns, target):
    model = HistGradientBoostingRegressor(**REGRESSION_CONFIG).fit(matrix(train, columns), [r[target] for r in train])
    pred = np.maximum(0, model.predict(matrix(calibration, columns)))
    width = radius(np.abs(pred - np.array([r[target] for r in calibration])))
    return {'model': model, 'columns': columns, 'radius': width, 'target': target}


def predict_regression(fitted, rows):
    return np.maximum(0, fitted['model'].predict(matrix(rows, fitted['columns'])))


def regression_metrics(fitted, rows):
    pred = predict_regression(fitted, rows)
    y = np.array([r[fitted['target']] for r in rows])
    baseline = np.array([r['baseline'] for r in rows])
    mae, base = float(mean_absolute_error(y, pred)), float(mean_absolute_error(y, baseline))
    return {'samples': len(rows), 'mae': round(mae, 3), 'baseline_mae': round(base, 3), 'beats_baseline': mae < base,
            'interval_80_coverage': round(float(np.mean(np.abs(y - pred) <= fitted['radius'])), 4), 'interval_radius': round(fitted['radius'], 2)}


def paired_scores(rows, predictions):
    pairs = {}
    for row, p in zip(rows, predictions):
        pairs.setdefault(row['game_id'], {})[row['side']] = (float(p), row['y'], row['baseline'])
    complete = [p for p in pairs.values() if set(p) == {'home', 'away'}]
    return {kind: np.array([[p['home'][i] - p['away'][i], p['home'][i] + p['away'][i]] for p in complete]) for i, kind in enumerate(['prediction', 'actual', 'baseline'])}


def score_intervals(fitted, calibration):
    pairs = paired_scores(calibration, predict_regression(fitted, calibration))
    return {key: radius(np.abs(pairs['prediction'][:, i] - pairs['actual'][:, i])) for i, key in enumerate(['margin', 'total'])}


def scoring_metrics(fitted, calibration, test):
    result = regression_metrics(fitted, test)
    widths = score_intervals(fitted, calibration)
    pairs = paired_scores(test, predict_regression(fitted, test))
    result['games'] = len(pairs['actual'])
    for i, kind in enumerate(['margin', 'total']):
        error = np.abs(pairs['prediction'][:, i] - pairs['actual'][:, i])
        baseline_error = np.abs(pairs['baseline'][:, i] - pairs['actual'][:, i])
        result[kind] = {'mae': round(float(error.mean()), 3), 'baseline_mae': round(float(baseline_error.mean()), 3),
                        'beats_baseline': float(error.mean()) < float(baseline_error.mean()),
                        'interval_80_coverage': round(float(np.mean(error <= widths[kind])), 4)}
    return result


def logits(probabilities):
    p = np.clip(probabilities, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p)).reshape(-1, 1)


def fit_event(train, calibration, target):
    model = make_pipeline(StandardScaler(), LogisticRegression(C=.1, max_iter=1000, random_state=42))
    model.fit(matrix(train, PLAYER_FEATURES), [r[target] for r in train])
    y = np.array([r[target] for r in calibration])
    if len(set(y)) < 2:
        raise ValueError('Both event classes required for chronological calibration')
    calibration_model = LogisticRegression(C=1, max_iter=1000, random_state=42)
    calibration_model.fit(logits(model.predict_proba(matrix(calibration, PLAYER_FEATURES))[:, 1]), y)
    return {'model': model, 'calibrator': calibration_model, 'columns': PLAYER_FEATURES, 'target': target}


def predict_event(fitted, rows):
    raw = fitted['model'].predict_proba(matrix(rows, fitted['columns']))[:, 1]
    return fitted['calibrator'].predict_proba(logits(raw))[:, 1]


def event_metrics(fitted, rows):
    y = np.array([r[fitted['target']] for r in rows])
    p = predict_event(fitted, rows)
    baseline_key = 'season_any_td' if fitted['target'] == 'any_td' else 'season_pass_td'
    baseline = np.array([r['x'][baseline_key] for r in rows])
    brier, base = float(brier_score_loss(y, p)), float(brier_score_loss(y, baseline))
    bins = []
    for low in np.arange(0, 1, .1):
        mask = (p >= low) & (p < low + .1)
        if mask.any():
            bins.append({'range': [round(float(low), 1), round(float(low + .1), 1)], 'samples': int(mask.sum()),
                         'mean_probability': round(float(p[mask].mean()), 4), 'observed_rate': round(float(y[mask].mean()), 4)})
    return {'samples': len(rows), 'events': int(y.sum()), 'brier': round(brier, 4), 'baseline_brier': round(base, 4),
            'log_loss': round(float(log_loss(y, p, labels=[0, 1])), 4), 'baseline_log_loss': round(float(log_loss(y, baseline, labels=[0, 1])), 4),
            'beats_baseline': brier < base, 'reliability': bins}


def benchmark(scoring, players):
    split = lambda rows, year: [r for r in rows if r['season'] == year]
    train_score, calibration_score, test_score = [r for r in scoring if r['season'] <= 2023], split(scoring, 2024), split(scoring, 2025)
    score = fit_regression(train_score, calibration_score, SCORE_FEATURES, 'y')
    report = {'policy': 'Fixed configurations; fit 2018–2023, calibrate 2024, test 2025. Test-year features use only earlier games. This is a retrospective development benchmark, not a prospective live record.',
              'scoring': scoring_metrics(score, calibration_score, test_score), 'yardage': {}, 'touchdowns': {}}
    for kind in ['passing', 'rushing', 'receiving']:
        rows = [r for r in players if r['kind'] == kind]
        train, calibration, test = [r for r in rows if r['season'] <= 2023], split(rows, 2024), split(rows, 2025)
        fitted = fit_regression(train, calibration, PLAYER_FEATURES, 'yards')
        report['yardage'][kind] = regression_metrics(fitted, test)
    for target in ['any_td', 'pass_td']:
        rows = [r for r in players if target == 'any_td' or r['position'] == 'QB']
        fitted = fit_event([r for r in rows if r['season'] <= 2023], split(rows, 2024), target)
        report['touchdowns'][target] = event_metrics(fitted, split(rows, 2025))
    return report


def production_split(rows, season, minimum=40, event=None):
    calibration = [r for r in rows if r['season'] == season]
    if len(calibration) < minimum or (event and len({r[event] for r in calibration}) < 2):
        calibration = [r for r in rows if r['season'] == season - 1]
    calibration_year = calibration[0]['season'] if calibration else None
    train = [r for r in rows if calibration_year is not None and r['season'] < calibration_year]
    if not train or len(calibration) < minimum:
        raise ValueError('Insufficient chronological training/calibration data')
    return train, calibration


def lineage(train, calibration):
    return {'training_samples': len(train), 'calibration_samples': len(calibration),
            'training_cutoff': list(max((r['season'], r['week']) for r in train)),
            'calibration_cutoff': list(max((r['season'], r['week']) for r in calibration))}
