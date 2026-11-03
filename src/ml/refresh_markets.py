"""Immutable moneyline quotes and paper records. Never calls an odds provider."""
import argparse
import json
import math
from datetime import timedelta

from src.ml.refresh_performance import ROOT, MODELS, digest, eligibility, stamp, utcnow, write_json

MAX_AGE = timedelta(hours=24)


def decimal(price):
    if isinstance(price, bool) or not isinstance(price, (int, float)) or not math.isfinite(price) or abs(price) < 100:
        raise ValueError('Expected American moneyline price of at least +100 or at most -100')
    return 1 + (price / 100 if price > 0 else 100 / abs(price))


def archive_odds(payload, root=ROOT, now=None):
    """The collection clock is ours; never backdate an imported odds.json."""
    now = now or utcnow()
    core = {'exported_at': payload.get('exported_at'), 'games': payload.get('games', {})}
    identity = digest(core)
    path = root / 'data/tracking/odds' / f'{identity}.json'
    if path.exists():
        return json.loads(path.read_text())
    snapshot = {'snapshot_id': identity, 'observed_at': now, **core}
    write_json(path, snapshot)
    return snapshot


def quote_ready(snapshot, quote, result, now):
    try:
        observed, start = stamp(snapshot['observed_at']), stamp(quote['commence_time'])
        updated = stamp(quote.get('moneyline_last_update') or quote['last_update'])
        current = stamp(now)
        source_export = stamp(snapshot['exported_at'])
        if not result or not result.get('kickoff') or stamp(result['kickoff']) != start:
            return False
        if result['status'] != 'pending' or not (updated <= source_export <= observed <= current < start):
            return False
        if current - updated > MAX_AGE or current - observed > MAX_AGE:
            return False
        decimal(quote['home_moneyline']); decimal(quote['away_moneyline'])
        return True
    except (KeyError, TypeError, ValueError):
        return False


def comparison(snapshot, game_id, quote, forecast, game):
    home, away = quote['home_moneyline'], quote['away_moneyline']
    hi, ai = 1 / decimal(home), 1 / decimal(away)
    return {'game_id': game_id, 'home_team': game['home_team'], 'away_team': game['away_team'],
            'kickoff': quote['commence_time'], 'bookmaker': quote['bookmaker'], 'odds_snapshot_id': snapshot['snapshot_id'],
            'observed_at': snapshot['observed_at'], 'last_update': quote.get('moneyline_last_update') or quote.get('last_update'),
            'home_price': home, 'away_price': away, 'home_market_probability': hi/(hi+ai),
            'away_market_probability': ai/(hi+ai), 'probabilities': game['probabilities'],
            'forecast_snapshot_id': forecast['snapshot_id'], 'forecast_observed_at': forecast['observed_at']}


def paper_record(line, model, team, now, stake=1, kind='baseline'):
    if team not in (line['home_team'], line['away_team']) or model not in line['probabilities'] or model not in MODELS:
        raise ValueError('Invalid paper selection')
    if not math.isfinite(stake) or stake <= 0:
        raise ValueError('Stake must be positive paper units')
    if stamp(now) >= stamp(line['kickoff']) or stamp(now) < stamp(line['observed_at']):
        raise ValueError('Paper selections must be recorded before kickoff, after quote collection')
    home = team == line['home_team']
    price = line['home_price'] if home else line['away_price']
    decimal(price)
    p = line['probabilities'][model]
    record = {'kind': kind, 'game_id': line['game_id'], 'home_team': line['home_team'], 'away_team': line['away_team'],
              'team': team, 'model': model, 'stake': stake, 'price': price, 'bookmaker': line['bookmaker'],
              'model_probability': p if home else 1-p, 'recorded_at': now, 'kickoff': line['kickoff'],
              'odds_snapshot_id': line['odds_snapshot_id'], 'forecast_snapshot_id': line['forecast_snapshot_id']}
    record['selection_id'] = digest([kind, line['game_id'], model] if kind == 'baseline' else record)
    return record


def grade(record, result):
    """Two-way NFL moneyline ties are pushes here; no spreads or prop settlement."""
    grade, profit = 'pending', None
    if result and (result['home_team'], result['away_team']) != (record['home_team'], record['away_team']):
        raise ValueError('Paper settlement team identity mismatch')
    if result and result['status'] == 'cancelled':
        grade, profit = 'void', 0
    elif result and result['status'] == 'final':
        h, a = result['home_score'], result['away_score']
        if h == a:
            grade, profit = 'push', 0
        else:
            winner = result['home_team'] if h > a else result['away_team']
            grade = 'win' if record['team'] == winner else 'loss'
            profit = record['stake'] * (decimal(record['price']) - 1) if grade == 'win' else -record['stake']
    return {**record, 'grade': grade, 'profit': profit}


