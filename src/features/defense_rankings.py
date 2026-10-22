"""Opponent context from completed prior-week games, using already-loaded sources.

Rank 1 allows the fewest points (overall) or gross passing/rushing yards per game.
These are descriptive season-to-date ranks, not predictive power ratings.
"""
from collections import defaultdict
from datetime import date
import math

ALIASES = {'OAK': 'LV', 'SD': 'LAC', 'STL': 'LA', 'LAR': 'LA', 'JAC': 'JAX'}


def numeric(value):
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def build_defense_rankings(stat_rows, schedule_rows, season, week, as_of, team_column):
    """Never include the forecast week, future dates, preseason, or unfinished games."""
    normalize = lambda team: ALIASES.get(team, team)
    season_schedule = [g for g in schedule_rows if g.get('season') == season and g.get('game_type') == 'REG']
    league = {normalize(g[side]) for g in season_schedule for side in ('away_team', 'home_team')}
    offense = defaultdict(lambda: {'passing_yards': [], 'rushing_yards': []})
    for row in stat_rows:
        if row.get('season') != season or row.get('season_type', row.get('game_type', 'REG')) not in ('REG', None):
            continue
        key = (normalize(row.get(team_column)), row.get('week'))
        for stat in ('passing_yards', 'rushing_yards'):
            value = numeric(row.get(stat))
            if value is not None:
                offense[key][stat].append(value)

    allowed = defaultdict(lambda: {'points': [], 'passing_yards': [], 'rushing_yards': [], 'weeks': []})
    seen = set()
    for game in season_schedule:
        game_week = int(game['week'])
        day = date.fromisoformat(str(game['gameday'])[:10]) if game.get('gameday') else None
        home_score, away_score = numeric(game.get('home_score')), numeric(game.get('away_score'))
        if game_week >= week or day is None or day > as_of or home_score is None or away_score is None:
            continue
        home, away = normalize(game['home_team']), normalize(game['away_team'])
        key = (game_week, home, away)
        if key in seen:
            continue
        seen.add(key)
        for team, opponent, points in ((home, away, away_score), (away, home, home_score)):
            entry = allowed[team]
            entry['points'].append(points)
            entry['weeks'].append(game_week)
            for stat in ('passing_yards', 'rushing_yards'):
                values = offense.get((opponent, game_week), {}).get(stat, [])
                if values:
                    entry[stat].append(sum(values))

    teams = {}
    for team in sorted(league):
        entry = allowed[team]
        games = len(entry['points'])
        teams[team] = {
            'games': games,
            'through_week': max(entry['weeks'], default=0),
            'points_allowed_per_game': sum(entry['points']) / games if games else None,
            # Missing opponent stats cannot be treated as zero or compared on a partial sample.
            'pass_yards_allowed_per_game': sum(entry['passing_yards']) / games if games and len(entry['passing_yards']) == games else None,
            'rush_yards_allowed_per_game': sum(entry['rushing_yards']) / games if games and len(entry['rushing_yards']) == games else None,
        }
    for metric, rank in (('points_allowed_per_game', 'overall_rank'), ('pass_yards_allowed_per_game', 'pass_rank'), ('rush_yards_allowed_per_game', 'rush_rank')):
        values = [entry[metric] for entry in teams.values() if entry[metric] is not None]
        for entry in teams.values():
            value = entry[metric]
            entry[rank] = 1 + sum(other < value for other in values) if value is not None and len(values) == len(league) else None
            entry[metric] = round(value, 1) if value is not None else None
    return {
        'league_size': len(league),
        'through_week': max((entry['through_week'] for entry in teams.values()), default=0),
        'methodology': 'Season-to-date points and gross passing/rushing yards allowed per completed game before the forecast week; rank 1 allows the fewest. Ties share a rank.',
        'teams': teams,
    }
