import copy
from datetime import date
import unittest
from src.ml.projection_features import build_history, team_summary
from src.features.quarter_trends import quarter_trends

NOW = '2026-10-22T12:00:00+00:00'


def game(week, home_score=21, away_score=14):
    return {'game_id': f'2026_{week:02}_NE_CHI', 'season': 2026, 'week': week, 'gameday': f'2026-09-{week * 4:02}', 'gametime': '13:00',
            'game_type': 'REG', 'home_team': 'CHI', 'away_team': 'NE', 'home_score': home_score, 'away_score': away_score, 'result': home_score - away_score}


def player(week, team):
    return {'player_id': team, 'season': 2026, 'week': week, 'season_type': 'REG', 'team': team, 'position': 'QB', 'passing_yards': week * 100,
            'attempts': 30, 'passing_tds': 2, 'rushing_yards': 10, 'carries': 2, 'receiving_yards': 0}


class PregameFeaturesTests(unittest.TestCase):
    def build(self, schedules=None, players=None, week=5):
        schedules = schedules or [game(w) for w in range(1, 6)]
        players = players or [player(w, t) for w in range(1, 6) for t in ('NE', 'CHI')]
        return build_history(schedules, players, 2026, week, NOW)

    def test_current_game_outcomes_and_usage_cannot_enter_its_features(self):
        games = [game(w) for w in range(1, 6)]
        rows = [player(w, t) for w in range(1, 6) for t in ('NE', 'CHI')]
        first = self.build(games, rows)
        altered = copy.deepcopy(rows)
        for row in altered:
            if row['week'] == 4:
                row.update(passing_yards=9999, attempts=999, passing_tds=99)
        games[3].update(home_score=70, away_score=0, result=70)
        second = self.build(games, altered)
        self.assertEqual([r['x'] for r in first[0]], [r['x'] for r in second[0]])
        self.assertEqual([r['x'] for r in first[1]], [r['x'] for r in second[1]])
        self.assertNotEqual([r['y'] for r in first[0]], [r['y'] for r in second[0]])

    def test_player_prior_appearances_and_td_event_definitions(self):
        _, rows, _, _ = self.build()
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r['week'] == 4 and r['x']['recent_yards'] == 200 for r in rows))
        self.assertTrue(all(r['any_td'] == 0 and r['pass_td'] == 1 for r in rows))

    def test_both_teams_snapshot_before_any_update(self):
        score, _, _, _ = self.build()
        first_game = [r for r in score if r['week'] == 1]
        self.assertEqual([r['x']['own_points_season'] for r in first_game], [22, 22])
        self.assertEqual([r['x']['opp_points_season'] for r in first_game], [22, 22])

    def test_forecast_week_future_and_unfinished_games_excluded(self):
        schedule = [game(w) for w in range(1, 6)]
        schedule[1]['result'] = None
        score, _, team_history, _ = self.build(schedule)
        self.assertEqual({r['week'] for r in score}, {1, 3, 4})
        self.assertEqual(len(team_history['CHI']), 3)

    def test_source_input_not_mutated(self):
        schedule = [game(w) for w in range(1, 6)]
        original = copy.deepcopy(schedule)
        self.build(schedule)
        self.assertEqual(schedule, original)

    def test_season_blend_does_not_use_future_year(self):
        summary = team_summary({}, 'NE', 2026, date(2026, 9, 1))
        self.assertEqual(summary['points'], 22)
        self.assertEqual(summary['games'], 0)


class QuarterTrendTests(unittest.TestCase):
    def rows(self):
        scores = [(7, 0), (10, 7), (10, 14), (17, 17), (20, 17)]
        return [{'game_id': game(1)['game_id'], 'season_type': 'REG', 'qtr': i + 1, 'total_home_score': h, 'total_away_score': a,
                 'posteam': 'CHI', 'play_type': 'pass', 'epa': .2, 'success': 1} for i, (h, a) in enumerate(scores)]

    def test_quarters_sum_to_halves_and_overtime_is_separate(self):
        trends = quarter_trends(self.rows(), [game(1, 20, 17)], 2026)
        chi = trends['teams']['CHI']['history'][0]
        self.assertEqual([p['points_for'] for p in chi['periods']], [7, 3, 0, 7, 10, 7])
        self.assertEqual(chi['overtime_points_for'], 3)
        self.assertEqual(sum(p['points_for'] for p in chi['periods'][:4]) + chi['overtime_points_for'], 20)

    def test_mismatched_final_or_missing_quarter_is_excluded(self):
        for rows, final in [(self.rows()[:-1], game(1, 20, 17)), ([r for r in self.rows() if r['qtr'] != 2], game(1, 20, 17))]:
            result = quarter_trends(rows, [final], 2026)
            self.assertEqual(result['teams'], {})
            self.assertEqual(result['excluded_games'], [final['game_id']])

    def test_zero_offensive_plays_are_not_zero_epa(self):
        result = quarter_trends(self.rows(), [game(1, 20, 17)], 2026)
        self.assertIsNone(result['teams']['NE']['summary'][0]['off_epa_per_play'])
        self.assertEqual(result['teams']['CHI']['summary'][0]['off_epa_per_play'], .2)

    def test_pbp_outside_allowed_games_not_used(self):
        self.assertEqual(quarter_trends(self.rows(), [], 2026)['teams'], {})


class ModelCalibrationTests(unittest.TestCase):
    def test_ordered_production_split_and_small_sample_fallback(self):
        from src.ml.projection_models import production_split, lineage
        rows = [{'season': 2024, 'week': w} for w in range(1, 5)] + [{'season': 2025, 'week': w} for w in range(1, 5)] + [{'season': 2026, 'week': 1}]
        train, calibration = production_split(rows, 2026, minimum=3)
        self.assertEqual(lineage(train, calibration)['training_cutoff'], [2024, 4])
        self.assertEqual(lineage(train, calibration)['calibration_cutoff'], [2025, 4])

    def test_finite_sample_radius_and_nonfinite_feature_rejection(self):
        from src.ml.projection_models import radius, matrix
        self.assertGreaterEqual(radius([1, 2, 3, 4]), 4)
        with self.assertRaises(ValueError): matrix([{'x': {'a': float('nan')}}], ['a'])
        with self.assertRaises(ValueError): radius([])


if __name__ == '__main__': unittest.main()

class PublishedResearchTests(unittest.TestCase):
    def test_saved_report_is_pregame_and_models_precede_forecast(self):
        import json
        from src.ml.refresh_performance import ROOT
        from src.ml.refresh_research import validate_export
        path = ROOT / 'frontend/public/matchup_research.json'
        if not path.exists():
            self.skipTest('Research export not built yet')
        payload = json.loads(path.read_text())
        validate_export(payload)
        bad = copy.deepcopy(payload)
        entry = next(iter(bad['games'].values()))
        entry['generated_at'] = entry['kickoff']
        with self.assertRaises(ValueError): validate_export(bad)
        bad = copy.deepcopy(payload)
        model = next(iter(next(iter(bad['model_versions'].values()))['models'].values()))
        model['calibration_cutoff'] = [payload['season'], payload['week']]
        with self.assertRaises(ValueError): validate_export(bad)

    def test_model_files_match_snapshot_hashes(self):
        import hashlib
        import json
        from src.ml.refresh_performance import ROOT
        path = ROOT / 'models/research/metadata.json'
        if not path.exists():
            self.skipTest('Research models not built yet')
        metadata = json.loads(path.read_text())
        for name, model in metadata['models'].items():
            self.assertEqual(hashlib.sha256((ROOT / f'models/research/{name}.joblib').read_bytes()).hexdigest(), model['sha256'])
