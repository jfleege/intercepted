"""Dated, sourced roster moves supplement completed-game team observations."""
import json
from datetime import date
from src.ml.refresh_performance import ROOT, kickoff, stamp

TEAMS = set('ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LA LAC LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split())


def load_transactions(root=ROOT):
    path = root / 'data/inputs/roster_transactions.json'
    if not path.exists():
        return []
    payload = json.loads(path.read_text())
    if payload.get('schema_version') != 1 or not isinstance(payload.get('transactions'), list):
        raise ValueError('Unsupported roster transaction schema')
    seen = set()
    for row in payload['transactions']:
        identity = (row['player_id'], row['effective_date'])
        if identity in seen:
            raise ValueError('Duplicate or conflicting roster transaction')
        seen.add(identity)
        if not row['player_id'] or not row['name'] or not row['position']:
            raise ValueError('Roster transaction requires an identified player')
        if row['from_team'] not in TEAMS or row['to_team'] not in TEAMS or row['from_team'] == row['to_team']:
            raise ValueError('Invalid roster transaction teams')
        if not row['source'].startswith('https://') or row.get('status') not in ('announced', 'pending_physical'):
            raise ValueError('Roster transaction requires a source and explicit status')
        effective = date.fromisoformat(row['effective_date'])
        if effective.year != row['season'] or effective > stamp(row['observed_at']).date():
            raise ValueError('Roster transaction date must precede its observation')
    return sorted(payload['transactions'], key=lambda row: (row['effective_date'], row['player_id']))


def active_transactions(transactions, season, now):
    return [row for row in transactions if row['season'] == season
            and stamp(row['observed_at']) <= stamp(now) and row['effective_date'] <= stamp(now).date().isoformat()]


def assigned_team(player_id, observed_team, transactions, last_played=None):
    """Later completed appearances supersede an older move; old statistics stay intact."""
    moves = [row for row in transactions if row['player_id'] == player_id]
    if not moves:
        return observed_team
    latest = max(moves, key=lambda row: row['effective_date'])
    if last_played and str(last_played)[:10] > latest['effective_date']:
        return observed_team
    return latest['to_team']


def game_transactions(game, transactions, now):
    start = kickoff(game)
    cutoff = min(stamp(now), stamp(start)) if start else stamp(now)
    return [row for row in active_transactions(transactions, game['season'], cutoff.isoformat())
            if (not start or stamp(row['observed_at']) < stamp(start))
            and (game['home_team'] in (row['from_team'], row['to_team'])
                 or game['away_team'] in (row['from_team'], row['to_team']))]


def changed_transaction_games(current, games, transactions, now):
    previous = {game['game_id']: game for game in current['games']}
    return [game for game in games if game['game_id'] in previous
            and kickoff(game) and stamp(kickoff(game)) > stamp(now)
            and game_transactions(game, transactions, now) != previous[game['game_id']].get('roster_changes', [])]
