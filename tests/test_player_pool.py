import unittest
from src.features.player_pool import latest_teams, projection_pool, matchup_pool
from src.features.qb_starters import watch_players

GAME = {'home_team': 'DEN', 'away_team': 'SEA', 'home_projected_qb_id': 'qb', 'home_projected_qb_name': 'Starter'}


class PlayerPoolTests(unittest.TestCase):
    def test_full_pool_is_not_the_watch_shortlist_and_keeps_every_skill_position(self):
        players = [dict(player_id=f'p{i}', name=f'Player {i}', team='DEN', position=position,
                        recent_average=10+i, last_game_week=6) for i, position in enumerate(['RB']*4+['WR']*7+['TE']*3)]
        players += [dict(player_id=pid, name=pid, team='DEN', position='QB', recent_average=200, last_game_week=6) for pid in ['qb', 'backup']]
        picked = projection_pool(GAME, 'home', players)
        self.assertEqual(len(picked), 15)
        self.assertEqual(len(watch_players(GAME, 'home', players)), 4)
        self.assertEqual({p['position'] for p in picked}, {'QB', 'RB', 'WR', 'TE'})
        self.assertNotIn('backup', [p['player_id'] for p in picked])
        self.assertEqual(matchup_pool(GAME, 'home', {'home_catalog': players}), picked)
        self.assertEqual(matchup_pool(GAME, 'home', {'home_players': players[:4]}), projection_pool(GAME, 'home', players[:4]))
        self.assertEqual(matchup_pool(GAME, 'home', {'home_catalog': [], 'home_players': players}), [])

    def test_latest_team_uses_pregame_season_and_withholds_ambiguous_transfers(self):
        row = dict(player_id='p', season=2026, week=5, recent_team='DEN')
        rows = [row, {**row, 'week': 6, 'recent_team': 'SEA'}, {**row, 'week': 7},
                {**row, 'season': 2027}, {**row, 'week': 6, 'season_type': 'POST'}]
        self.assertEqual(latest_teams(rows, 2026, 7), {'p': 'SEA'})
        self.assertEqual(latest_teams(rows+[dict(row, week=6)], 2026, 7), {})

    def test_wrong_team_duplicates_unsupported_positions_and_conflicting_identities(self):
        row = dict(player_id='p', name='Player', team='DEN', position='RB')
        self.assertEqual(projection_pool(GAME, 'home', [row, row, dict(row, player_id='other', team='SEA'), dict(row, player_id='k', position='K')]), [row])
        self.assertEqual(projection_pool(GAME, 'home', [row, dict(row, name='Conflicting identity')]), [])
        qb = dict(row, player_id='backup', position='QB')
        self.assertEqual(projection_pool(GAME, 'home', [qb]), [])


if __name__ == '__main__':
    unittest.main()
