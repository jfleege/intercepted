import unittest
import tempfile
from pathlib import Path
from src.ml.refresh_performance import archive
from src.features.qb_starters import current_report, resolve_qb, changed_report_games, merge_revisions, watch_players

NOW = '2026-10-18T16:00:00+00:00'
GAME = {'game_id':'2026_06_CHI_ATL','season':2026,'week':6,'gameday':'2026-10-18','gametime':'13:00','home_team':'ATL','away_team':'CHI'}
REPORT = {'name':'Caleb Williams','status':'reported_expected','source':'https://www.nfl.com/starter-report','observed_at':'2026-10-18T15:00:00+00:00'}
ROWS = [{'player_gsis_id':'caleb','player_display_name':'Caleb Williams','team_abbr':'CHI','season':2026,'week':2,'attempts':30}, {'player_gsis_id':'bagent','player_display_name':'Tyson Bagent','team_abbr':'CHI','season':2026,'week':5,'attempts':35}]

class StarterTests(unittest.TestCase):
    def test_report_overrides_recent_backup_and_carries_evidence(self):
        qb = resolve_qb(GAME,'CHI',ROWS,{GAME['game_id']:{'CHI':REPORT}},NOW)
        self.assertEqual(qb['player_id'],'caleb')
        self.assertEqual(qb['status'],'reported_expected')
        self.assertEqual(qb['source'],REPORT['source'])

    def test_fallback_is_labeled_unconfirmed(self):
        qb = resolve_qb(GAME,'CHI',ROWS,{},NOW)
        self.assertEqual((qb['player_id'],qb['status']),('bagent','unconfirmed_proxy'))

    def test_report_does_not_leak_into_other_game(self):
        qb = resolve_qb({**GAME,'game_id':'2026_07_CHI_ATL'},'CHI',ROWS,{GAME['game_id']:{'CHI':REPORT}},NOW)
        self.assertEqual(qb['player_id'],'bagent')

    def test_bad_and_ambiguous_report_refused(self):
        for report in ({**REPORT,'name':'Not a player'},{**REPORT,'player_id':'wrong'},{**REPORT,'source':''},{**REPORT,'observed_at':'2026-10-18T16:30:00+00:00'}):
            with self.assertRaises(ValueError): resolve_qb(GAME,'CHI',ROWS,{GAME['game_id']:{'CHI':report}},NOW)
        with self.assertRaises(ValueError): resolve_qb(GAME,'CHI',ROWS+[{**ROWS[0],'player_gsis_id':'duplicate'}],{GAME['game_id']:{'CHI':REPORT}},NOW)

    def test_postkick_report_not_used(self):
        reports={GAME['game_id']:{'CHI':{**REPORT,'observed_at':'2026-10-18T17:00:00+00:00'}}}
        self.assertIsNone(current_report(GAME,'CHI',reports,'2026-10-18T18:00:00+00:00'))

    def test_revision_only_before_kickoff_and_idempotent(self):
        old={**GAME,'away_projected_qb_name':'Tyson Bagent'}
        current={'games':[old]};reports={GAME['game_id']:{'CHI':REPORT}}
        self.assertEqual(changed_report_games(current,[GAME],reports,NOW),[GAME])
        self.assertEqual(changed_report_games(current,[GAME],reports,'2026-10-18T17:00:00+00:00'),[])
        revised={**old,'away_projected_qb_name':'Caleb Williams','away_qb_selection':REPORT}
        self.assertEqual(changed_report_games({'games':[revised]},[GAME],reports,NOW),[])

    def test_merge_retains_started_and_unrelated_rows(self):
        old={**GAME,'away_projected_qb_name':'Tyson Bagent'}
        other={'game_id':'other'}
        current={'games':[old,other],'count':2}
        revised={**old,'away_projected_qb_name':'Caleb Williams'}
        fresh=merge_revisions(current,{'games':[revised]},[GAME],NOW)
        self.assertEqual(fresh['games'],[revised,other])
        late=merge_revisions(current,{'games':[revised]},[GAME],'2026-10-18T17:00:00+00:00')
        self.assertEqual(late['games'],current['games'])

    def test_starter_evidence_creates_new_snapshot_even_with_same_probability(self):
        game={**GAME,'game_date':'2026-10-18','home_win_prob_v4_a':.5,'home_win_prob_v4_qb_plus':.5}
        metadata={'latest_training_season':2026,'latest_training_week':5}
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            original=archive({'games':[game]},metadata,NOW,{'kind':'original'},root=root)
            revised=archive({'games':[{**game,'away_projected_qb_name':'Caleb Williams','away_qb_selection':REPORT}]},metadata,NOW,{'kind':'revision'},root=root)
            self.assertNotEqual(original['snapshot_id'],revised['snapshot_id'])
            self.assertNotIn('away_qb_selection',original['games'][0])
            self.assertEqual(revised['games'][0]['away_qb_selection'],REPORT)

    def test_player_cards_match_model_not_recent_production(self):
        candidates=[{'player_id':'bagent','name':'Tyson Bagent','position':'QB','last_game_week':5,'recent_average':300}, {'player_id':'caleb','name':'Caleb Williams','position':'QB','last_game_week':2,'recent_average':200}]
        game={**GAME,'away_projected_qb_id':'caleb','away_projected_qb_name':'Caleb Williams','away_qb_selection':REPORT}
        picked=watch_players(game,'away',candidates)
        self.assertEqual(picked[0]['player_id'],'caleb')
        self.assertEqual(picked[0]['qb_status'],'reported_expected')
        self.assertEqual(watch_players(game,'away',candidates[:1]),[])
        legacy={**GAME,'away_projected_qb_name':'Tyson Bagent'}
        self.assertEqual(watch_players(legacy,'away',candidates)[0]['player_id'],'bagent')

if __name__ == '__main__': unittest.main()
