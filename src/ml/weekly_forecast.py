"""Advance a completed regular-season slate with fresh inputs and frozen model weights."""
import argparse
import json
import math
import subprocess
import sys
import warnings

from src.ml.refresh_performance import ROOT, MODELS, ALIASES, archive, git, kickoff, normalize_result, stamp, utcnow, write_json


from src.features.qb_starters import load_reports, resolve_qb, changed_report_games, merge_revisions
from src.features.roster_transactions import load_transactions, game_transactions, changed_transaction_games
from src.ml.model_registry import available_models, model_metadata
from src.features.model_context import context_features
from src.ml.refresh_status import forecast_check
from src.features.qb_coverage import missing_ngs_weeks, low_volume_exclusions, coverage_message, coverage_metadata


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


def check_coverage(rows, weekly, expanded, ngs, season, week, now, boxscores=None):
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
    missing = missing_ngs_weeks(rows, ngs.to_dicts(), season, week, now)
    if not missing:
        return []
    labels = ', '.join(f'{team} {year} Week {prior_week}' for year, prior_week, team in missing)
    if boxscores is None:
        raise DataPending(f'QB statistics missing: {labels}')
    try:
        return low_volume_exclusions(missing, rows, ngs.to_dicts(), *boxscores, season, week, now)
    except ValueError as error:
        raise DataPending(f'QB statistics missing: {labels}. {error}') from error


