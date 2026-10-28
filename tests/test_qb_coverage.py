import copy
import tempfile
import unittest
from pathlib import Path
import polars as pl
from src.features.qb_coverage import missing_ngs_weeks, low_volume_exclusions, coverage_metadata
from src.features.qb_starters import resolve_qb, merge_revisions
from src.ml.weekly_forecast import check_coverage, DataPending
from src.ml.refresh_performance import archive

NOW = '2026-10-28T01:00:00Z'
GAME = dict(game_id='2026_07_TB_CAR', season=2026, week=7, game_type='REG', gameday='2026-10-25', gametime='13:00', away_team='TB', home_team='CAR', away_score=43, home_score=13, result=-30, away_qb_id='baker', home_qb_id='bryce')
NEXT = {**GAME, 'game_id':'2026_08_ATL_TB', 'week':8, 'gameday':'2026-11-01', 'home_team':'TB', 'away_team':'ATL', 'home_score':None, 'away_score':None, 'result':None}
NGS = [dict(season=2026, week=3, team_abbr='TB', attempts=30, player_gsis_id='baker', player_display_name='Baker Mayfield'), dict(season=2026, week=6, team_abbr='TB', attempts=43, player_gsis_id='daniels', player_display_name='Jalon Daniels'), dict(season=2026, week=7, team_abbr='CAR', attempts=30, player_gsis_id='bryce', player_display_name='Bryce Young')]
BOX = [dict(game_id=GAME['game_id'], season=2026, week=7, season_type='REG', team='TB', player_id='baker', player_display_name='Baker Mayfield', position='QB', attempts=11)]
TOTALS = [dict(game_id=GAME['game_id'], season=2026, week=7, season_type='REG', team='TB', attempts=11)]

