import json
import tempfile
import unittest
from pathlib import Path

from src.features.roster_transactions import (active_transactions, assigned_team, changed_transaction_games,
                                               game_transactions, load_transactions)
from src.features.qb_starters import resolve_qb
from src.features.player_intelligence import build
from src.features.injury_updates import backup_candidates, availability_changed, replace_qb_features
from src.features.qb_coverage import coverage_metadata, coverage_message
from src.ml.refresh_performance import archive

NOW = '2026-11-11T18:00:00Z'
MOVE = dict(player_id='qb', name='Traded QB', position='QB', from_team='ARI', to_team='BAL', season=2026,
            effective_date='2026-11-06', observed_at='2026-11-11T17:00:00Z', source='https://www.nfl.com/trade', status='announced')
GAME = dict(game_id='2026_10_LAC_BAL', season=2026, week=10, home_team='BAL', away_team='LAC',
            gameday='2026-11-16', gametime='20:15')
ROW = dict(player_gsis_id='qb', player_display_name='Traded QB', team_abbr='ARI', season=2026, week=8, attempts=30)
REPORT = dict(name='Traded QB', player_id='qb', status='reported_expected', source='https://www.nfl.com/starter', observed_at=NOW)


class RosterTransactionTests(unittest.TestCase):
    def test_ledger_cannot_apply_before_observed_or_in_another_season(self):
        self.assertEqual(active_transactions([MOVE], 2026, '2026-11-11T16:00:00Z'), [])
        self.assertEqual(active_transactions([MOVE], 2027, NOW), [])
        self.assertEqual(active_transactions([MOVE], 2026, NOW), [MOVE])

    def test_current_assignment_does_not_overwrite_later_completed_observations(self):
        self.assertEqual(assigned_team('qb', 'ARI', [MOVE], '2026-11-05'), 'BAL')
        self.assertEqual(assigned_team('qb', 'ARI', [MOVE], '2026-11-08'), 'ARI')
        self.assertEqual(assigned_team('other', 'ARI', [MOVE]), 'ARI')

    def test_revisions_are_scoped_idempotent_and_pregame_only(self):
        old = {**GAME, 'roster_changes': []}
        self.assertEqual(changed_transaction_games({'games': [old]}, [GAME], [MOVE], NOW), [GAME])
        revised = {**old, 'roster_changes': game_transactions(GAME, [MOVE], NOW)}
        self.assertEqual(changed_transaction_games({'games': [revised]}, [GAME], [MOVE], NOW), [])
        self.assertEqual(changed_transaction_games({'games': [old]}, [GAME], [MOVE], '2026-11-17T03:00:00Z'), [])
        self.assertEqual(game_transactions({**GAME, 'home_team': 'DEN'}, [MOVE], NOW), [])

    def test_acquired_qb_uses_prior_team_history_only_with_sourced_report(self):
        qb = resolve_qb(GAME, 'BAL', [ROW], {GAME['game_id']: {'BAL': REPORT}}, NOW, transactions=[MOVE])
        self.assertEqual((qb['player_id'], qb['status']), ('qb', 'reported_expected'))
        self.assertIsNone(resolve_qb(GAME, 'BAL', [ROW], {}, NOW, transactions=[MOVE])['player_id'])
        with self.assertRaises(ValueError):
            resolve_qb(GAME, 'BAL', [ROW], {GAME['game_id']: {'BAL': REPORT}}, NOW)

    def test_departed_qb_is_excluded_from_former_team_proxy_and_reports(self):
        game = {**GAME, 'home_team': 'ARI'}
        self.assertIsNone(resolve_qb(game, 'ARI', [ROW], {}, NOW, transactions=[MOVE])['player_id'])
        with self.assertRaises(ValueError):
            resolve_qb(game, 'ARI', [ROW], {game['game_id']: {'ARI': REPORT}}, NOW, transactions=[MOVE])

    def test_explicit_rookie_identity_does_not_borrow_departed_qb_history(self):
        report = {**REPORT, 'name': 'Rookie', 'player_id': 'rookie', 'allow_missing_history': True}
        qb = resolve_qb(GAME, 'BAL', [ROW], {GAME['game_id']: {'BAL': report}}, NOW, transactions=[MOVE])
        self.assertEqual((qb['player_id'], qb['history_status']), ('rookie', 'insufficient_history'))
        with self.assertRaises(ValueError):
            resolve_qb(GAME, 'BAL', [ROW], {GAME['game_id']: {'BAL': {**report, 'player_id': 'qb'}}}, NOW, transactions=[MOVE])

    def test_conflicting_same_date_transactions_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'data/inputs/roster_transactions.json'
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({'schema_version': 1, 'transactions': [MOVE, {**MOVE, 'to_team': 'MIN'}]}))
            with self.assertRaises(ValueError):
                load_transactions(Path(tmp))

    def test_player_directory_reassigns_current_team_and_preserves_original_history(self):
        finished = dict(game_id='2026_08_ARI_LA', season=2026, week=8, game_type='REG', gameday='2026-11-01',
                        gametime='13:00', home_team='LA', away_team='ARI', home_score=20, away_score=10, result=10)
        stats = dict(season=2026, week=8, position='QB', player_id='qb', recent_team='ARI',
                     player_display_name='Traded QB', passing_yards=200)
        result = build({'season': 2026, 'week': 10, 'games': [GAME]}, [stats], [finished], [], [], NOW, [MOVE])
        player = result['players'][0]
        self.assertEqual((player['team'], player['opponent']), ('BAL', 'LAC'))
        self.assertEqual(player['history'][0]['team'], 'ARI')

    def test_archive_identity_includes_roster_evidence(self):
        game = {**GAME, 'game_date': GAME['gameday'], 'home_win_prob_v4_a': .5, 'home_win_prob_v4_qb_plus': .5}
        with tempfile.TemporaryDirectory() as tmp:
            old = archive({'games': [game]}, {}, NOW, {}, root=Path(tmp))
            new = archive({'games': [{**game, 'roster_changes': [MOVE]}]}, {}, NOW, {}, root=Path(tmp))
            self.assertNotEqual(old['snapshot_id'], new['snapshot_id'])
            self.assertEqual(new['games'][0]['roster_changes'], [MOVE])

    def test_acquired_qb_scenario_stays_conditional_and_does_not_repeat_revision(self):
        game = {**GAME, 'home_projected_qb_id': 'incumbent', 'roster_changes': [MOVE]}
        candidates = backup_candidates(game, 'home', [], [], NOW)
        self.assertEqual([c['player_id'] for c in candidates], ['qb'])
        self.assertIn('not a starter announcement', candidates[0]['assumption'])
        saved = {**game, 'qb_scenarios': [{'player_id': 'qb'}]}
        self.assertFalse(availability_changed(saved, GAME, [], NOW))

    def test_missing_starter_tracking_is_reported_in_slate_coverage(self):
        selection = {**REPORT, 'history_status': 'insufficient_history'}
        game = {**GAME, 'home_qb_selection': selection}
        coverage = coverage_metadata([game], [])
        self.assertEqual(coverage['limited_inputs'][0]['history_status'], 'insufficient_history')
        self.assertIn('insufficient NFL tracking history', coverage_message({'qb_coverage': coverage}))

    def test_qb_scenario_updates_missing_input_indicator_with_replacement(self):
        history = {'qb_career_attempts': 100}
        result = replace_qb_features({'home_qb_projection_missing': 1}, history, {}, [])
        self.assertEqual((result['home_qb_projection_missing'], result['away_qb_projection_missing']), (0, 1))


if __name__ == '__main__':
    unittest.main()
