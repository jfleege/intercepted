import unittest
from datetime import date
from src.features.defense_rankings import build_defense_rankings


def game(week, home='A', away='B', home_score=20, away_score=10, **extra):
    return {'season': 2026, 'game_type': 'REG', 'week': week, 'gameday': f'2026-09-{week * 7:02}', 'home_team': home, 'away_team': away, 'home_score': home_score, 'away_score': away_score, **extra}


def stats(team, week, passing, rushing, **extra):
    return {'season': 2026, 'season_type': 'REG', 'team': team, 'week': week, 'passing_yards': passing, 'rushing_yards': rushing, **extra}


class DefenseRankTests(unittest.TestCase):
    def rank(self, schedule, rows=(), week=3, cutoff=date(2026, 9, 20)):
        return build_defense_rankings(rows, schedule, 2026, week, cutoff, 'team')

    def test_opponents_not_own_production_and_averages_not_totals(self):
        result = self.rank([game(1), game(2, 'A', 'C', 30, 10)], [stats('A', 1, 300, 70), stats('B', 1, 100, 150), stats('A', 2, 200, 50), stats('C', 2, 200, 100)])
        a, b, c = (result['teams'][t] for t in 'ABC')
        self.assertEqual((a['games'], a['points_allowed_per_game'], a['pass_yards_allowed_per_game'], a['rush_yards_allowed_per_game']), (2, 10, 150, 125))
        self.assertEqual((a['overall_rank'], b['overall_rank'], c['overall_rank']), (1, 2, 3))
        self.assertEqual((a['pass_rank'], c['pass_rank'], b['pass_rank']), (1, 2, 3))
        self.assertEqual(result['league_size'], 3)

    def test_no_leakage_and_unfinished_games_not_zeroes(self):
        valid = game(1)
        excluded = [game(2, home_score=None), game(2, gameday='2026-10-01'), game(3), game(1, season=2025), game(1, game_type='PRE')]
        result = self.rank([valid, valid, *excluded])['teams']['A']
        self.assertEqual((result['games'], result['through_week'], result['points_allowed_per_game']), (1, 1, 10))
        self.assertIsNone(result['pass_rank'])
        self.assertIsNone(result['rush_rank'])

    def test_ties_and_byes_and_aliases(self):
        result = self.rank([game(1, 'LAR', 'B', 10, 10), game(3, 'C', 'D')])
        self.assertIn('LA', result['teams'])
        self.assertEqual(result['teams']['LA']['overall_rank'], result['teams']['B']['overall_rank'])
        self.assertIsNone(result['teams']['C']['overall_rank'])
        self.assertEqual(result['league_size'], 4)

    def test_partial_source_and_nonfinite_values_never_become_zero_rank(self):
        result = self.rank([game(1), game(2)], [stats('B', 1, 100, 0), stats('B', 2, float('nan'), None)])['teams']['A']
        self.assertEqual(result['games'], 2)
        self.assertIsNone(result['pass_rank'])
        self.assertIsNone(result['rush_rank'])
        zero = self.rank([game(1)], [stats('B', 1, 0, 0)])['teams']['A']
        self.assertEqual((zero['pass_yards_allowed_per_game'], zero['rush_yards_allowed_per_game']), (0, 0))

    def test_player_rows_sum_and_postseason_ignored(self):
        result = self.rank([game(1)], [stats('B', 1, 100, 20), stats('B', 1, 0, 50), stats('B', 1, 900, 900, season_type='POST')])['teams']['A']
        self.assertEqual((result['pass_yards_allowed_per_game'], result['rush_yards_allowed_per_game']), (100, 70))


if __name__ == '__main__': unittest.main()
