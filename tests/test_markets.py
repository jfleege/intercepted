import json
import tempfile
import unittest
from pathlib import Path

from src.ml.refresh_markets import archive_odds, decimal, grade, paper_record, quote_ready, refresh, summary
from src.ml.refresh_performance import archive, write_json

NOW = '2026-10-18T12:00:00+00:00'
START = '2026-10-18T17:00:00+00:00'
GAME = {'game_id': '2026_06_SEA_DEN', 'season': 2026, 'week': 6, 'game_date': '2026-10-18', 'home_team': 'DEN', 'away_team': 'SEA', 'home_win_prob_v4_a': .6, 'home_win_prob_v4_qb_plus': .4}
META = {'latest_training_season': 2026, 'latest_training_week': 5, 'created_at_utc': '2026-10-09T00:00:00+00:00'}
QUOTE = {'home_moneyline': -120, 'away_moneyline': 110, 'commence_time': START, 'last_update': '2026-10-18T11:55:00+00:00', 'bookmaker': 'DraftKings'}
RESULT = {'home_team': 'DEN', 'away_team': 'SEA', 'status': 'pending', 'kickoff': START}
LINE = {'game_id': GAME['game_id'], 'home_team': 'DEN', 'away_team': 'SEA', 'kickoff': START, 'home_price': -120, 'away_price': 110, 'bookmaker': 'DraftKings', 'probabilities': {'v4_a': .6, 'v4_qb_plus': .4}, 'observed_at': NOW, 'odds_snapshot_id': 'quote', 'forecast_snapshot_id': 'forecast'}

class MarketsTests(unittest.TestCase):
    def test_prices(self):
        self.assertAlmostEqual(decimal(-200), 1.5)
        self.assertAlmostEqual(decimal(150), 2.5)
        for bad in (True, 0, 99, float('nan'), float('inf'), '100'):
            with self.assertRaises(ValueError): decimal(bad)

    def test_freshness_and_kickoff(self):
        snap = {'observed_at': NOW, 'exported_at': NOW}
        self.assertTrue(quote_ready(snap, QUOTE, RESULT, NOW))
        for now in (START, '2026-10-18T11:00:00+00:00'):
            self.assertFalse(quote_ready(snap, QUOTE, RESULT, now))
        self.assertFalse(quote_ready(snap, {**QUOTE, 'last_update': '2026-10-16T00:00:00+00:00'}, RESULT, NOW))
        self.assertFalse(quote_ready(snap, {**QUOTE, 'last_update': '2026-10-18T13:00:00+00:00'}, RESULT, NOW))
        self.assertFalse(quote_ready(snap, QUOTE, {**RESULT, 'kickoff': '2026-10-18T18:00:00+00:00'}, NOW))

    def test_original_price_and_grades(self):
        record = paper_record(LINE, 'v4_qb_plus', 'SEA', NOW, 2)
        win = grade(record, {**RESULT, 'status': 'final', 'home_score': 10, 'away_score': 20})
        loss = grade(record, {**RESULT, 'status': 'final', 'home_score': 20, 'away_score': 10})
        push = grade(record, {**RESULT, 'status': 'final', 'home_score': 20, 'away_score': 20})
        void = grade(record, {**RESULT, 'status': 'cancelled'})
        self.assertAlmostEqual(win['profit'], 2.2)
        self.assertEqual(loss['profit'], -2)
        self.assertEqual((push['grade'], push['profit']), ('push', 0))
        self.assertEqual((void['grade'], void['profit']), ('void', 0))
        self.assertIsNone(grade(record, RESULT)['profit'])
        self.assertAlmostEqual(summary([win, loss, push, void])['roi'], .05)
        self.assertEqual(summary([push, void])['roi'], None)

    def test_record_validation(self):
        for kwargs in ({'now': START}, {'now': NOW, 'stake': -1}, {'now': NOW, 'stake': float('inf')}):
            with self.assertRaises(ValueError): paper_record(LINE, 'v4_a', 'DEN', **kwargs)

    def seed(self, root):
        archive({'games': [GAME]}, META, '2026-10-17T12:00:00+00:00', {'kind': 'test'}, root=root)
        write_json(root/'frontend/public/odds.json', {'exported_at': NOW, 'games': {GAME['game_id']: QUOTE}})
        write_json(root/'data/tracking/results.json', {'games': {GAME['game_id']: RESULT}})

    def test_snapshots_idempotent_and_not_backdated(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            p = {'exported_at': '2026-10-01T12:00:00+00:00', 'games': {}}
            first = archive_odds(p, root, NOW)
            again = archive_odds(p, root, START)
            self.assertEqual(first, again)
            self.assertEqual(first['observed_at'], NOW)

    def test_ledger_dedup_frozen_price_custom_and_corrections(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); self.seed(root)
            first = refresh(root, NOW)
            self.assertEqual(len(first['selections']), 2)
            self.assertAlmostEqual(first['lines'][0]['home_market_probability'] + first['lines'][0]['away_market_probability'], 1)
            later = '2026-10-18T13:00:00+00:00'
            write_json(root/'frontend/public/odds.json', {'exported_at': later, 'games': {GAME['game_id']: {**QUOTE, 'away_moneyline': 150}}})
            second = refresh(root, later, (GAME['game_id'], 'SEA', 'v4_qb_plus', 2))
            self.assertEqual(len(second['selections']), 3)
            self.assertEqual(next(r for r in second['selections'] if r['kind']=='baseline' and r['model']=='v4_qb_plus')['price'], 110)
            self.assertEqual(next(r for r in second['selections'] if r['kind']=='manual')['price'], 150)
            result = {**RESULT, 'status': 'final', 'home_score': 10, 'away_score': 20}
            write_json(root/'data/tracking/results.json', {'games': {GAME['game_id']: result}})
            final = refresh(root, '2026-10-19T00:00:00+00:00')
            self.assertEqual(len(final['selections']), 3)
            self.assertEqual(next(r for r in final['selections'] if r['kind']=='manual')['profit'], 3)
            with self.assertRaises(ValueError): refresh(root, START, (GAME['game_id'], 'SEA', 'v4_a', 1))
            write_json(root/'data/tracking/results.json', {'games': {GAME['game_id']: {**result, 'home_score': 30}}})
            corrected = refresh(root, '2026-10-19T01:00:00+00:00')
            self.assertEqual(next(r for r in corrected['selections'] if r['kind']=='manual')['profit'], -2)

    def test_no_hindsight_or_stale_picks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); self.seed(root)
            data = refresh(root, START)
            self.assertEqual(data['selections'], [])
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); self.seed(root)
            write_json(root/'frontend/public/odds.json', {'exported_at': NOW, 'games': {GAME['game_id']: {**QUOTE, 'last_update': '2026-10-01T00:00:00+00:00'}}})
            self.assertEqual(refresh(root, NOW)['selections'], [])

if __name__ == '__main__': unittest.main()
