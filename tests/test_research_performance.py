import copy
import unittest
from pathlib import Path
from unittest.mock import patch
from src.ml.research_performance import eligible, extract, choose, grade, summarize, health, reliability, evidence, build_export
NOW='2026-10-25T22:00:00+00:00'
START='2026-10-25T17:00:00+00:00'

def fixture():
    p={'season':2026,'week':7,'model_versions':{'v':{'created_at':'2026-10-20T10:00:00+00:00','models':{'m':{'training_cutoff':[2025,18],'calibration_cutoff':[2026,6]}}}},'games':{'g':{
       'model_version':'v','generated_at':'2026-10-22T10:00:00+00:00','kickoff':START,
       'scoring':{'home':{'team':'CHI','expected_points':21,'range_80':[10,32]},'away':{'team':'NE','expected_points':18,'range_80':[7,29]},'total':39,'home_margin':3,'total_range_80':[20,55],'margin_range_80':[-10,16]},
       'players':[{'player_id':'p','name':'QB','team':'CHI','opponent':'NE','position':'QB','status':'available','stat':'passing','expected_yards':200,'recent_yards':180,'range_80':[100,300],'anytime_td_probability':.2,'passing_td_probability':.8}]}}}
    observed={'observed_at':'2026-10-22T11:00:00+00:00'}
    schedule={'g':{'game_id':'g','season':2026,'week':7,'game_type':'REG','gameday':'2026-10-25','gametime':'13:00','home_team':'CHI','away_team':'NE','home_score':21,'away_score':14,'result':7}}
    return p,observed,schedule

class ResearchEvidenceTests(unittest.TestCase):
    def test_generation_time_alone_cannot_establish_pregame_evidence(self):
        p,o,s=fixture();g=p['games']['g'];self.assertTrue(eligible(p,g,o)[0]);o['observed_at']=START;self.assertFalse(eligible(p,g,o)[0])
    def test_cutoff_and_model_timing_guards(self):
        p,o,_=fixture();p['model_versions']['v']['models']['m']['calibration_cutoff']=[2026,7]
        self.assertFalse(eligible(p,p['games']['g'],o)[0])
        p,o,_=fixture();p['model_versions']['v']['created_at']='2026-10-23T12:00:00+00:00';self.assertFalse(eligible(p,p['games']['g'],o)[0])
    def test_git_timestamp_is_not_borrowed_for_modified_content(self):
        import json
        root=Path('/repo');p=root/'file.json';obs={}
        with patch('src.ml.research_performance.git',side_effect=[json.dumps({'value':1}),'2026-10-01T00:00:00+00:00']):
            _,o=evidence(p,{'value':1},obs,NOW,root);self.assertEqual(o['source'],'git_first_commit')
        with patch('src.ml.research_performance.git',return_value=json.dumps({'value':1})):
            _,o=evidence(p,{'value':2},obs,NOW,root);self.assertEqual(o['observed_at'],NOW)
    def test_first_verified_estimate_is_frozen_and_baseline_not_backfilled(self):
        p,o,s=fixture();a=extract(p,'first',o,s);q=copy.deepcopy(p);q['games']['g']['scoring']['total']=50;q['games']['g']['scoring']['baseline_total']=40
        b=extract(q,'later',{'observed_at':'2026-10-23T10:00:00+00:00'},s)
        record=next(r for r in choose(a+b) if r['target']=='total');self.assertEqual(record['prediction'],39);self.assertIsNone(record['baseline'])
        late=[{**r,'eligibility':'retrospective','saved_at':'2026-10-21T10:00:00+00:00'} for r in a]
        self.assertTrue(all(r['eligibility']=='verified' for r in choose(late+b)))