class QbCoverageTests(unittest.TestCase):
    def exclusions(self, ngs=None, players=None, teams=None, schedules=None):
        ngs = NGS if ngs is None else ngs
        schedules = [GAME,NEXT] if schedules is None else schedules
        missing = missing_ngs_weeks(schedules,ngs,2026,8,NOW)
        return low_volume_exclusions(missing,schedules,ngs,BOX if players is None else players,TOTALS if teams is None else teams,2026,8,NOW)

    def test_returning_qb_uses_own_history_and_carries_qualification_evidence(self):
        originals = copy.deepcopy((NGS,BOX,TOTALS))
        evidence = self.exclusions()
        self.assertEqual([(r['team'],r['week'],r['attempts']) for r in evidence],[('TB',7,11)])
        qb = resolve_qb(NEXT,'TB',NGS,{},NOW,evidence)
        self.assertEqual((qb['player_id'],qb['name'],qb['status']),('baker','Baker Mayfield','unconfirmed_proxy'))
        self.assertEqual(qb['ngs_through_week'],3)
        self.assertEqual(qb['ngs_exclusion']['game_id'],GAME['game_id'])
        self.assertEqual(qb['ngs_exclusion']['team_attempts'],11)
        self.assertEqual((NGS,BOX,TOTALS), originals)

    def test_qualified_or_inconsistent_missing_data_still_blocks(self):
        cases = [([],TOTALS), (BOX,[]), (BOX,[{**TOTALS[0],'attempts':12}]),
                 ([{**BOX[0],'attempts':0}],[{**TOTALS[0],'attempts':0}]),
                 ([{**BOX[0],'attempts':5},{**BOX[0],'player_id':'backup','attempts':5}],[{**TOTALS[0],'attempts':10}]),
                 ([{**BOX[0],'attempts':15}],[{**TOTALS[0],'attempts':15}]),
                 ([{**BOX[0],'attempts':None}],TOTALS), (BOX+BOX,TOTALS),
                 ([{**BOX[0],'player_id':'wrong'}],TOTALS),
                 ([{**BOX[0],'game_id':'wrong'}],TOTALS)]
        for players, teams in cases:
            with self.subTest(players=players,teams=teams):
                with self.assertRaises(ValueError):self.exclusions(players=players,teams=teams)
        with self.assertRaises(ValueError):self.exclusions(ngs=NGS[1:])

    def test_future_or_unfinished_game_cannot_supply_a_fallback(self):
        self.assertEqual(self.exclusions(schedules=[{**GAME,'gameday':'2026-11-01'},NEXT]),[])
        self.assertEqual(self.exclusions(schedules=[{**GAME,'home_score':None,'away_score':None,'result':None},NEXT]),[])
        with self.assertRaises(ValueError):self.exclusions(players=[{**BOX[0],'week':8}])
        with self.assertRaises(ValueError):self.exclusions(ngs=[{**r,'week':8} if r['player_gsis_id']=='baker' else r for r in NGS])

    def test_latest_ngs_or_explicit_report_takes_precedence(self):
        evidence=self.exclusions()
        later=[*NGS, {**NGS[0],'week':7,'attempts':20}]
        self.assertEqual(missing_ngs_weeks([GAME],later,2026,8,NOW),[])
        self.assertNotIn('ngs_coverage_note',resolve_qb(NEXT,'TB',later,{},NOW,evidence))
        report={'name':'Jalon Daniels','player_id':'daniels','status':'reported_expected','source':'https://www.nfl.com/starter-report','observed_at':'2026-10-27T22:00:00Z'}
        qb=resolve_qb(NEXT,'TB',NGS,{NEXT['game_id']:{'TB':report}},NOW,evidence)
        self.assertEqual(qb['player_id'],'daniels')
        self.assertNotIn('ngs_coverage_note',qb)

    def test_historical_low_volume_gap_does_not_block_next_week_again(self):
        evidence=self.exclusions()
        later=[*NGS,{**NGS[0],'week':8,'attempts':25}]
        later_game={**NEXT,'away_score':20,'home_score':23,'result':3}
        # The exclusion can remain auditable; newer usable tracking wins the QB selection.
        qb=resolve_qb({**NEXT,'week':9},'TB',later,{},NOW,evidence)
        self.assertEqual(qb['player_id'],'baker')
        self.assertNotIn('ngs_coverage_note',qb)
        self.assertEqual(len(low_volume_exclusions([(2026,7,'TB')],[GAME,later_game],later,BOX,TOTALS,2026,9,'2026-11-04T01:00:00Z')),1)

    def test_pbp_coverage_remains_required_and_error_names_the_team(self):
        weekly=pl.DataFrame([{'game_id':GAME['game_id'],'season':2026,'week':7,'team':t} for t in ('TB','CAR')])
        exclusions=check_coverage([GAME],weekly,weekly,pl.DataFrame(NGS),2026,8,NOW,(BOX,TOTALS))
        self.assertEqual(exclusions[0]['player_id'],'baker')
        with self.assertRaisesRegex(DataPending,'team coverage incomplete'):
            check_coverage([GAME],weekly.head(1),weekly,pl.DataFrame(NGS),2026,8,NOW,(BOX,TOTALS))
        with self.assertRaisesRegex(DataPending,'TB 2026 Week 7'):
            check_coverage([GAME],weekly,weekly,pl.DataFrame(NGS),2026,8,NOW)

    def test_archives_keep_actual_identity_and_fallback_evidence_without_rewriting_old_pick(self):
        qb=resolve_qb(NEXT,'TB',NGS,{},NOW,self.exclusions())
        old={**NEXT,'game_date':'2026-11-01','home_projected_qb_name':'Jalon Daniels','home_projected_qb_id':'daniels','home_qb_selection':{'status':'unconfirmed_proxy'},'home_win_prob_v4_a':.5,'home_win_prob_v4_qb_plus':.6}
        fresh={**old,'home_projected_qb_name':'Baker Mayfield','home_projected_qb_id':'baker','home_qb_selection':qb}
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);a=archive({'games':[old]}, {},NOW,{'kind':'original'},root=root)
            b=archive({'games':[fresh]}, {},NOW,{'kind':'regenerated'},root=root)
            self.assertNotEqual(a['snapshot_id'],b['snapshot_id'])
            self.assertEqual(a['games'][0]['home_projected_qb_id'],'daniels')
            self.assertEqual(b['games'][0]['home_qb_selection']['ngs_exclusion']['attempts'],11)
        coverage=coverage_metadata([fresh],self.exclusions())
        self.assertEqual(len(coverage['limited_inputs']),1)
        merged=merge_revisions({'games':[fresh],'count':1,'qb_coverage':coverage},{'games':[old],'qb_coverage':{'exclusions':[]}},[NEXT],NOW)
        self.assertEqual(merged['qb_coverage']['limited_inputs'],[])

if __name__=='__main__':unittest.main()
