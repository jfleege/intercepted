"""Publish and grade saved same-game combinations on the existing refresh workflow."""
import json
import math
from collections import defaultdict
from datetime import timedelta

from src.ml.refresh_performance import ROOT, normalize_result, stamp, utcnow, write_json
from src.ml.projection_features import team_name

PUBLIC = ROOT / 'frontend/public'
MAX_AGE = timedelta(hours=72)
MIN_BOUND = .55
MIN_GAMES = 30
TD_EVENTS = {
    'passing_td_probability': ('passing_tds', 1, '1+ passing TD'),
    'passing_two_td_probability': ('passing_tds', 2, '2+ passing TD'),
    'anytime_td_probability': ('scoring_tds', 1, '1+ rush/receiving TD'),
}


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def timestamp(value):
    try:
        return stamp(value) if value else None
    except ValueError:
        return None


def fresh(value, now):
    observed = timestamp(value)
    return observed is not None and timedelta(0) <= now - observed <= MAX_AGE


def read(path):
    return json.loads(path.read_text()) if path.exists() else {}


def legs_for(game, report, extensions, contexts):
    candidates = []
    for player in report['players']:
        team = player['team']
        if team not in (game['home_team'], game['away_team']) or player['status'] != 'available':
            continue
        side = 'home' if team == game['home_team'] else 'away'
        opponent = game['away_team' if side == 'home' else 'home_team']
        if player['opponent'] != opponent:
            continue
        player_id = player['player_id']
        key = (game['game_id'], player_id, team, opponent)
        extension = extensions.get(key, {})
        context = contexts.get(key, {})
        if timestamp(extension.get('kickoff')) != stamp(report['kickoff']):
            extension = {}
        if timestamp(context.get('kickoff')) != timestamp(report['kickoff']):
            context = {}
        availability = context.get('availability') or extension.get('availability_evidence') or {}
        if availability.get('blocked') or availability.get('status') in ('Out', 'Injured Reserve', 'Doubtful', 'Questionable'):
            continue
        qb = game.get(f'{side}_qb_selection') or {}
        if player['position'] == 'QB' and qb.get('player_id') != player_id:
            continue
        role_verified = qb.get('status') == 'confirmed' if player['position'] == 'QB' else (context['starter'].get('rank') if context.get('starter') else extension.get('role_rank')) == 1
        options = [(stat, line, label, player.get(key)) for key, (stat, line, label) in TD_EVENTS.items()
                   if stat != 'passing_tds' or player['position'] == 'QB']
        kind = extension.get('kind')
        if kind in ('passing', 'rushing', 'receiving'):
            for row in extension.get('thresholds', []):
                line = row['threshold']
                if number(line) and line > 0 and row['basis'] in ('role_aware', 'conditional_baseline'):
                    options.append((f'{kind}_yards', line, f'{line:g}+ {kind} yards', row['probability']))
        for stat, line, label, probability in options:
            if number(probability) and 0 < probability <= 1:
                candidates.append(dict(player_id=player_id, name=player['name'], team=team, stat=stat, threshold=line,
                                       label=label, probability=probability, role_verified=role_verified))
    return candidates


def combinations(candidates, count):
    # Each player contributes at most one leg. The largest marginals maximize the Fréchet lower bound.
    ordered = sorted(candidates, key=lambda leg: (-leg['probability'], leg['player_id'], leg['stat'], leg['threshold']))
    best = {}
    for leg in ordered:
        best.setdefault(leg['player_id'], leg)
    pool = list(best.values())
    if len(pool) < count:
        return []
    groups = [pool[:count]]
    # Show distinct player groups, with the next best replacement for each starting leg.
    if len(pool) > count:
        groups.extend(pool[:i] + pool[i + 1:count + 1] for i in range(count))
    options = []
    for legs in groups:
        lower = max(0, math.fsum(l['probability'] for l in legs) - count + 1)
        upper = min(l['probability'] for l in legs)
        options.append(dict(legs=legs, lower=round(lower, 6), upper=round(upper, 6), result='pending'))
    return sorted(options, key=lambda item: (-item['lower'], -sum(l['probability'] for l in item['legs']), -item['upper']))[:3]