class ResearchGradingTests(unittest.TestCase):
    def records(self):
        p,o,s=fixture();return extract(p,'s',o,s),s
    def test_event_definitions_do_not_count_passing_as_a_scoring_td(self):
        rows,s=self.records();stats=[{'season':2026,'week':7,'team':'CHI','player_id':'p','passing_yards':220,'passing_tds':2,'rushing_tds':0,'receiving_tds':0}]
        out=grade(rows,s,stats,NOW);by={r['target']:r for r in out if r['family']!='scoring'}
        self.assertEqual(by['any_td']['actual'],0);self.assertEqual(by['pass_td']['actual'],1)
        self.assertAlmostEqual(by['pass_td']['loss'],.04);self.assertEqual(by['passing']['error'],20);self.assertTrue(by['passing']['inside_range'])
        self.assertEqual(by['passing']['baseline_loss'],40)
    def test_missing_stats_do_not_become_zero_or_an_inactive_grade(self):
        rows,s=self.records();out=grade(rows,s,[],NOW)
        self.assertTrue(all(r['actual'] is None and r['status']=='missing_stats' for r in out if r['family']!='scoring'))
        self.assertEqual(next(r for r in out if r['target']=='total')['actual'],35)
    def test_pending_ties_cancellations_and_corrections(self):
        rows,s=self.records();before=grade(rows,s,[], '2026-10-25T12:00:00+00:00');self.assertTrue(all(r['status']=='pending' for r in before))
        s['g'].update(home_score=14,result=0);after=grade(rows,s,[],NOW);self.assertEqual(next(r for r in after if r['target']=='margin')['actual'],0)
        self.assertEqual(next(r for r in after if r['target']=='total')['prediction'],39)
        s['g'].update(status='cancelled',result=None);self.assertTrue(all(r['status']=='cancelled' for r in grade(rows,s,[],NOW)))
    def test_duplicate_player_stats_fail_instead_of_double_counting(self):
        rows,s=self.records();r={'season':2026,'week':7,'team':'CHI','player_id':'p'}
        with self.assertRaises(ValueError):grade(rows,s,[r,r],NOW)
    def test_summary_baseline_is_paired_and_range_denominator_excludes_missing(self):
        rows,s=self.records();out=grade(rows,s,[],NOW);r=next(r for r in out if r['target']=='total')
        g=summarize([r,{**r,'baseline_loss':3,'loss':2,'range':None,'inside_range':None}], 'scoring','v')
        self.assertEqual(g['baseline_samples'],1);self.assertEqual(g['paired_error'],2);self.assertEqual(g['range_samples'],1)

class ResearchHealthTests(unittest.TestCase):
    def rows(self,n,family='yardage',loss=12,base=10):
        return [{'game_id':str(i),'subject':'p','date':f'2026-{i:04}','loss':loss,'baseline_loss':base,'version':'v'} for i in range(n)]
    def test_sample_gate_two_windows_and_mixed_versions(self):
        self.assertEqual(health(self.rows(299),'yardage')['status'],'sample_building')
        self.assertEqual(health(self.rows(300),'yardage')['status'],'watch')
        h=health(self.rows(600),'yardage');self.assertEqual(h['status'],'review');self.assertEqual([w['samples'] for w in h['windows']],[300,300])
        self.assertEqual(health(self.rows(900),'yardage',mixed=True)['status'],'version_required')
        self.assertEqual(health(self.rows(600,loss=9),'yardage')['status'],'monitoring')
    def test_missing_baselines_and_game_boundaries(self):
        rows=self.rows(600);rows[0]['baseline_loss']=None;self.assertEqual(health(rows,'yardage')['status'],'baseline_unavailable')
        rows=self.rows(200,'scoring');rows=[{**r,'subject':side} for r in rows for side in ['home','away']]
        h=health(rows,'scoring');self.assertEqual([w['samples'] for w in h['windows']],[100,100])
    def test_reliability_includes_probability_one_and_wilson_bounds(self):
        bins=reliability([{'prediction':1,'actual':0},{'prediction':0,'actual':0}]);self.assertEqual(sum(b['samples'] for b in bins),2)
        self.assertTrue(all(0<=b['lower']<=b['observed']<=b['upper']<=1 for b in bins))
    def test_late_records_cannot_raise_health_alerts(self):
        rows,s=ResearchGradingTests().records();rows=grade(rows,s,[],NOW)
        late=[{**r,'eligibility':'retrospective'} for r in rows]
        output=build_export(late,{'datasets':{}},NOW)
        self.assertTrue(all(g['health']['status']=='disabled' for g in output['datasets']['retrospective']['groups']))
        self.assertEqual(output['datasets']['verified']['rows'],[])

if __name__=='__main__':unittest.main()
