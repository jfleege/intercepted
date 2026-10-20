"""Advance a completed regular-season slate with fresh inputs and frozen model weights."""
import argparse
import json
import math
import subprocess
import sys
import warnings

from src.ml.refresh_performance import ROOT, MODELS, ALIASES, archive, git, kickoff, normalize_result, stamp, utcnow, write_json


from src.features.qb_starters import load_reports, resolve_qb, changed_report_games, merge_revisions
from src.ml.model_registry import available_models, model_metadata
from src.features.model_context import context_features


class DataPending(Exception):
    """Upstream statistics have not caught up; retain the published slate."""


def target_slate(rows, now):
    today = stamp(now)
    season = today.year if today.month >= 3 else today.year - 1
    regular = [r for r in rows if r['season'] == season and r.get('game_type') == 'REG']
    for week in sorted({int(r['week']) for r in regular}):
        games = [r for r in regular if int(r['week']) == week]
        if any(normalize_result(r, now)['status'] not in ('final', 'cancelled') for r in games):
            return season, week, games
    return season, None, []


def check_coverage(rows, weekly, expanded, ngs, season, week, now):
    """Require every expected historical team-game, not merely a latest-week maximum."""
    expected = set()
    for row in rows:
        if row.get('game_type') != 'REG' or not (row['season'] == season - 1 or (row['season'] == season and row['week'] < week)):
            continue
        result = normalize_result(row, now)
        if result['status'] == 'cancelled':
            continue
        if result['status'] != 'final':
            raise DataPending(f"Prior game not final: {row['game_id']}")
        for side in ('home', 'away'):
            expected.add((row['game_id'], ALIASES.get(row[f'{side}_team'], row[f'{side}_team'])))
    for label, table in [('team', weekly), ('expanded', expanded)]:
        actual = [(x['game_id'], ALIASES.get(x['team'], x['team'])) for x in table.to_dicts()
                  if x['season'] == season - 1 or (x['season'] == season and x['week'] < week)]
        if len(actual) != len(set(actual)) or set(actual) != expected:
            raise DataPending(f"{label} coverage incomplete: {len(set(actual) & expected)}/{len(expected)} team-games")
    # NGS does not include a schedule game ID. Check a primary passer for every team-week.
    expected_qb = {(r['season'], r['week'], ALIASES.get(r[f'{side}_team'], r[f'{side}_team']))
                   for r in rows for side in ('home', 'away')
                   if r.get('game_type') == 'REG' and r['season'] == season and r['week'] < week
                   and normalize_result(r, now)['status'] == 'final'}
    actual_qb = {(r['season'], r['week'], ALIASES.get(r['team_abbr'], r['team_abbr']))
                 for r in ngs.to_dicts() if r.get('attempts', 0) > 0 and r.get('player_gsis_id')}
    if not expected_qb.issubset(actual_qb):
        raise DataPending(f"QB statistics missing {len(expected_qb - actual_qb)} completed team-weeks")