def board(game, report, extensions, now, validated, contexts=None):
    if not report or not fresh(report.get('generated_at'), now):
        return dict(signal='none', reason='Fresh pregame player projections are unavailable.', options={})
    candidates = legs_for(game, report, extensions, contexts or {})
    options = {str(count): combos for count in (2, *range(5, 11)) if (combos := combinations(candidates, count))}
    top = options.get('2', [None])[0]
    if top is None:
        return dict(signal='none', reason='Fewer than two distinct players have usable forecasts.', options={})
    qualifies = top['lower'] >= MIN_BOUND and all(leg['role_verified'] for leg in top['legs'])
    strong = qualifies and validated
    reason = ('The leading two-leg option passed the bounds, role and historical checks.' if strong else
              'The leading two-leg option needs more graded games to validate the signal.' if qualifies else
              'The leading two-leg option has a lower bound below 55% or a role without first-unit evidence.')
    return dict(signal='strong' if strong else 'limited', reason=reason, options=options,
                eligible_for_validation=qualifies, forecast_at=report['generated_at'])


def signal_evidence(root):
    grades = []
    for path in (root / 'same_game').glob('*.json'):
        for row in read(path).get('games', {}).values():
            if row.get('eligible_for_validation'):
                status = row['options']['2'][0]['result']
                if status in ('hit', 'miss'):
                    grades.append(status == 'hit')
    n = len(grades)
    if n < MIN_GAMES:
        return False
    p = sum(grades) / n
    z = 1.96
    lower = (p + z*z/(2*n) - z * math.sqrt(p*(1-p)/n + z*z/(4*n*n))) / (1+z*z/n)
    return lower >= .5


def publish(root=PUBLIC, clock=None, validated=None):
    now = stamp(clock or utcnow())
    slate = read(root / 'predictions.json')
    if not slate:
        return
    season, week = slate['season'], slate['week']
    path = root / 'same_game' / f'{season}-week-{week}.json'
    old = read(path).get('games', {})
    research = read(root / 'matchup_research.json')
    extended = read(root / 'player_extensions.json')
    insights = read(root / 'forecast_insights.json')
    identity = (season, week)
    reports = research.get('games', {}) if (research.get('season'), research.get('week')) == identity else {}
    extensions = {}
    if (extended.get('season'), extended.get('week')) == identity and fresh(extended.get('generated_at'), now):
        extensions = {(e['game_id'], e['player_id'], e['team'], e['opponent']): e for e in extended['players']}
    contexts = {}
    if (insights.get('season'), insights.get('week')) == identity and fresh(insights.get('exported_at'), now):
        contexts = {(c['game_id'], c['player_id'], c['team'], c['opponent']): c for c in insights.get('players', [])}
    validated = signal_evidence(root) if validated is None else validated
    games = dict(old)
    for game in slate['games']:
        gid = game['game_id']
        report = reports.get(gid)
        start = timestamp(report.get('kickoff')) if report else None
        saved_start = timestamp(old.get(gid, {}).get('kickoff'))
        if (saved_start and now >= saved_start) or (start and now >= start):
            continue
        if start is None:
            continue
        snapshot = board(game, report, extensions, now, validated, contexts)
        games[gid] = dict(snapshot, kickoff=report['kickoff'], saved_at=now.isoformat())
    write_json(path, dict(season=season, week=week, games=games))


def grade_saved(schedules, stats, now, root=PUBLIC):
    index = defaultdict(list)
    for row in stats:
        if row.get('season_type', 'REG') == 'REG':
            index[(row['season'], row['week'], team_name(row.get('team', row.get('recent_team'))), row.get('player_id'))].append(row)
    for path in (root / 'same_game').glob('*.json'):
        payload = read(path)
        changed = False
        for gid, game in payload['games'].items():
            source = schedules.get(gid)
            if not source or not stamp(game['saved_at']) < stamp(game['kickoff']):
                continue
            result = normalize_result(source, now)['status']
            if result not in ('final', 'cancelled'):
                continue
            for options in game['options'].values():
                for option in options:
                    for leg in option['legs']:
                        matches = index[(source['season'], source['week'], leg['team'], leg['player_id'])]
                        stats_row = matches[0] if len(matches) == 1 else {}
                        if leg['stat'] == 'scoring_tds':
                            values = [stats_row.get(stat) for stat in ('rushing_tds', 'receiving_tds')]
                            actual = sum(values) if all(number(value) for value in values) else None
                        else:
                            actual = stats_row.get(leg['stat'])
                        if result == 'final' and number(actual) and leg.get('actual') != actual:
                            leg['actual'] = actual
                            changed = True
                    legs = option['legs']
                    if result == 'cancelled':
                        status = 'cancelled'
                    elif any('actual' not in leg for leg in legs):
                        status = 'incomplete'
                    else:
                        status = 'hit' if all(l['actual'] >= l['threshold'] for l in legs) else 'miss'
                    if option['result'] != status:
                        option['result'] = status
                        changed = True
        if changed:
            write_json(path, payload)


if __name__ == '__main__':
    publish()
