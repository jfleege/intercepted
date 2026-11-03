"""Reconcile qualified NGS omissions using completed-game box scores, never fake metrics."""
import math
from src.ml.refresh_performance import ALIASES, normalize_result

# Public weekly passing leaderboards omit players below this qualifying volume.
# Keep the exception conservative: qualifying-volume gaps still block publication.
MIN_NGS_ATTEMPTS = 15


def prior_game(row, season, week, now):
    return row.get('season') == season and row.get('game_type') == 'REG' and 1 <= row['week'] < week and normalize_result(row, now)['status'] == 'final'


def missing_ngs_weeks(schedules, ngs, season, week, now):
    expected = {(season, g['week'], ALIASES.get(g[f'{side}_team'], g[f'{side}_team']))
                for g in schedules if prior_game(g, season, week, now) for side in ('home', 'away')}
    actual = {(r['season'], r['week'], ALIASES.get(r['team_abbr'], r['team_abbr'])) for r in ngs
              if r.get('player_gsis_id') and (r.get('attempts') or 0) > 0 and r.get('season_type', 'REG') in ('REG', 'REGULAR')}
    return sorted(expected - actual)


def count(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 and value == int(value)


def low_volume_exclusions(missing, schedules, ngs, players, teams, season, week, now):
    """Exempt only fully reconciled sub-qualifying passing performances."""
    exclusions = []
    for year, prior_week, team in missing:
        label = f'{team} {year} Week {prior_week}'
        games = [g for g in schedules if prior_game(g, season, week, now) and g['week'] == prior_week
                 and team in [ALIASES.get(g[f'{side}_team'], g[f'{side}_team']) for side in ('home', 'away')]]
        if len(games) != 1:
            raise ValueError(f'{label}: completed game cannot be uniquely identified')
        game = games[0]
        def matches(row):
            return row.get('season') == year and row.get('week') == prior_week and row.get('game_id') == game['game_id'] and ALIASES.get(row.get('team'), row.get('team')) == team and row.get('season_type') == 'REG'
        roster = [r for r in players if matches(r)]
        totals = [r for r in teams if matches(r)]
        if not roster or len(totals) != 1 or not count(totals[0].get('attempts')):
            raise ValueError(f'{label}: player/team box-score coverage is unavailable')
        if any(not count(r.get('attempts')) for r in roster):
            raise ValueError(f'{label}: box-score attempts are invalid or missing')
        passers = [r for r in roster if r['attempts'] > 0]
        if not passers or sum(r['attempts'] for r in passers) != totals[0]['attempts']:
            raise ValueError(f'{label}: player attempts do not reconcile to the team total')
        if any(r['attempts'] >= MIN_NGS_ATTEMPTS for r in passers):
            raise ValueError(f'{label}: a qualifying-volume passer is missing from NGS')
        if any(not r.get('player_id') or not r.get('player_display_name') for r in passers) or len({r['player_id'] for r in passers}) != len(passers):
            raise ValueError(f'{label}: passer identities are incomplete or duplicated')
        highest = max(r['attempts'] for r in passers)
        primary = [r for r in passers if r['attempts'] == highest]
        if len(primary) != 1 or primary[0].get('position') != 'QB':
            raise ValueError(f'{label}: primary quarterback is ambiguous')
        qb = primary[0]
        side = 'home' if ALIASES.get(game['home_team'], game['home_team']) == team else 'away'
        if game.get(f'{side}_qb_id') != qb['player_id']:
            raise ValueError(f'{label}: schedule and box-score QB IDs disagree')
        history = [r for r in ngs if r.get('player_gsis_id') == qb['player_id'] and (r.get('attempts') or 0) > 0
                   and r.get('season_type', 'REG') in ('REG', 'REGULAR') and r['week'] > 0
                   and (r['season'] < season or (r['season'] == season and r['week'] < week))]
        if not history:
            raise ValueError(f'{label}: no prior NGS history for the identified quarterback')
        latest = max(history, key=lambda r: (r['season'], r['week']))
        exclusions.append({'season': year, 'week': prior_week, 'team': team, 'game_id': game['game_id'],
                           'player_id': qb['player_id'], 'name': qb['player_display_name'], 'attempts': qb['attempts'],
                           'team_attempts': totals[0]['attempts'], 'ngs_through_season': latest['season'], 'ngs_through_week': latest['week'],
                           'reason': 'Every passer below the weekly NGS qualifying volume; player/team attempts reconcile and schedule QB ID agrees',
                           'source': 'nflverse completed-game schedule, player stats, and team stats'})
    return exclusions


def coverage_metadata(games, exclusions):
    limited = {}
    for game in games:
        for side in ('home', 'away'):
            evidence = game.get(f'{side}_qb_selection', {}).get('ngs_exclusion')
            if evidence:
                limited[(evidence['game_id'], evidence['team'])] = evidence
    return {'exclusions': exclusions, 'limited_inputs': list(limited.values())}


def coverage_message(payload):
    limited = payload.get('qb_coverage', {}).get('limited_inputs', [])
    if not limited:
        return 'Published forecast slate is current.'
    notes = '; '.join(f"{row['team']}: {row['name']} NGS through {row['ngs_through_season']} Week {row['ngs_through_week']}" for row in limited)
    return f'Published slate uses qualified low-volume NGS exclusions. {notes}. No missing tracking metrics were invented.'
