import json
import tempfile
import unittest
from pathlib import Path
from src.ml.refresh_status import start, finish, forecast_check, next_check, next_weekly_refresh, STATUS
from src.ml.refresh_performance import write_json

NOW = '2026-10-27T13:30:00+00:00'
GOOD = {key: 'success' for key in ('verify', 'forecast', 'results', 'history', 'players', 'research', 'teams', 'directory', 'research_results', 'markets')}

class RefreshStatusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        write_json(self.root / 'frontend/public/predictions.json', {'season': 2026, 'week': 7, 'generated_at': '2026-10-20T14:00:00Z', 'features_through_week': 6})
    def tearDown(self):
        self.temp.cleanup()
    def test_snapshot_never_invents_a_success(self):
        value = finish(NOW, root=self.root)
        self.assertIsNone(value['last_successful_refresh_at'])
        self.assertEqual(value['attempt']['state'], 'unknown')
        self.assertIsNone(value['forecast_check'])
        self.assertIsNone(value['sources'][1]['updated_at'])
    def test_waiting_stats_preserves_active_week_and_success_is_pipeline_not_rollover(self):
        forecast_check({'season': 2026, 'week': 7}, 2026, 8, 'waiting_stats', 'QB statistics missing 2 completed team-weeks', NOW, root=self.root)
        start('full', NOW, self.root)
        value = finish(NOW, GOOD, self.root)
        self.assertEqual(value['active_week'], 7)
        self.assertEqual(value['forecast_check']['target_week'], 8)
        self.assertEqual(value['last_successful_refresh_at'], NOW)
        self.assertEqual(value['sources'][0]['updated_at'], '2026-10-20T14:00:00Z')
    def test_failed_or_skipped_required_steps_never_advance_last_success(self):
        start('full', NOW, self.root)
        finish(NOW, GOOD, self.root)
        for outcome in ('failure', 'skipped'):
            later = '2026-10-28T13:30:00+00:00'
            start('full', later, self.root)
            value = finish(later, {**GOOD, 'research': outcome}, self.root)
            self.assertEqual(value['last_successful_refresh_at'], NOW)
            self.assertEqual(value['attempt']['state'], 'partial')
    def test_results_only_does_not_claim_full_refresh_and_skipped_odds_is_fine(self):
        start('results', NOW, self.root)
        value = finish(NOW, {k: 'success' for k in ('verify', 'results', 'history', 'research_results', 'markets')}, self.root)
        self.assertIsNone(value['last_successful_refresh_at'])
        self.assertEqual(value['last_results_refresh_at'], NOW)
        start('full', NOW, self.root)
        value = finish(NOW, {**GOOD, 'odds': 'skipped', 'props': 'skipped'}, self.root)
        self.assertEqual(value['last_successful_refresh_at'], NOW)
    def test_weekly_noon_preserves_chicago_wall_clock_across_dst(self):
        self.assertEqual(next_weekly_refresh('2026-10-27T16:59:59Z'), '2026-10-27T17:00:00+00:00')
        # Next Tuesday follows the fall transition: noon now maps to 18 UTC.
        self.assertEqual(next_weekly_refresh('2026-10-27T17:00:00Z'), '2026-11-03T18:00:00+00:00')
        self.assertEqual(next_weekly_refresh('2026-11-03T17:59:59Z'), '2026-11-03T18:00:00+00:00')
        # The spring transition changes noon back to 17 UTC.
        self.assertEqual(next_weekly_refresh('2027-03-09T18:00:00Z'), '2027-03-16T17:00:00+00:00')

    def test_next_check_includes_tuesday_noon_without_removing_daily_retry(self):
        self.assertEqual(next_check('2026-10-27T13:30:00Z'), '2026-10-27T17:00:00+00:00')
        self.assertEqual(next_check('2026-10-27T17:00:00Z'), '2026-10-28T13:17:00+00:00')
        self.assertEqual(next_check('2026-10-26T13:30:00Z'), '2026-10-27T13:17:00+00:00')

    def test_failed_rollover_checkpoint_retains_previous_success(self):
        start('full', NOW, self.root)
        finish(NOW, GOOD, self.root)
        later = '2026-10-27T17:30:00Z'
        start('full', later, self.root)
        value = finish(later, {**GOOD, 'pre_rollover': 'failure'}, self.root)
        self.assertEqual(value['last_successful_refresh_at'], NOW)
        self.assertEqual(value['attempt']['state'], 'partial')

    def test_next_check_fixed_utc_across_dst(self):
        self.assertEqual(next_check('2026-10-27T13:16:59Z'), '2026-10-27T13:17:00+00:00')
        self.assertEqual(next_check('2026-11-01T13:17:00Z'), '2026-11-02T13:17:00+00:00')

if __name__ == '__main__': unittest.main()
