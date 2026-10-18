"""Game-scoped, sourced starter reports override the explicitly unconfirmed passer proxy."""
import json
from src.ml.refresh_performance import ROOT, ALIASES, kickoff, stamp


def load_reports(root=ROOT):
    path = root / 'data/inputs/qb_starters.json'
    payload = json.loads(path.read_text()) if path.exists() else {'schema_version': 1, 'games': {}}
    if payload.get('schema_version') != 1 or not isinstance(payload.get('games'), dict):
        raise ValueError('Unsupported starter report schema')
    return payload['games']


def current_report(game, team, reports, now):
    report = reports.get(game['game_id'], {}).get(team)
    if not report:
        return None
    if team not in (game['home_team'], game['away_team']):
        raise ValueError('Starter report team is not in this matchup')
    if not report.get('name') or report.get('status') not in ('reported_expected', 'confirmed'):
        raise ValueError('Starter report requires a player name and explicit status')
    if not str(report.get('source', '')).startswith('https://'):
        raise ValueError('Starter report requires an HTTPS source')
    observed = stamp(report['observed_at'])
    start = kickoff(game)
    if not start or observed >= stamp(start):
        return None  # Late evidence must not change pregame assumptions.
    if observed > stamp(now):
        raise ValueError('Starter report observation time is in the future')
    return report


def resolve_qb(game, team, ngs_rows, reports, now):
    season, week = game['season'], game['week']
    history = [r for r in ngs_rows if r.get('player_gsis_id') and (r.get('attempts') or 0) > 0
               and (r['season'] < season or (r['season'] == season and r['week'] < week))]
    report = current_report(game, team, reports, now)
    if report:
        matches = [r for r in history if r.get('player_display_name') == report['name']
                   and r['season'] == season and ALIASES.get(r['team_abbr'], r['team_abbr']) == team]
        ids = {r['player_gsis_id'] for r in matches}
        if len(ids) != 1:
            raise ValueError(f"Cannot uniquely resolve reported QB {report['name']} for {team}; refusing a cosmetic name change")
        player_id = ids.pop()
        if report.get('player_id') and report['player_id'] != player_id:
            raise ValueError('Starter report player ID and name disagree')
        return {'player_id': player_id, 'name': report['name'], 'status': report['status'],
                'source': report['source'], 'observed_at': report['observed_at']}
    candidates = [r for r in history if r['season'] == season and ALIASES.get(r['team_abbr'], r['team_abbr']) == team]
    if not candidates:
        return {'player_id': None, 'name': None, 'status': 'unknown', 'source': 'No prior-week passer', 'observed_at': now}
    row = max(candidates, key=lambda r: (r['week'], r['attempts'], r['player_gsis_id']))
    return {'player_id': row['player_gsis_id'], 'name': row['player_display_name'], 'status': 'unconfirmed_proxy',
            'source': 'Latest prior-week primary passer; not a starter announcement', 'observed_at': now}


def changed_report_games(current, schedules, reports, now):
    """Only explicit new reports can revise an already-published slate; never started games."""
    by_id = {g['game_id']: g for g in schedules}
    changed = []
    for old in current['games']:
        game = by_id.get(old['game_id'])
        if not game or not kickoff(game) or stamp(kickoff(game)) <= stamp(now):
            continue
        for side in ('home', 'away'):
            team = game[f'{side}_team']
            report = current_report(game, team, reports, now)
            if report and (old.get(f'{side}_projected_qb_name') != report['name']
                           or old.get(f'{side}_qb_selection', {}).get('observed_at') != report['observed_at']):
                changed.append(game)
                break
    return changed


def merge_revisions(current, regenerated, schedules, now):
    by_id = {g['game_id']: g for g in schedules}
    replacement = {g['game_id']: g for g in regenerated['games']
                   if g['game_id'] in by_id and kickoff(by_id[g['game_id']]) and stamp(kickoff(by_id[g['game_id']])) > stamp(now)}
    result = {**current, 'generated_at': now, 'revision_reason': 'Sourced QB starter update',
              'games': [replacement.get(g['game_id'], g) for g in current['games']]}
    result['count'] = len(result['games'])
    return result


def watch_players(game, side, candidates):
    """Use exactly the QB whose features the prediction used, never a recent-production substitute."""
    player_id = game.get(f'{side}_projected_qb_id')
    name = game.get(f'{side}_projected_qb_name')
    matching = [p for p in candidates if p['position'] == 'QB'
                and (p['player_id'] == player_id if player_id else p['name'] == name)]
    if len(matching) > 1:
        raise ValueError('Ambiguous player-card QB identity')
    qbs = [{**p, 'qb_status': game.get(f'{side}_qb_selection', {}).get('status', 'unconfirmed_proxy')} for p in matching]
    skill = sorted([p for p in candidates if p['position'] in ('RB', 'WR', 'TE')],
                   key=lambda p: (p['last_game_week'], p['recent_average']), reverse=True)
    return qbs + skill[:3]
