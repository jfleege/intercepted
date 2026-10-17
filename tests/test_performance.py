import copy
import math
import tempfile
import unittest
from pathlib import Path

from src.ml.refresh_performance import archive, build_export, eligibility, graded_row, metrics, normalize_result


class PerformanceTests(unittest.TestCase):
    def setUp(self):
        self.game = {"game_id": "2026_06_SEA_DEN", "season": 2026, "week": 6, "game_date": "2026-10-15",
                     "home_team": "DEN", "away_team": "SEA", "probabilities": {"v4_a": .4, "v4_qb_plus": .3}}
        self.snapshot = {"snapshot_id": "original", "observed_at": "2026-10-14T12:00:00+00:00", "games": [self.game],
                         "model_identity": {"metadata": {"created_at_utc": "2026-10-09T12:00:00+00:00",
                         "latest_training_season": 2026, "latest_training_week": 5}}, "provenance": {"kind": "git_commit"}}
        self.source = {"game_id": self.game["game_id"], "season": 2026, "week": 6, "gameday": "2026-10-15",
                       "gametime": "20:15", "home_team": "DEN", "away_team": "SEA", "home_score": 10, "away_score": 20, "result": -10}
        self.result = normalize_result(self.source, "2026-10-17T12:00:00+00:00")

    def test_eastern_kickoff_and_future_score_guard(self):
        self.assertEqual(self.result["kickoff"], "2026-10-16T00:15:00+00:00")
        self.assertEqual(normalize_result(self.source, "2026-10-15T12:00:00+00:00")["status"], "pending")

    def test_only_final_results_are_graded(self):
        for field in ("result", "home_score", "away_score"):
            source = {**self.source, field: None}
            row = graded_row(self.snapshot, self.game, normalize_result(source, "2026-10-17T12:00:00+00:00"), "v4_qb_plus")
            self.assertIsNone(row["brier"])
            self.assertEqual(row["grade"], "pending")

    def test_grading_and_metrics(self):
        row = graded_row(self.snapshot, self.game, self.result, "v4_qb_plus")
        self.assertEqual(row["grade"], "correct")
        self.assertAlmostEqual(row["brier"], .09)
        self.assertAlmostEqual(row["log_loss"], -math.log(.7))
        values = metrics([row])
        self.assertEqual(values["summary"]["accuracy"], 1)
        self.assertEqual(values["trend"][0]["game_number"], 1)
        self.assertEqual(values["weekly"][0]["games"], 1)
        self.assertEqual(values["calibration"][0]["observed"], 0)

    def test_ties_and_cancelled_excluded(self):
        tied = {**self.result, "home_score": 20}
        row = graded_row(self.snapshot, self.game, tied, "v4_a")
        self.assertEqual(row["grade"], "tie")
        self.assertIsNone(row["outcome"])
        self.assertEqual(metrics([row])["summary"]["ties"], 1)
        self.assertIsNone(metrics([row])["summary"]["accuracy"])
        row = graded_row(self.snapshot, self.game, {**self.result, "status": "cancelled"}, "v4_a")
        self.assertIsNone(row["brier"])

    def test_late_and_unknown_evidence_not_live(self):
        snapshot = {**self.snapshot, "observed_at": "2026-10-17T12:00:00+00:00"}
        self.assertEqual(eligibility(snapshot, self.game, self.result)[0], "retrospective")
        self.assertEqual(eligibility(self.snapshot, self.game, None)[0], "unverified")
        self.assertEqual(eligibility(self.snapshot, self.game, {**self.result, "kickoff": None})[0], "unverified")

    def test_training_cutoff_and_wrong_teams(self):
        snap = copy.deepcopy(self.snapshot)
        snap["model_identity"]["metadata"]["latest_training_week"] = 6
        self.assertEqual(eligibility(snap, self.game, self.result)[0], "unverified")
        with self.assertRaises(ValueError):
            eligibility(self.snapshot, self.game, {**self.result, "home_team": "CHI"})

    def test_first_verified_forecast_frozen_across_revisions(self):
        revised = copy.deepcopy(self.snapshot)
        revised["snapshot_id"] = "revision"
        revised["observed_at"] = "2026-10-15T12:00:00+00:00"
        revised["games"][0]["probabilities"]["v4_a"] = .9
        with tempfile.TemporaryDirectory() as temp:
            data = build_export([revised, self.snapshot], {self.game["game_id"]: self.result}, Path(temp))
        original = data["datasets"]["verified"]["v4_a"]
        self.assertEqual(original["summary"]["games"], 1)
        self.assertEqual(original["rows"][0]["probability"], .4)

    def test_archive_idempotent_and_invalid_rejected(self):
        payload = {"games": [{**{k: v for k, v in self.game.items() if k != "probabilities"},
                              "home_win_prob_v4_a": .4, "home_win_prob_v4_qb_plus": .3}]}
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            first = archive(payload, {}, "2026-10-14T12:00:00+00:00", {}, root)
            second = archive(payload, {}, "2026-10-15T12:00:00+00:00", {}, root)
            self.assertEqual(first, second)
            self.assertEqual(len(list((root / "data/tracking/forecasts").glob("*.json"))), 1)
            payload["games"][0]["home_win_prob_v4_a"] = float("nan")
            with self.assertRaises(ValueError):
                archive(payload, {}, "2026-10-14T12:00:00+00:00", {}, root)

    def test_result_corrections_change_metrics_not_forecast(self):
        corrected = {**self.result, "home_score": 30}
        before = graded_row(self.snapshot, self.game, self.result, "v4_a")
        after = graded_row(self.snapshot, self.game, corrected, "v4_a")
        self.assertEqual(before["probability"], after["probability"])
        self.assertEqual(after["grade"], "incorrect")

    def test_earlier_git_evidence_preserved_without_overwriting_archive(self):
        payload = {"games": [{**{k: v for k, v in self.game.items() if k != "probabilities"},
                              "home_win_prob_v4_a": .4, "home_win_prob_v4_qb_plus": .3}]}
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            late = archive(payload, {}, "2026-10-17T12:00:00+00:00", {"kind": "refresh"}, root)
            early = archive(payload, {}, "2026-10-14T12:00:00+00:00", {"kind": "git_commit"}, root)
            self.assertNotEqual(late["snapshot_id"], early["snapshot_id"])
            self.assertEqual(archive(payload, {}, "2026-10-14T12:00:00+00:00", {"kind": "git_commit"}, root), early)
            self.assertEqual(len(list((root / "data/tracking/forecasts").glob("*.json"))), 2)

    def test_timestamp_order_uses_instants_not_timezone_strings(self):
        earlier = copy.deepcopy(self.snapshot)
        earlier["observed_at"] = "2026-10-14T10:00:00-05:00"  # 15:00 UTC
        earlier["snapshot_id"] = "later"
        earlier["games"][0]["probabilities"]["v4_a"] = .9
        with tempfile.TemporaryDirectory() as temp:
            data = build_export([earlier, self.snapshot], {self.game["game_id"]: self.result}, Path(temp))
        self.assertEqual(data["datasets"]["verified"]["v4_a"]["rows"][0]["snapshot_id"], "original")


if __name__ == "__main__":
    unittest.main()
