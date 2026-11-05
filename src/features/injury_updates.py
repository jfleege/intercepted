"""Supplemental injury evidence and conditional QB inputs; never infer an absence."""
import json
import unicodedata
from collections import defaultdict
from urllib.request import urlopen
from src.features.player_context import within
from src.ml.refresh_performance import stamp, kickoff, ALIASES

ESPN_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries'
ESPN_SOURCE = 'https://www.espn.com/nfl/injuries'
CONCERNS = ('Out', 'Doubtful', 'Questionable', 'Injured Reserve')


def normalized(name):
    return ''.join(c for c in unicodedata.normalize('NFKD', name).lower() if c.isalnum())


def espn_rows(payload, directory, season, week, now):
    """Join only unique exact normalized names, team and position; reject old news."""
    if payload.get('season', {}).get('year') != season or payload.get('season', {}).get('type') != 2:
        return []
    if not within(payload.get('timestamp'), now):
        return []
    identities = defaultdict(set)
    for p in directory.get('players', []):
        identities[(p['team'], normalized(p['name']), p['position'])].add(p['player_id'])
    output = []
    for team in payload.get('injuries', []):
        for r in team.get('injuries', []):
            athlete = r.get('athlete', {})
            abbr = athlete.get('team', {}).get('abbreviation')
            key = (ALIASES.get(abbr, abbr), normalized(athlete.get('displayName', '')), athlete.get('position', {}).get('abbreviation'))
            ids = identities.get(key, set())
            if len(ids) != 1 or r.get('status') not in CONCERNS or not within(r.get('date'), now):
                continue
            output.append({'season': season, 'week': week, 'season_type': 'REG', 'team': key[0],
                           'gsis_id': next(iter(ids)), 'report_status': r['status'],
                           'report_primary_injury': r.get('details', {}).get('type'),
                           'date_modified': r['date'], '_source': ESPN_SOURCE, '_observed_at': now})
    return output


def supplement(injuries, supplemental):
    """Select newer evidence; official feed wins ties. Duplicate official rows stay ambiguous."""
    grouped = defaultdict(list)
    for row in injuries:
        grouped[(row.get('season'), row.get('week'), row.get('team'), row.get('gsis_id'))].append(row)
    for row in supplemental:
        key = (row['season'], row['week'], row['team'], row['gsis_id'])
        old = grouped[key]
        try:
            newer = not old or all(r.get('date_modified') and stamp(row['date_modified']) > stamp(r['date_modified']) for r in old)
        except (TypeError, ValueError):
            newer = False
        if newer:
            grouped[key] = [row]
    return [r for rows in grouped.values() for r in rows]


def fetch_supplement(directory, season, week, now=None):
    try:
        with urlopen(ESPN_URL, timeout=20) as response:
            payload = json.load(response)
        if now is None:
            from src.ml.refresh_performance import utcnow
            now = utcnow()
        rows = espn_rows(payload, directory, season, week, now)
        return rows, {'status': 'available', 'observed_at': now, 'rows': len(rows), 'source': ESPN_SOURCE}
    except Exception as error:
        return [], {'status': 'unavailable', 'observed_at': now, 'rows': 0, 'error': type(error).__name__}


def game_evidence(game, contexts, now):
    """Stable actionable inputs, without turning every fetch timestamp into a revision."""
    result = []
    start = kickoff(game)
    for c in contexts:
        a = c['availability']
        if c['game_id'] != game['game_id'] or not start or stamp(now) >= stamp(start):
            continue
        if a['status'] not in CONCERNS or not within(a.get('observed_at'), now) or not within(a.get('report_updated_at'), now):
            continue
        result.append({k: c[k] for k in ('player_id', 'name', 'team', 'position')} | {
            'status': a['status'], 'injury': a.get('injury'), 'source': a['source'], 'report_updated_at': a['report_updated_at']})
    return sorted(result, key=lambda r: r['player_id'])


def backup_candidates(game, side, evidence, contexts, now):
    current = game.get(f'{side}_projected_qb_id')
    if not any(r['player_id'] == current and r['position'] == 'QB' for r in evidence):
        return []
    reserves = [c for c in contexts if c['game_id'] == game['game_id'] and c['team'] == game[f'{side}_team'] and c['position'] == 'QB'
                and c['starter'].get('rank') == 2 and within(c['starter'].get('updated_at'), now)
                and c['availability']['status'] not in ('Out', 'Doubtful', 'Injured Reserve')]
    return reserves if len(reserves) == 1 else []


def replace_qb_features(features, home, away, metrics):
    """Same feature definitions used by primary forecasts and backup scenarios."""
    import math
    result = dict(features)
    for metric in metrics:
        for prefix in ('career', 'recent'):
            key = f'qb_{prefix}_{metric}'
            result[f'diff_{key}'] = home.get(key, float('nan')) - away.get(key, float('nan'))
    result['qb_experience_diff'] = math.log1p(home.get('qb_career_attempts', float('nan'))) - math.log1p(away.get('qb_career_attempts', float('nan')))
    return result


def availability_changed(previous, game, contexts, now):
    evidence = game_evidence(game, contexts, now)
    if evidence != previous.get('availability_watch', []):
        return True
    candidates = [c['player_id'] for side in ('home', 'away')
                  for c in backup_candidates(previous, side, evidence, contexts, now)]
    return sorted(candidates) != sorted(c.get('player_id', '') for c in previous.get('qb_scenarios', []))


def availability_revision_games(current, games, contexts, sources, now):
    """Use the same revision gate in the polling job and the forecast generator."""
    if not contexts or any(sources.get(key, {}).get('status') != 'available'
                           for key in ('injuries', 'depth_charts', 'espn_injuries')):
        return []
    previous = {g['game_id']: g for g in current['games']}
    return [
        game for game in games
        if game['game_id'] in previous and kickoff(game) and stamp(kickoff(game)) > stamp(now)
        and availability_changed(previous[game['game_id']], game, contexts, now)
    ]
