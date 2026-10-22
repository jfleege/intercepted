"""Train/evaluate three projection families and export new, timestamped pregame research.

No odds-provider calls. Never modifies existing winner models or their historical record.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
from datetime import datetime, timezone

from src.ml.refresh_performance import ROOT, kickoff, stamp, write_json
from src.ml.projection_features import (SCORE_FEATURES, PLAYER_FEATURES, KINDS, build_history, final_games, player_features, team_summary, score_features, team_name, day)
from src.features.quarter_trends import quarter_trends


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fingerprint(predictions, players):
    code = {str(p.relative_to(ROOT)): sha(p) for p in [Path(__file__), ROOT / 'src/ml/projection_features.py', ROOT / 'src/ml/projection_models.py', ROOT / 'src/features/quarter_trends.py']}
    core = {'predictions': predictions, 'players': players.get('games', {}), 'code': code}
    return hashlib.sha256(json.dumps(core, sort_keys=True).encode()).hexdigest()


def sources(season, reuse=False):
    import nflreadpy as nfl
    import polars as pl
    cache = ROOT / 'data/raw/research'
    cache.mkdir(parents=True, exist_ok=True)
    output, paths = {}, {}
    for name, loader in [('schedules', lambda years: nfl.load_schedules(years)), ('players', lambda years: nfl.load_player_stats(seasons=years, summary_level='week'))]:
        historical = cache / f'{name}-through-{season - 1}.parquet'
        current = cache / f'{name}-{season}.parquet'
        bootstrap = cache / f'{name}.parquet'
        if not historical.exists():
            old = pl.read_parquet(bootstrap).filter(pl.col('season') < season) if reuse and bootstrap.exists() else loader(list(range(2018, season)))
            old.write_parquet(historical)
        if not current.exists() or not reuse:
            latest = pl.read_parquet(bootstrap).filter(pl.col('season') == season) if reuse and bootstrap.exists() else loader(season)
            latest.write_parquet(current)
        output[name] = pl.concat([pl.read_parquet(historical), pl.read_parquet(current)], how='diagonal_relaxed')
        paths[f'{name}_historical'] = historical
        paths[f'{name}_current'] = current
    pbp_path = cache / f'pbp-{season}.parquet'
    if not pbp_path.exists() or not reuse:
        columns = ['game_id', 'season', 'week', 'season_type', 'qtr', 'total_home_score', 'total_away_score', 'posteam', 'defteam', 'play_type', 'epa', 'success']
        nfl.load_pbp(season).select(columns).write_parquet(pbp_path)
    output['pbp'] = pl.read_parquet(pbp_path)
    paths['pbp_current'] = pbp_path
    return output, {key: sha(path) for key, path in paths.items()}


def validate_export(payload):
    target = (payload['season'], payload['week'])
    if payload['features_through_week'] >= target[1]:
        raise ValueError('Research feature cutoff reaches forecast week')
    for version in payload['model_versions'].values():
        for model in version['models'].values():
            if tuple(model['training_cutoff']) >= tuple(model['calibration_cutoff']) or tuple(model['calibration_cutoff']) >= target:
                raise ValueError('Training, calibration and forecast cutoffs must be ordered')
    def valid_range(values):
        if len(values) != 2 or not all(math.isfinite(v) for v in values) or values[0] > values[1]:
            raise ValueError('Invalid prediction interval')
    for game in payload['games'].values():
        if game['model_version'] not in payload['model_versions'] or stamp(game['generated_at']) >= stamp(game['kickoff']):
            raise ValueError('Research forecast was not saved before kickoff')
        score = game['scoring']
        for side in ('home', 'away'):
            if not math.isfinite(score[side]['expected_points']) or score[side]['expected_points'] < 0:
                raise ValueError('Invalid expected score')
            valid_range(score[side]['range_80'])
        valid_range(score['margin_range_80'])
        valid_range(score['total_range_80'])
        for player in game['players']:
            if player['status'] == 'available':
                valid_range(player['range_80'])
                if not math.isfinite(player['expected_yards']) or player['expected_yards'] < 0:
                    raise ValueError('Invalid yardage forecast')
                for key in ('anytime_td_probability', 'passing_td_probability'):
                    if key in player and not 0 <= player[key] <= 1:
                        raise ValueError('Invalid touchdown probability')
    for team in payload['period_trends']['teams'].values():
        for game in team['history']:
            if game['week'] >= target[1]:
                raise ValueError('Period history reaches forecast week')
            p = {x['period']: x for x in game['periods']}
            for kind in ('points_for', 'points_against'):
                if sum(p[q][kind] for q in ('Q1', 'Q2')) != p['H1'][kind] or sum(p[q][kind] for q in ('Q3', 'Q4')) != p['H2'][kind]:
                    raise ValueError('Quarter and half scoring totals disagree')


def export(reuse=False, force=False):
    # Limit BLAS/OpenMP threads on runners; these small tabular fits need little parallelism.
    os.environ.setdefault('OMP_NUM_THREADS', '2')
    os.environ.setdefault('OPENBLAS_NUM_THREADS', '2')
    import joblib
    from src.ml.projection_models import (benchmark, production_split, fit_regression, fit_event, lineage,
                                           predict_regression, predict_event, score_intervals)
    predictions = json.loads((ROOT / 'frontend/public/predictions.json').read_text())
    watch = json.loads((ROOT / 'frontend/public/players_watch.json').read_text())
    season, week = predictions['season'], predictions['week']
    if (watch['season'], watch['week']) != (season, week):
        raise ValueError('Player export must match the forecast slate')
    identity = fingerprint(predictions, watch)
    output_path = ROOT / 'frontend/public/matchup_research.json'
    existing = json.loads(output_path.read_text()) if output_path.exists() else {}
    if not force and existing.get('input_fingerprint') == identity:
        print('Research inputs unchanged; retaining the original pregame export.')
        return existing
    tables, source_hashes = sources(season, reuse)
    now = datetime.now(timezone.utc).isoformat()
    schedule, player_rows = tables['schedules'].to_dicts(), tables['players'].to_dicts()
    scoring, player_data, team_history, player_history = build_history(schedule, player_rows, season, week, now)
    print(f'Pregame samples: {len(scoring)} team-games, {len(player_data)} player appearances', flush=True)
    report = benchmark(scoring, player_data)
    print('Untouched 2025 benchmark:', json.dumps(report), flush=True)
    fitted, metadata = {}, {}
    model_dir = ROOT / 'models/research'
    model_dir.mkdir(parents=True, exist_ok=True)
    tasks = [('scoring', scoring, SCORE_FEATURES, 'y')]
    tasks += [(f'{kind}_yards', [r for r in player_data if r['kind'] == kind], PLAYER_FEATURES, 'yards') for kind in ['passing', 'rushing', 'receiving']]
    tasks += [('anytime_td', player_data, PLAYER_FEATURES, 'any_td'), ('passing_td', [r for r in player_data if r['position'] == 'QB'], PLAYER_FEATURES, 'pass_td')]
    score_widths = None
    for name, rows, columns, target in tasks:
        event = target if target in ('any_td', 'pass_td') else None
        train, calibration = production_split(rows, season, minimum=40 if name != 'anytime_td' else 100, event=event)
        model = fit_event(train, calibration, target) if event else fit_regression(train, calibration, columns, target)
        fitted[name] = model
        if name == 'scoring':
            score_widths = score_intervals(model, calibration)
        file = model_dir / f'{name}.joblib'
        joblib.dump(model, file)
        metadata[name] = {**lineage(train, calibration), 'sha256': sha(file), 'features': columns, 'method': 'standardized logistic regression + held-out sigmoid calibration' if event else 'histogram gradient boosting + held-out absolute-residual intervals'}
    version = hashlib.sha256(json.dumps(metadata, sort_keys=True).encode()).hexdigest()[:16]
    version_info = {'created_at': now, 'models': metadata, 'source_sha256': source_hashes, 'status': 'experimental',
                    'notes': 'Player estimates are conditional on appearing in the game, not an availability model. Anytime TD means rushing/receiving TD; passing TD is a separate QB event. Ranges target 80% coverage, not guarantees.'}
    upcoming = {g['game_id']: g for g in schedule}
    same_week = (existing.get('season'), existing.get('week')) == (season, week)
    games = {}
    generated_at = datetime.now(timezone.utc).isoformat()
    for game in predictions['games']:
        source = upcoming.get(game['game_id'])
        if not source or not kickoff(source):
            continue
        if stamp(kickoff(source)) <= stamp(generated_at):
            if same_week and game['game_id'] in existing.get('games', {}):
                games[game['game_id']] = existing['games'][game['game_id']]
            continue  # Never create a new forecast after kickoff.
        summaries = {team_name(source[side]): team_summary(team_history, team_name(source[side]), season, day(source)) for side in ('home_team', 'away_team')}
        sides = {}
        for side, other_side in [('away', 'home'), ('home', 'away')]:
            team, opponent = game[f'{side}_team'], game[f'{other_side}_team']
            x = score_features(summaries[team], summaries[opponent], side == 'home', week)
            pred = float(predict_regression(fitted['scoring'], [{'x': x}])[0])
            sides[side] = {'team': team, 'expected_points': round(pred, 1), 'range_80': [round(max(0, pred - fitted['scoring']['radius']), 1), round(pred + fitted['scoring']['radius'], 1)]}
        h, a = sides['home']['expected_points'], sides['away']['expected_points']
        margin, total = h - a, h + a
        cards = []
        matchup = watch.get('games', {}).get(game['game_id'], {})
        for side, other_side in [('away', 'home'), ('home', 'away')]:
            team, opponent = game[f'{side}_team'], game[f'{other_side}_team']
            for player in matchup.get(f'{side}_players', []):
                position = player['position']
                if position not in KINDS:
                    continue
                history = player_history.get(player['player_id'], [])
                x = player_features(history, KINDS[position], position, season, summaries[team], summaries[opponent], side == 'home', week)
                card = {key: player.get(key) for key in ('player_id', 'name', 'headshot', 'position')}
                card.update(team=team, opponent=opponent, prior_appearances=len(history), conditional_on='Appearing in the game', status='available' if x else 'insufficient_history')
                if x:
                    yardage_model = fitted[f'{KINDS[position]}_yards']
                    y = float(predict_regression(yardage_model, [{'x': x}])[0])
                    card.update(stat=KINDS[position], expected_yards=round(y, 1), range_80=[round(y - yardage_model['radius'], 1), round(y + yardage_model['radius'], 1)],
                                recent_yards=round(x['recent_yards'], 1), anytime_td_probability=round(float(predict_event(fitted['anytime_td'], [{'x': x}])[0]), 4))
                    if position == 'QB':
                        card['passing_td_probability'] = round(float(predict_event(fitted['passing_td'], [{'x': x}])[0]), 4)
                cards.append(card)
        games[game['game_id']] = {'game_id': game['game_id'], 'model_version': version, 'generated_at': generated_at, 'kickoff': kickoff(source),
                                  'scoring': {**sides, 'home_margin': round(margin, 1), 'total': round(total, 1),
                                              'margin_range_80': [round(margin - score_widths['margin'], 1), round(margin + score_widths['margin'], 1)],
                                              'total_range_80': [round(max(0, total - score_widths['total']), 1), round(total + score_widths['total'], 1)]}, 'players': cards}
    if not games:
        print('No future games eligible; retaining the previous research export.')
        return existing
    versions = {**(existing.get('model_versions', {}) if same_week else {}), version: version_info}
    used = {g['model_version'] for g in games.values()}
    output = {'schema_version': 1, 'status': 'experimental', 'season': season, 'week': week, 'features_through_week': week - 1,
              'input_fingerprint': identity, 'generated_at': generated_at, 'games': games,
              'model_versions': {k: v for k, v in versions.items() if k in used}, 'validation': report,
              'period_trends': quarter_trends(tables['pbp'].to_dicts(), final_games(schedule, season, week, now), season)}
    validate_export(output)
    # Write only after all fits/validations complete; a failed refresh leaves the prior output intact.
    write_json(output_path, output)
    write_json(ROOT / f'frontend/public/research/{season}-week-{week}.json', output)
    write_json(ROOT / 'data/tracking/research' / f'{identity}-{version}.json', output)
    write_json(model_dir / 'metadata.json', {'version': version, **version_info, 'validation': report})
    write_json(ROOT / 'docs/research-validation.json', report)
    print(f'Exported {len(games)} timestamped matchup reports; {len(output["period_trends"]["teams"])} teams with period trends.', flush=True)
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--reuse-downloads', action='store_true', help='Use local cached sources for reproducible development runs')
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    export(args.reuse_downloads, args.force)


if __name__ == '__main__':
    main()