def summary(records):
    resolved = [r for r in records if r['grade'] != 'pending']
    risk = sum(r['stake'] for r in resolved if r['grade'] in ('win', 'loss'))
    profit = sum(r['profit'] for r in resolved)
    return {'selections': len(records), 'settled': len(resolved), 'wins': sum(r['grade'] == 'win' for r in records),
            'losses': sum(r['grade'] == 'loss' for r in records), 'pushes': sum(r['grade'] == 'push' for r in records),
            'voids': sum(r['grade'] == 'void' for r in records), 'profit': profit, 'risked_units': risk,
            'roi': profit / risk if risk else None}


def refresh(root=ROOT, now=None, custom=None):
    now = now or utcnow()
    odds_path = root / 'frontend/public/odds.json'
    if odds_path.exists():
        archive_odds(json.loads(odds_path.read_text()), root, now)
    snapshots = sorted((json.loads(p.read_text()) for p in (root / 'data/tracking/odds').glob('*.json')), key=lambda s: (stamp(s['observed_at']), s['snapshot_id']))
    forecasts = sorted((json.loads(p.read_text()) for p in (root / 'data/tracking/forecasts').glob('*.json')), key=lambda s: stamp(s['observed_at']))
    results_path = root / 'data/tracking/results.json'
    results = json.loads(results_path.read_text())['games'] if results_path.exists() else {}
    directory = root / 'data/tracking/paper'
    records = {p.stem: json.loads(p.read_text()) for p in directory.glob('*.json')}
    latest = {}
    # Historical quotes are displayable; only a fresh, currently pregame quote can create a selection.
    for snapshot in snapshots:
        for game_id, quote in snapshot['games'].items():
            result = results.get(game_id)
            available = [(f, g) for f in forecasts for g in f['games'] if g['game_id'] == game_id
                         and stamp(f['observed_at']) <= stamp(now)
                         and any(eligibility(f, g, result, model)[0] == 'verified' for model in g['probabilities'])]
            if not available:
                continue
            forecast, game = available[-1]
            game = {**game, 'probabilities': {model: p for model, p in game['probabilities'].items()
                    if eligibility(forecast, game, result, model)[0] == 'verified'}}
            try:
                line = comparison(snapshot, game_id, quote, forecast, game)
            except (KeyError, ValueError):
                continue
            line['can_record'] = quote_ready(snapshot, quote, result, now)
            latest[game_id] = line
    # Run on the latest quote only. Do not invent historical baseline selections from archived quotes.
    for line in latest.values():
        if not line['can_record']:
            continue
        for model in line['probabilities']:
            if model not in MODELS:
                continue
            team = line['home_team'] if line['probabilities'][model] >= .5 else line['away_team']
            record = paper_record(line, model, team, now)
            if record['selection_id'] not in records:
                write_json(directory / f"{record['selection_id']}.json", record)
                records[record['selection_id']] = record
    if custom:
        game_id, team, model, stake = custom
        if game_id not in latest or not latest[game_id]['can_record']:
            raise ValueError('No fresh pregame quote available for this game')
        record = paper_record(latest[game_id], model, team, now, stake, 'manual')
        write_json(directory / f"{record['selection_id']}.json", record)
        records[record['selection_id']] = record
    graded = [grade(r, results.get(r['game_id'])) for r in records.values()]
    predictions_path = root / 'frontend/public/predictions.json'
    active_ids = [g['game_id'] for g in json.loads(predictions_path.read_text())['games']] if predictions_path.exists() else sorted(latest)
    payload = {'active_game_ids': active_ids, 'generated_at': now, 'snapshot_count': len(snapshots), 'lines': sorted(latest.values(), key=lambda l: l['kickoff']),
               'selections': sorted(graded, key=lambda r: (stamp(r['recorded_at']), r['selection_id']), reverse=True),
               'summary': {model: summary([r for r in graded if r['model'] == model and r['kind'] == 'baseline']) for model in MODELS},
               'results': results}
    write_json(root / 'frontend/public/markets.json', payload)
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--record-paper', nargs=2, metavar=('GAME_ID', 'TEAM'))
    parser.add_argument('--model', choices=MODELS, default='v4_qb_plus')
    parser.add_argument('--stake', type=float, default=1)
    args = parser.parse_args()
    payload = refresh(custom=(*args.record_paper, args.model, args.stake) if args.record_paper else None)
    print(f"Markets: {payload['snapshot_count']} archived quotes, {len(payload['selections'])} paper selections; no API calls.")


if __name__ == '__main__':
    main()
