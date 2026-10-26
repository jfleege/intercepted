"""Cache each game's DraftKings props once per slate, with fail-closed quota guards."""
import argparse
import json
import math
import os
import re
from datetime import datetime
from zoneinfo import ZoneInfo
from src.ml.odds_client import OddsClient, OddsError, TEAMS
from src.ml.refresh_performance import ROOT, stamp, utcnow, write_json

MARKETS = ('player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_anytime_td')
MAX_WEEKLY = 64
MAX_MONTHLY = 320  # App cap by Central calendar month, not a claim about billing reset dates.
RESERVE = 100  # Enough for 31 daily 3-credit requests plus a small margin.
CACHE = 'frontend/public/player_props.json'
STATE = 'data/tracking/prop_refresh_state.json'


def load(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def event_matches(event, game, report):
    try:
        return (event['home_team'] == TEAMS[game['home_team']]
                and event['away_team'] == TEAMS[game['away_team']]
                and stamp(event['commence_time']) == stamp(report['kickoff'])
                and bool(re.fullmatch(r'[A-Za-z0-9_-]{1,128}', event['id'])))
    except (KeyError, TypeError, ValueError):
        return False


def normalize(event, game, report, observed_at):
    if not event_matches(event, game, report):
        raise ValueError('Event identity or kickoff changed; quote rejected.')
    book = next((b for b in event.get('bookmakers', []) if b.get('key') == 'draftkings'), {})
    markets = []
    for market in book.get('markets', []):
        key = market.get('key')
        if key not in MARKETS:
            continue
        try:
            if stamp(market.get('last_update')) > stamp(observed_at):
                continue
        except (ValueError, TypeError):
            continue
        outcomes = []
        for outcome in market.get('outcomes', []):
            name, person, price = outcome.get('name'), outcome.get('description'), outcome.get('price')
            if not isinstance(person, str) or not person.strip() or not finite(price) or abs(price) < 100:
                continue
            if key == 'player_anytime_td':
                if name not in ('Yes', 'No'):
                    continue
                outcomes.append({'name': name, 'description': person.strip(), 'price': price})
            elif name in ('Over', 'Under') and finite(outcome.get('point')) and outcome['point'] >= 0:
                outcomes.append({'name': name, 'description': person.strip(), 'price': price, 'point': outcome['point']})
        if outcomes:
            markets.append({'key': key, 'last_update': market['last_update'], 'outcomes': outcomes})
    return {'event_id': event['id'], 'home_team': game['home_team'], 'away_team': game['away_team'],
            'kickoff': report['kickoff'], 'observed_at': observed_at, 'bookmaker': 'DraftKings', 'markets': markets}


def can_request(usage, weekly_reserved, monthly_reserved):
    remaining = usage.get('remaining')
    return (isinstance(remaining, int) and not isinstance(remaining, bool)
            and remaining - len(MARKETS) >= RESERVE
            and weekly_reserved + len(MARKETS) <= MAX_WEEKLY
            and monthly_reserved + len(MARKETS) <= MAX_MONTHLY)


def refresh(root=ROOT, client=None, now=None, allow_early=False):
    now = now or utcnow()
    local = stamp(now).astimezone(ZoneInfo('America/Chicago'))
    if not allow_early and local.weekday() in (1, 2):
        return {'status': 'not_due'}  # Start Thursday; late/missing event discovery can catch up through Monday.
    data = load(root / 'frontend/public/predictions.json', {})
    season, week = data.get('season'), data.get('week')
    report = load(root / f'frontend/public/research/{season}-week-{week}.json', {})
    if report.get('season') != season or report.get('week') != week:
        return {'status': 'research_unavailable'}
    games = []
    for game in data.get('games', []):
        r = report.get('games', {}).get(game['game_id'], {})
        try:
            if (r['scoring']['home']['team'] == game['home_team'] and r['scoring']['away']['team'] == game['away_team']
                    and stamp(now) < stamp(r['kickoff'])):
                games.append((game, r))
        except (KeyError, TypeError, ValueError):
            continue
    if not games:
        return {'status': 'no_upcoming_games'}
    state = load(root / STATE, {'schema_version': 1, 'attempts': {}})
    if state.get('schema_version') != 1 or not isinstance(state.get('attempts'), dict):
        raise ValueError('Prop quota ledger is unreadable; no requests made.')
    attempts = state['attempts']
    if state.get('blocked_reason') == 'usage_unverified':
        return {'status': 'usage_unverified'}
    # Validate the ledger before spending credits, including reservations made before a failed request.
    if any(not isinstance(a, dict) or a.get('reserved') != 4 or not isinstance(a.get('month'), str)
           or not isinstance(a.get('slate'), str) or not re.fullmatch(r'\d{4}-\d{2}', a['month'])
           or not re.fullmatch(r'\d{4}:\d{1,2}', a['slate']) for a in attempts.values()):
        raise ValueError('Prop quota ledger is unreadable; no requests made.')
    slate, month = f'{season}:{week}', local.strftime('%Y-%m')
    pending = [(g, r) for g, r in games if f"{slate}:{g['game_id']}" not in attempts]
    if not pending:
        return {'status': 'cached'}
    previous = load(root / CACHE, {})
    if not isinstance(previous, dict) or not isinstance(previous.get('games', {}), dict):
        raise ValueError('Prop cache is unreadable; no requests made.')
    cached = previous.get('games', {}) if previous.get('season') == season and previous.get('week') == week else {}
    output = {'schema_version': 1, 'season': season, 'week': week, 'exported_at': now,
              'bookmaker': 'DraftKings', 'market_keys': list(MARKETS), 'games': cached,
              'policy': {'weekly_cap': MAX_WEEKLY, 'monthly_cap': MAX_MONTHLY, 'reserve': RESERVE,
                         'refresh': 'Each game once per NFL slate; cached prices are not live.'}, 'status': 'checking'}
    client = client or OddsClient(os.getenv('ODDS_API_KEY'), root=root)
    weekly = sum(a['reserved'] for a in attempts.values() if a['slate'] == slate)
    monthly = sum(a['reserved'] for a in attempts.values() if a['month'] == month)
    usage = client.balance()  # Documented zero-credit request; unknown balance stops all paid requests.
    if not can_request(usage, weekly, monthly):
        output['status'] = 'budget_blocked'
        write_json(root / CACHE, output)
        return output
    events, usage = client.request('sports/americanfootball_nfl/events/', kind='event_discovery')  # Zero credits.
    if not isinstance(events, list):
        raise OddsError('Event discovery returned an invalid response; no prop requests made.')
    output['status'] = 'no_matching_events'
    for game, r in sorted(pending, key=lambda pair: stamp(pair[1]['kickoff'])):
        matches = [e for e in events if event_matches(e, game, r)]
        if len(matches) != 1:
            continue
        if stamp(client.now()) >= stamp(r['kickoff']):
            continue
        if not can_request(usage, weekly, monthly):
            output['status'] = 'budget_blocked'
            break
        event = matches[0]
        key = f"{slate}:{game['game_id']}"
        # Reserve before the network request. Failed/empty attempts are never automatically repeated.
        attempt = {'slate': slate, 'month': month, 'reserved': 4, 'at': now, 'status': 'requested'}
        attempts[key] = attempt
        weekly += 4
        monthly += 4
        write_json(root / STATE, state)
        try:
            response, usage = client.request(f"sports/americanfootball_nfl/events/{event['id']}/odds/",
                                            {'bookmakers': 'draftkings', 'regions': 'us', 'markets': ','.join(MARKETS), 'oddsFormat': 'american'}, kind='player_props')
            observed = usage.get('observed_at', now)
            quote = normalize(response, game, r, observed)
            cached[game['game_id']] = quote
            attempt.update(status='cached' if quote['markets'] else 'empty', reported_cost=usage.get('last_cost'))
            output['status'] = 'cached'
            if not isinstance(usage.get('last_cost'), int) or isinstance(usage.get('last_cost'), bool) or not 0 <= usage['last_cost'] <= 4:
                output['status'] = 'usage_unverified'
                state['blocked_reason'] = 'usage_unverified'
                break
        except (OddsError, ValueError, TypeError):
            attempt['status'] = 'failed'
            output['status'] = 'partial_failure'
            break  # No retries; request may have consumed credits.
        finally:
            write_json(root / STATE, state)
            write_json(root / CACHE, output)
    output['weekly_reserved'] = weekly
    output['monthly_reserved'] = monthly
    write_json(root / CACHE, output)
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--now', action='store_true', help='Allow initial fetch on Tuesday/Wednesday; never bypass budgets or cache.')
    args = parser.parse_args()
    try:
        result = refresh(allow_early=args.now)
        print('Player props:', result['status'])
    except (OddsError, ValueError) as error:
        print(str(error))


if __name__ == '__main__':
    main()