def generate(rows, games, season, week, now):
    import joblib
    import numpy as np
    import polars as pl
    import nflreadpy as nfl
    from sklearn.exceptions import InconsistentVersionWarning
    from src.features.upcoming_features import prepare_team_features, build_qb_snapshots, TEAM_EFFICIENCY, QB_METRICS

    metadata = json.loads((ROOT / 'models/model_metadata.json').read_text())
    models = available_models(metadata)
    if any((model_metadata(metadata, m)['latest_training_season'], model_metadata(metadata, m)['latest_training_week']) >= (season, week) for m in models):
        raise ValueError('Model training cutoff must precede the target week')
    if any(stamp(model_metadata(metadata, m)['created_at_utc']) > stamp(now) for m in models):
        raise ValueError('Model creation time is in the future')
    # Existing aggregators preserve the trained feature definitions; only two seasons need PBP.
    years = [season - 1, season] if week > 1 else [season - 1]
    for module in ('src.data.weekly_stats', 'src.features.expanded_team_stats'):
        subprocess.run([sys.executable, '-m', module, '--seasons', *map(str, years)], cwd=ROOT, check=True)
    data = ROOT / 'data/processed'
    weekly = pl.concat([pl.read_parquet(data / f'weekly_team_stats_{y}.parquet') for y in years])
    expanded = pl.concat([pl.read_parquet(data / f'expanded_team_stats_{y}.parquet') for y in years])
    weekly = weekly.with_columns(pl.col("team").replace(ALIASES))
    expanded = expanded.with_columns(pl.col("team").replace(ALIASES))
    ngs = nfl.load_nextgen_stats(seasons=list(range(2019, season + (1 if week > 1 else 0))), stat_type='passing')
    if 'season_type' in ngs.columns:
        ngs = ngs.filter(pl.col('season_type').is_in(['REG', 'REGULAR']))
    ngs = ngs.filter(pl.col('week').is_between(1, 18)).with_columns(pl.col('team_abbr').replace(ALIASES))
    check_coverage(rows, weekly, expanded, ngs, season, week, now)
    previous = weekly.filter(pl.col('season') == season - 1)
    teams = sorted({ALIASES.get(g[f'{side}_team'], g[f'{side}_team']) for g in games for side in ('home', 'away')})
    preseason = []
    for team in teams:
        record = {'team': team, 'target_season': season}
        team_rows = previous.filter(pl.col('team') == team)
        for kind in ('off', 'def'):
            total, plays = f'{kind}_total_epa', f'{kind}_plays'
            league = float(previous[total].sum() / previous[plays].sum())
            rate = float(team_rows[total].sum() / team_rows[plays].sum())
            record[f'preseason_{kind}_epa'] = league + .65 * (rate - league)
        preseason.append(record)
    priors = pl.DataFrame(preseason)
    ratings = {team: prepare_team_features(team, season, week, weekly, expanded, priors) for team in teams}
    histories = build_qb_snapshots(ngs, season, week)
    reports = load_reports()
    ngs_rows = ngs.to_dicts()
    now = utcnow()  # Data downloads may cross kickoff; use the actual serving clock.
    records, matrices = [], {model: [] for model in models}
    for game in games:
        start = kickoff(game)
        if not start or stamp(start) <= stamp(now):
            continue
        h, a = (ALIASES.get(game[f'{s}_team'], game[f'{s}_team']) for s in ('home', 'away'))
        record = dict(game_id=game['game_id'], season=season, week=week, game_date=str(game['gameday'])[:10], home_team=h, away_team=a)
        features = {f'diff_{key}': ratings[h][key] - ratings[a][key] for key in ('blended_off_epa', 'blended_def_epa', *TEAM_EFFICIENCY)}
        features.update(context_features(game, rows))
        qb_features = {}
        for side, team in [('home', h), ('away', a)]:
            qb = resolve_qb(game, team, ngs_rows, reports, now)
            history = histories.get(qb['player_id'])
            record[f'{side}_projected_qb_name'] = qb['name']
            record[f'{side}_projected_qb_id'] = qb['player_id']
            record[f'{side}_qb_selection'] = qb
            record[f'{side}_team_latest_week'] = ratings[team]['team_latest_week']
            features[f'{side}_qb_projection_missing'] = float(qb['player_id'] is None)
            qb_features[side] = history or {}
        for metric in QB_METRICS:
            for prefix in ('career', 'recent'):
                key = f'qb_{prefix}_{metric}'
                features[f'diff_{key}'] = qb_features['home'].get(key, np.nan) - qb_features['away'].get(key, np.nan)
        features['qb_experience_diff'] = np.log1p(qb_features['home'].get('qb_career_attempts', np.nan)) - np.log1p(qb_features['away'].get('qb_career_attempts', np.nan))
        for model in models:
            matrices[model].append([features[col] for col in metadata['models'][model]['features']])
        records.append(record)
    if not records:
        raise DataPending('No games with future, confirmed kickoff times')
    for model in models:
        matrix = np.array(matrices[model], dtype=float)
        if np.isinf(matrix).any() or (model == 'v4_a' and not np.isfinite(matrix).all()):
            raise ValueError('Invalid feature values')
        with warnings.catch_warnings():
            warnings.simplefilter('error', InconsistentVersionWarning)
            pipeline = joblib.load(ROOT / 'models' / metadata['models'][model]['file'])
        classes = list(pipeline.named_steps['classifier'].classes_)
        probs = pipeline.predict_proba(matrix)[:, classes.index(1)]
        for record, p in zip(records, probs):
            if not math.isfinite(p) or not 0 <= p <= 1:
                raise ValueError('Invalid model probability')
            record[f'home_win_prob_{model}'] = float(p)
            record[f'away_win_prob_{model}'] = float(1 - p)
    for r in records:
        primary = 'v5_qb_plus' if 'v5_qb_plus' in models else 'v4_qb_plus'
        p = r[f'home_win_prob_{primary}']
        r.update(qb_probability_impact=p - r['home_win_prob_v4_a'], predicted_winner=r['home_team'] if p >= .5 else r['away_team'], predicted_winner_probability=max(p, 1-p))
    now = utcnow()
    starts = {g['game_id']: kickoff(g) for g in games}
    records = [r for r in records if stamp(starts[r['game_id']]) > stamp(now)]
    if not records:
        raise DataPending('All remaining games reached kickoff during processing')
    print(f'Features through Week {week - 1}; saved weights trained through {metadata["latest_training_season"]} Week {metadata["latest_training_week"]}.')
    return {'season': season, 'week': week, 'count': len(records), 'model': 'v5_qb_plus' if 'v5_qb_plus' in models else 'v4_qb_plus', 'models': list(models), 'generated_at': now,
            'features_through_week': week - 1, 'training_cutoff': [metadata['latest_training_season'], metadata['latest_training_week']],
            'qb_projection_method': 'Game-specific sourced reports; otherwise unconfirmed prior-week passer', 'games': records}, metadata


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--validate-current', action='store_true', help='Rebuild current inputs without changing predictions or archives')
    args = parser.parse_args()
    import nflreadpy as nfl
    now = utcnow()
    year = stamp(now).year if stamp(now).month >= 3 else stamp(now).year - 1
    rows = nfl.load_schedules([year - 1, year]).to_dicts()
    season, week, games = target_slate(rows, now)
    current = json.loads((ROOT / 'frontend/public/predictions.json').read_text())
    revisions = changed_report_games(current, rows, load_reports(), now)
    configured = available_models(json.loads((ROOT / 'models/model_metadata.json').read_text()))
    upgrade = (current['season'], current['week']) == (season, week) and any(
        f'home_win_prob_{m}' not in g for g in current['games'] for m in configured)
    if upgrade:
        revisions = [g for g in games if kickoff(g) and stamp(kickoff(g)) > stamp(now)]
    is_revision = (current['season'], current['week']) == (season, week) and bool(revisions)
    if week is None or (not args.validate_current and not is_revision and (current['season'], current['week']) >= (season, week)):
        print('Published slate and starter reports are current; no forecast changes.')
        return
    if is_revision:
        games = revisions
    try:
        payload, metadata = generate(rows, games, season, week, now)
    except DataPending as error:
        print(f'::warning::Weekly forecasts waiting for data: {error}. Existing predictions retained.')
        return
    if args.validate_current:
        print(f"Validated {payload['count']} future games for {season} Week {week}; no forecasts published.")
        return
    if is_revision:
        # Preserve the old full slate before publishing a new, timestamped revision.
        archive(current, metadata, now, {'kind': 'before_starter_revision', 'commit': git('rev-parse', 'HEAD')},
                model_hashes={name: git('hash-object', f'models/{name}.joblib') for name in available_models(metadata)})
        payload = merge_revisions(current, payload, rows, utcnow())
    archive(payload, metadata, payload['generated_at'], {'kind': 'weekly_automation', 'commit': git('rev-parse', 'HEAD')},
            model_hashes={name: git('hash-object', f'models/{name}.joblib') for name in available_models(metadata)})
    write_json(ROOT / 'frontend/public/predictions.json', payload)
    print(f"Published {payload['count']} forecasts for {season} Week {week}.")


if __name__ == '__main__':
    main()
