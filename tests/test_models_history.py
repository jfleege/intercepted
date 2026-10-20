import copy
import json
import tempfile
import unittest
from pathlib import Path
from src.ml.refresh_performance import archive, build_export, eligibility, write_json
from src.ml.export_prediction_history import export_history
from src.features.model_context import context_features

GAME = {"game_id": "2026_06_SEA_DEN", "season": 2026, "week": 6, "game_date": "2026-10-18",
        "home_team": "DEN", "away_team": "SEA", "home_win_prob_v4_a": .6, "home_win_prob_v4_qb_plus": .4}
META = {"created_at_utc": "2026-10-09T00:00:00+00:00", "latest_training_season": 2026, "latest_training_week": 5}
RESULT = {"home_team": "DEN", "away_team": "SEA", "kickoff": "2026-10-18T17:00:00+00:00",
          "season": 2026, "week": 6, "status": "final", "home_score": 20, "away_score": 10}

class ModelHistoryTests(unittest.TestCase):
    def test_legacy_archive_is_not_backfilled_with_new_models(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            old = archive({"games": [GAME]}, META, "2026-10-14T12:00:00+00:00", {}, root=root)
            write_json(root / "data/tracking/results.json", {"games": {GAME["game_id"]: RESULT}})
            index = export_history(root)
            self.assertEqual(set(index["weeks"][0]["models"]), {"v4_a", "v4_qb_plus"})
            saved = json.loads((root / "frontend/public/predictions/2026-week-6.json").read_text())
            self.assertNotIn("home_win_prob_v5_boosted", saved["games"][0])
            original_bytes = (root / "data/tracking/forecasts" / f'{old["snapshot_id"]}.json').read_bytes()
            # Later revised predictions appear in the browsing export; verified scoring stays first.
            archive({"games": [{**GAME, "home_win_prob_v4_a": .8}]}, META, "2026-10-17T12:00:00+00:00", {}, root=root)
            # A post-kickoff revision must not replace the pregame browsing forecast.
            archive({"games": [{**GAME, "home_win_prob_v4_a": .1}]}, META, "2026-10-19T12:00:00+00:00", {}, root=root)
            export_history(root)
            saved = json.loads((root / "frontend/public/predictions/2026-week-6.json").read_text())
            self.assertEqual(saved["games"][0]["home_win_prob_v4_a"], .8)
            snapshots = [json.loads(p.read_text()) for p in (root / "data/tracking/forecasts").glob("*.json")]
            perf = build_export(snapshots, {GAME["game_id"]: RESULT}, root)
            self.assertEqual(perf["datasets"]["verified"]["v4_a"]["rows"][0]["probability"], .6)
            self.assertEqual(perf["datasets"]["verified"]["v5_boosted"]["summary"]["games"], 0)
            self.assertEqual(original_bytes, (root / "data/tracking/forecasts" / f'{old["snapshot_id"]}.json').read_bytes())

    def test_each_model_has_its_own_cutoff_and_creation_date(self):
        with tempfile.TemporaryDirectory() as temp:
            metadata = {**META, "models": {"v5_boosted": {"latest_training_week": 6, "created_at_utc": "2026-10-20T12:00:00+00:00"}}}
            snap = archive({"games": [{**GAME, "home_win_prob_v5_boosted": .7}]}, metadata,
                           "2026-10-21T12:00:00+00:00", {}, root=Path(temp))
            self.assertEqual(eligibility(snap, snap["games"][0], RESULT, "v5_boosted")[0], "unverified")
            future_game = {**snap["games"][0], "week": 7}
            future_result = {**RESULT, "kickoff": "2026-10-25T17:00:00+00:00"}
            self.assertEqual(eligibility(snap, future_game, future_result, "v5_boosted")[0], "verified")

    def test_schedule_context_has_no_future_dependence(self):
        game = {"season": 2026, "week": 7, "gameday": "2026-10-25", "home_team": "DEN", "away_team": "KC", "location": "Home"}
        prior = [{"season": 2026, "week": 6, "game_type": "REG", "gameday": "2026-10-18", "home_team": "DEN", "away_team": "KC"}]
        expected = context_features(game, prior)
        self.assertEqual(expected["rest_diff"], 0)
        self.assertEqual(expected["division_game"], 1)
        future = {**prior[0], "week": 8, "gameday": "2026-11-01"}
        self.assertEqual(expected, context_features(game, prior + [future]))

if __name__ == "__main__":
    unittest.main()
