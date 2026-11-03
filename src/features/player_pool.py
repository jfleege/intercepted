"""Full offensive research pool, independent of the small Dashboard shortlist."""
from collections import defaultdict

POSITIONS = ('QB', 'RB', 'WR', 'TE')


def latest_teams(rows, season, week, normalize=lambda team: team):
    """Use only prior regular-season observations; ambiguous latest teams are withheld."""
    observations = defaultdict(lambda: defaultdict(set))
    for row in rows:
        if row.get('season') != season or row.get('season_type', row.get('game_type', 'REG')) not in ('REG', None):
            continue
        if not row.get('week') or int(row['week']) >= week:
            continue
        pid = row.get('player_id') or row.get('gsis_id')
        team = normalize(row.get('recent_team') or row.get('team') or row.get('team_abbr'))
        if pid and team:
            observations[pid][int(row['week'])].add(team)
    return {pid: next(iter(by_week[max(by_week)])) for pid, by_week in observations.items()
            if len(by_week[max(by_week)]) == 1}


def projection_pool(game, side, candidates):
    """All observed RB/WR/TEs plus the forecast QB; never substitute a backup QB."""
    team = game[f'{side}_team']
    pid, name = game.get(f'{side}_projected_qb_id'), game.get(f'{side}_projected_qb_name')
    grouped = defaultdict(list)
    for player in candidates:
        if player.get('team') != team or player.get('position') not in POSITIONS or not player.get('player_id'):
            continue
        if player['position'] == 'QB' and not (player['player_id'] == pid if pid else name and player.get('name') == name):
            continue
        grouped[player['player_id']].append(player)
    # Conflicting identities are not resolved by an arbitrary first/last row.
    unique = [rows[0] for rows in grouped.values() if all(row == rows[0] for row in rows)]
    return sorted(unique, key=lambda p: (POSITIONS.index(p['position']), -p.get('recent_average', 0), p['player_id']))


def matchup_pool(game, side, matchup):
    """Old saved slates retain their original shortlist; new exports carry the full pool."""
    return projection_pool(game, side, matchup.get(f'{side}_catalog', matchup.get(f'{side}_players', [])))