def generate(rows, games, season, week, now, contexts=()):
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
    boxscores = None
    if missing_ngs_weeks(rows, ngs.to_dicts(), season, week, now):
        try:
            boxscores = (nfl.load_player_stats([season]).to_dicts(), nfl.load_team_stats([season]).to_dicts())
        except Exception as error:
            raise DataPending('Cannot reconcile missing NGS with completed-game box scores') from error
    coverage_exclusions = check_coverage(rows, weekly, expanded, ngs, season, week, now, boxscores)
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
    for exclusion in coverage_exclusions:
        snapshot = histories.get(exclusion['player_id'])
        if not snapshot or not all(math.isfinite(value) for value in snapshot.values()):
            raise DataPending(f"{exclusion['team']}: identified QB does not have usable saved NGS features")
        print(f"::notice::Qualified NGS omission: {exclusion['team']} Week {exclusion['week']}, {exclusion['name']} ({exclusion['attempts']} attempts).")
    reports = load_reports()
    transactions = load_transactions()
    ngs_rows = ngs.to_dicts()
    now = utcnow()  # Data downloads may cross kickoff; use the actual serving clock.
    records, matrices = [], {model: [] for model in models}
    scenario_inputs = []
    from src.features.injury_updates import game_evidence, backup_candidates, replace_qb_features
    for game in games:
        start = kickoff(game)
        if not start or stamp(start) <= stamp(now):
            continue
        h, a = (ALIASES.get(game[f'{s}_team'], game[f'{s}_team']) for s in ('home', 'away'))
        record = dict(game_id=game['game_id'], season=season, week=week, game_date=str(game['gameday'])[:10], home_team=h, away_team=a)
        record['roster_changes'] = game_transactions(game, transactions, now)
        features = {f'diff_{key}': ratings[h][key] - ratings[a][key] for key in ('blended_off_epa', 'blended_def_epa', *TEAM_EFFICIENCY)}
        features.update(context_features(game, rows))
        qb_features = {}
        for side, team in [('home', h), ('away', a)]:
            qb = resolve_qb(game, team, ngs_rows, reports, now, coverage_exclusions, transactions)
            history = histories.get(qb['player_id'])
            record[f'{side}_projected_qb_name'] = qb['name']
            record[f'{side}_projected_qb_id'] = qb['player_id']
            record[f'{side}_qb_selection'] = qb
            record[f'{side}_team_latest_week'] = ratings[team]['team_latest_week']
            features[f'{side}_qb_projection_missing'] = float(not history)
            qb_features[side] = history or {}
        features = replace_qb_features(features, qb_features['home'], qb_features['away'], QB_METRICS)
        record['availability_watch'] = game_evidence(game, contexts, now)
        record['availability_checked_at'] = now
        record['qb_scenarios'] = []
        for side in ('home', 'away'):
            for candidate in backup_candidates(record | {'gameday': game['gameday'], 'gametime': game['gametime']}, side, record['availability_watch'], contexts, now):
                history = histories.get(candidate['player_id'])
                if not history or not all(math.isfinite(v) for v in history.values()):
                    record['qb_scenarios'].append({'team': candidate['team'], 'name': candidate['name'], 'player_id': candidate['player_id'], 'status': 'insufficient_history'})
                    continue
                alternate = {**qb_features, side: history}
                inputs = replace_qb_features(features, alternate['home'], alternate['away'], QB_METRICS)
                scenario = {'team': candidate['team'], 'name': candidate['name'], 'player_id': candidate['player_id'],
                            'status': 'conditional', 'source': candidate['starter']['source'],
                            'observed_at': candidate['starter']['updated_at'], 'generated_at': now,
                            'assumption': candidate.get('assumption', 'If this depth-chart reserve starts; not a starter announcement or an availability probability.')}
                record['qb_scenarios'].append(scenario)
                scenario_inputs.append((scenario, inputs))
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
        for scenario, inputs in scenario_inputs:
            values = np.array([[inputs[col] for col in metadata['models'][model]['features']]], dtype=float)
            p = float(pipeline.predict_proba(values)[0, classes.index(1)])
            if not math.isfinite(p) or not 0 <= p <= 1:
                raise ValueError('Invalid scenario probability')
            scenario[f'home_win_prob_{model}'] = p
    for r in records:
        primary = 'v5_qb_plus' if 'v5_qb_plus' in models else 'v4_qb_plus'
        p = r[f'home_win_prob_{primary}']
        r.update(qb_probability_impact=p - r['home_win_prob_v4_a'], predicted_winner=r['home_team'] if p >= .5 else r['away_team'], predicted_winner_probability=max(p, 1-p))
    now = utcnow()
    starts = {g['game_id']: kickoff(g) for g in games}
    records = [r for r in records if stamp(starts[r['game_id']]) > stamp(now)]
    if not records:
        raise DataPending('All remaining games reached kickoff during processing')
    print(f"Features through Week {week - 1}; training cutoffs: " + str({m: (model_metadata(metadata, m)['latest_training_season'], model_metadata(metadata, m)['latest_training_week']) for m in models}))
    return {'season': season, 'week': week, 'count': len(records), 'model': 'v5_qb_plus' if 'v5_qb_plus' in models else 'v4_qb_plus', 'models': list(models), 'generated_at': now,
            'features_through_week': week - 1, 'training_cutoff': [model_metadata(metadata, 'v5_qb_plus' if 'v5_qb_plus' in models else 'v4_qb_plus')['latest_training_season'], model_metadata(metadata, 'v5_qb_plus' if 'v5_qb_plus' in models else 'v4_qb_plus')['latest_training_week']],
            'qb_projection_method': 'Game-specific sourced reports; otherwise an unconfirmed prior-game passer with reconciled low-volume exclusions',
            'qb_coverage': coverage_metadata(records, coverage_exclusions), 'games': records}, metadata


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--validate-current', action='store_true', help='Rebuild current inputs without changing predictions or archives')
    parser.add_argument('--revisions-only', action='store_true', help='Check changes to the published slate only')
    args = parser.parse_args()
    import nflreadpy as nfl
    now = utcnow()
    year = stamp(now).year if stamp(now).month >= 3 else stamp(now).year - 1
    rows = nfl.load_schedules([year - 1, year]).to_dicts()
    season, week, games = target_slate(rows, now)
    current = json.loads((ROOT / 'frontend/public/predictions.json').read_text())
    starter_revisions = changed_report_games(current, rows, load_reports(), now)
    roster_revisions = changed_transaction_games(current, games, load_transactions(), now)
    revisions = list(starter_revisions)
    revisions.extend(game for game in roster_revisions if game not in revisions)
    from src.features.injury_updates import availability_revision_games, backup_candidates, game_evidence
    insight_path = ROOT / 'frontend/public/forecast_insights.json'
    insights = json.loads(insight_path.read_text()) if insight_path.exists() else {}
    contexts = insights.get('players', []) if (insights.get('season'), insights.get('week')) == (season, week) else []
    for game in availability_revision_games(current, games, contexts, insights.get('sources', {}), now):
        if game not in revisions:
            revisions.append(game)
    configured = available_models(json.loads((ROOT / 'models/model_metadata.json').read_text()))
    upgrade = (current['season'], current['week']) == (season, week) and any(
        f'home_win_prob_{m}' not in g for g in current['games'] for m in configured)
    if upgrade and not args.revisions_only:
        revisions = [g for g in games if kickoff(g) and stamp(kickoff(g)) > stamp(now)]
    is_revision = (current['season'], current['week']) == (season, week) and bool(revisions)
    if args.revisions_only and not is_revision:
        print('No supported revisions to the published slate.')
        return
    if week is None or (not args.validate_current and not is_revision and (current['season'], current['week']) >= (season, week)):
        if not args.validate_current:
            remaining = sum(normalize_result(g, now)['status'] not in ('final', 'cancelled') for g in games)
            state = 'season_complete' if week is None else 'waiting_games' if remaining else 'current'
            message = ('Regular-season slate complete.' if week is None else
                       f'{remaining} game(s) still awaiting final results in Week {week}.' if remaining else
                       'Published forecast slate is current.')
            if week is not None and current.get('qb_coverage', {}).get('limited_inputs'):
                state, message = 'current_limited_qb', coverage_message(current)
            forecast_check(current, season, week, state, message, now)
        print('Published slate and starter reports are current; no forecast changes.')
        return
    if is_revision:
        games = revisions
    pending_error = None
    context_updates = []
    if args.revisions_only and not args.validate_current:
        previous = {game['game_id']: game for game in current['games']}
        model_games = []
        for game in games:
            old = previous[game['game_id']]
            evidence = game_evidence(game, contexts, now)
            candidates = {c['player_id'] for side in ('home', 'away')
                          for c in backup_candidates(old, side, evidence, contexts, now)}
            scenarios = old.get('qb_scenarios', [])
            saved_ids = {scenario.get('player_id') for scenario in scenarios}
            if game in starter_revisions or game in roster_revisions or candidates - saved_ids:
                model_games.append(game)
            else:
                context_updates.append({
                    **old,
                    'availability_watch': evidence,
                    'availability_checked_at': now,
                    'qb_scenarios': [scenario for scenario in scenarios if scenario.get('player_id') in candidates],
                })
        games = model_games
    try:
        if games or not context_updates:
            payload, metadata = generate(rows, games, season, week, now, contexts)
            payload['games'].extend(context_updates)
        else:
            metadata = json.loads((ROOT / 'models/model_metadata.json').read_text())
            payload = {**current, 'games': context_updates}
    except DataPending as error:
        if not args.validate_current:
            forecast_check(current, season, week, 'waiting_stats', str(error), utcnow())
        print(f'::warning::Weekly forecasts waiting for data: {error}. Existing predictions retained.')
        if not context_updates:
            return
        pending_error = str(error)
        metadata = json.loads((ROOT / 'models/model_metadata.json').read_text())
        payload = {**current, 'games': context_updates}
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
    if pending_error:
        forecast_check(payload, season, week, 'waiting_stats', pending_error, utcnow())
    else:
        state = 'current_limited_qb' if payload.get('qb_coverage', {}).get('limited_inputs') else 'current'
        forecast_check(payload, season, week, state, coverage_message(payload), utcnow())
    print(f"Published {payload['count']} forecasts for {season} Week {week}.")


if __name__ == '__main__':
    main()
