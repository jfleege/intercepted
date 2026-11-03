"""Chronological, pregame-only features for scoring and conditional player projections."""
from collections import defaultdict
from datetime import date
import math
from statistics import mean
from src.ml.refresh_performance import ALIASES, kickoff, normalize_result

KINDS = {'QB': 'passing', 'RB': 'rushing', 'WR': 'receiving', 'TE': 'receiving'}
USAGE = {'passing': 'attempts', 'rushing': 'carries', 'receiving': 'targets'}
SCORE_FEATURES = ['own_points_recent', 'own_points_season', 'opp_points_recent', 'opp_points_season', 'own_pass', 'own_rush', 'opp_pass', 'opp_rush', 'home', 'rest', 'opp_rest', 'season_games', 'week']
PLAYER_FEATURES = ['recent_yards', 'season_yards', 'last10_yards', 'recent_usage', 'season_usage', 'yards_per_opportunity', 'recent_any_td', 'recent_pass_td', 'season_any_td', 'season_pass_td', 'appearances', 'season_appearances', 'opp_pass', 'opp_rush', 'opp_points', 'team_points', 'home', 'rest', 'week', 'is_qb', 'is_rb', 'is_wr', 'is_te']


def num(value, default=0.0):
    try:
        value = float(value)
        return value if math.isfinite(value) else default
    except (TypeError, ValueError):
        return default


def team_name(value):
    return ALIASES.get(value, value)


def day(game):
    return date.fromisoformat(str(game.get('gameday', game.get('game_date')))[:10])


def final_games(rows, season, week, now):
    return sorted((g for g in rows if g.get('game_type') == 'REG' and (int(g['season']), int(g['week'])) < (season, week)
                   and normalize_result(g, now)['status'] == 'final'), key=lambda g: (kickoff(g), g['game_id']))


def team_summary(history, team, season, when):
    records = history.get(team, [])
    current = [r for r in records if r['season'] == season]
    prior = [r for r in records if r['season'] == season - 1]
    recent = records[-5:]
    defaults = {'points': 22., 'allowed': 22., 'passing': 230., 'rushing': 110., 'pass_allowed': 230., 'rush_allowed': 110.}
    output = {}
    for key, default in defaults.items():
        previous = mean([r[key] for r in prior]) if prior else default
        weight = min(.85, len(current) / (len(current) + 3))
        output[key] = weight * (mean([r[key] for r in current]) if current else previous) + (1 - weight) * previous
        output[f'{key}_recent'] = mean([r[key] for r in recent]) if recent else previous
    output['games'] = len(current)
    output['rest'] = min(30, max(1, (when - records[-1]['date']).days)) if records else 14
    return output


def score_features(own, opponent, home, week):
    return dict(zip(SCORE_FEATURES, [own['points_recent'], own['points'], opponent['allowed_recent'], opponent['allowed'], own['passing'], own['rushing'], opponent['pass_allowed'], opponent['rush_allowed'], int(home), own['rest'], opponent['rest'], own['games'], week]))


def player_features(records, kind, position, season, own, opponent, home, week):
    if len(records) < 3:
        return None
    recent, last10 = records[-3:], records[-10:]
    current = [r for r in records if r['season'] == season] or last10
    field, usage = f'{kind}_yards', USAGE[kind]
    avg = lambda group, key: mean([r[key] for r in group])
    opportunities = sum(r[usage] for r in recent)
    # Smoothed historical per-appearance event rates; no current-game touches/targets enter X.
    any_rate = (sum(r['any_td'] for r in last10) + 1) / (len(last10) + 5)
    passing_rate = (sum(r['pass_td'] for r in last10) + 2) / (len(last10) + 3)
    values = [avg(recent, field), avg(current, field), avg(last10, field), avg(recent, usage), avg(current, usage),
              sum(r[field] for r in recent) / max(1, opportunities), avg(recent, 'any_td'), avg(recent, 'pass_td'), any_rate, passing_rate,
              min(100, len(records)), len([r for r in records if r['season'] == season]), opponent['pass_allowed'], opponent['rush_allowed'],
              opponent['allowed'], own['points'], int(home), own['rest'], week, *[int(position == p) for p in ('QB', 'RB', 'WR', 'TE')]]
    return dict(zip(PLAYER_FEATURES, values))


def build_history(schedules, player_rows, season, week, now):
    """Compute both sides' features before updating either team's/player's history."""
    games = final_games(schedules, season, week, now)
    by_game = defaultdict(list)
    lookup = {(int(g['season']), int(g['week']), team_name(g[side])): g['game_id'] for g in games for side in ('away_team', 'home_team')}
    for row in player_rows:
        if row.get('season_type', 'REG') not in ('REG', None):
            continue
        team = team_name(row.get('team', row.get('recent_team')))
        game_id = lookup.get((int(row['season']), int(row['week']), team))
        if game_id and row.get('player_id'):
            by_game[game_id].append({**row, 'team': team})
    team_history, player_history = defaultdict(list), defaultdict(list)
    scoring, players = [], []
    for game in games:
        year, game_week = int(game['season']), int(game['week'])
        home, away = team_name(game['home_team']), team_name(game['away_team'])
        when = day(game)
        summaries = {t: team_summary(team_history, t, year, when) for t in (home, away)}
        stats = by_game[game['game_id']]
        totals = {t: {kind: sum(num(r.get(f'{kind}_yards')) for r in stats if r['team'] == t) for kind in ('passing', 'rushing')} for t in (home, away)}
        for side, team, opponent in [('home', home, away), ('away', away, home)]:
            own, other = summaries[team], summaries[opponent]
            features = score_features(own, other, side == 'home', game_week)
            scoring.append({'game_id': game['game_id'], 'season': year, 'week': game_week, 'side': side, 'team': team, 'x': features,
                            'y': num(game[f'{side}_score']), 'baseline': (own['points_recent'] + other['allowed_recent']) / 2})
        seen = set()
        for row in stats:
            position = row.get('position')
            if position not in KINDS or row['player_id'] in seen:
                continue
            seen.add(row['player_id'])
            team = row['team']
            if team not in (home, away):
                continue
            other = away if team == home else home
            record = {key: num(row.get(key)) for key in ['passing_yards', 'rushing_yards', 'receiving_yards', 'attempts', 'carries', 'targets']}
            record.update(season=year, week=game_week, date=when, any_td=int(num(row.get('rushing_tds')) + num(row.get('receiving_tds')) > 0), pass_td=int(num(row.get('passing_tds')) > 0))
            history = player_history[row['player_id']]
            features = player_features(history, KINDS[position], position, year, summaries[team], summaries[other], team == home, game_week)
            if features:
                players.append({'game_id': game['game_id'], 'player_id': row['player_id'], 'season': year, 'week': game_week, 'position': position, 'kind': KINDS[position],
                                'x': features, 'yards': record[f'{KINDS[position]}_yards'], 'any_td': record['any_td'], 'pass_td': record['pass_td'], 'baseline': features['recent_yards']})
            history.append(record)
        for side, team, other, opposing in [('home', home, away, 'away'), ('away', away, home, 'home')]:
            team_history[team].append({'season': year, 'week': game_week, 'date': when, 'points': num(game[f'{side}_score']), 'allowed': num(game[f'{opposing}_score']),
                                       **totals[team], 'pass_allowed': totals[other]['passing'], 'rush_allowed': totals[other]['rushing']})
    return scoring, players, team_history, player_history
