import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from src.features.player_context import build_context,usage,usage_validation,VERSION
from src.ml.forecast_insights import capture,observe,monitor,calibration_watch,export,POLICY

NOW='2026-10-28T12:00:00Z'
START='2026-10-29T20:00:00Z'
PID='00-test'

def fixtures():
    g={'game_id':'2026_08_ATL_TB','season':2026,'week':8,'home_team':'TB','away_team':'ATL','home_win_prob_v5_qb_plus':.6,'home_projected_qb_id':PID,'home_projected_qb_name':'Player','away_projected_qb_id':'other','away_projected_qb_name':'Other','home_qb_selection':{'player_id':PID,'status':'unconfirmed_proxy'}}
    p={'player_id':PID,'name':'Player','position':'QB','team':'TB','opponent':'ATL','game_id':g['game_id'],'history':[{'game_id':f'g{i}','week':i,'date':f'2026-10-{i:02d}','team':'TB','attempts':v} for i,v in [(1,10),(2,20),(3,30),(4,40)]]}
    pred={'season':2026,'week':8,'generated_at':'2026-10-27T12:00:00Z','games':[g]}
    directory={'season':2026,'week':8,'players':[p],'exported_at':NOW}
    card={k:v for k,v in p.items() if k!='history'};card.update(expected_yards=250,status='available',anytime_td_probability=.1,passing_td_probability=.8)
    research={'season':2026,'week':8,'features_through_week':7,'input_fingerprint':'a','games':{g['game_id']:{'kickoff':START,'generated_at':'2026-10-27T12:00:00Z','model_version':'v1','scoring':{'home':{'team':'TB','expected_points':27},'away':{'team':'ATL','expected_points':20}},'players':[card]}}}
    sources={k:{'status':'available','observed_at':NOW} for k in ['injuries','depth_charts']}
    injury={'season':2026,'week':8,'season_type':'REG','team':'TB','gsis_id':PID,'report_status':'Out','practice_status':'Did Not Participate In Practice'}
    depth={'dt':'2026-10-28T07:00:00Z','team':'TB','gsis_id':PID,'pos_abb':'QB','pos_rank':1}
    return pred,directory,research,sources,injury,depth

class PlayerContextTests(unittest.TestCase):
    def build(self,injury=None,depth=None,now=NOW):
        p,d,r,s,i,c=fixtures()
        return build_context(p,d,r,[i] if injury is None else injury,[c] if depth is None else depth,s,now)[0][0]
    def test_source_identity_practice_status_and_conditional_baseline(self):
        c=self.build();self.assertTrue(c['availability']['blocked']);self.assertEqual(c['starter']['status'],'listed_first_unit')
        self.assertEqual(c['usage']['estimate'],30);self.assertEqual(c['usage']['version'],VERSION)
        self.assertIsNone(c['availability']['report_updated_at'])
        p,d,r,s,i,c=fixtures();i['report_status']=None
        value=build_context(p,d,r,[i],[c],s,NOW)[0][0]
        self.assertEqual(value['availability']['status'],'unknown');self.assertFalse(value['availability']['blocked']);self.assertIn('Practice',value['availability']['practice'])
    def test_missing_ambiguous_wrong_week_team_and_id_never_imply_out_or_healthy(self):
        _,_,_,_,i,_=fixtures()
        for rows in [[],[i,i],[{**i,'week':7}],[{**i,'season':2025}],[{**i,'team':'ATL'}],[{**i,'gsis_id':'wrong'}],[{**i,'date_modified':'2026-10-30T12:00:00Z'}]]:
            with self.subTest(rows=rows):
                c=self.build(rows);self.assertEqual(c['availability']['status'],'unknown');self.assertFalse(c['availability']['blocked'])
    def test_source_staleness_future_observations_and_started_games(self):
        p,d,r,s,i,c=fixtures()
        for at in ['2026-10-20T12:00:00Z','2026-10-30T12:00:00Z']:
            s['injuries']['observed_at']=at
            value=build_context(p,d,r,[i],[c],s,NOW)[0][0];self.assertFalse(value['availability']['blocked'])
        value=self.build(now='2026-10-30T12:00:00Z');self.assertEqual(value['usage']['status'],'game_started');self.assertFalse(value['availability']['blocked'])
    def test_depth_latest_team_snapshot_removal_stale_and_future(self):
        _,_,_,_,_,c=fixtures()
        for rows in [[{**c,'dt':'2026-10-20T07:00:00Z'}],[{**c,'dt':'2026-10-30T07:00:00Z'}],[c,{**c,'dt':'2026-10-28T08:00:00Z','gsis_id':'replacement'}]]:
            self.assertEqual(self.build(depth=rows)['starter']['status'],'unknown')
    def test_own_usage_only_no_missing_zeros_and_transfer_gate(self):
        _,d,_,_,_,_=fixtures();h=d['players'][0]['history']
        self.assertEqual(usage(h,'QB','TB')['estimate'],30)
        for rows in [h[:2],[*h[:3],{**h[3],'attempts':None}],[*h[:3],{**h[3],'team':'ATL'}]]:
            self.assertIsNone(usage(rows,'QB','TB')['estimate'])
        self.assertEqual(usage_validation(d['players'])[0]['samples'],1)
    def test_target_week_and_future_history_excluded_duplicate_refused(self):
        p,d,r,s,i,c=fixtures();d['players'][0]['history'] += [{'game_id':'future','week':8,'date':'2026-10-29','team':'TB','attempts':99}]
        self.assertEqual(build_context(p,d,r,[],[],s,NOW)[0][0]['usage']['estimate'],30)
        d['players'][0]['history'].append(d['players'][0]['history'][0])
        with self.assertRaises(ValueError):build_context(p,d,r,[],[],s,NOW)
    def test_sourced_confirmed_qb_report_preserves_distinct_status(self):
        p,d,r,s,i,c=fixtures();p['games'][0]['home_qb_selection']={'player_id':PID,'status':'confirmed','source':'https://example.com/report','observed_at':NOW}
        self.assertEqual(build_context(p,d,r,[],[],s,NOW)[0][0]['starter']['status'],'confirmed')

class ChangeTests(unittest.TestCase):
    def test_first_baseline_idempotence_deltas_reasons_and_no_hindsight(self):
        p,d,r,s,i,c=fixtures();ctx,_=build_context(p,d,r,[i],[c],s,NOW);current=capture(p,r,ctx)
        original=copy.deepcopy(p);state=observe(current,{},NOW);self.assertEqual(state['events'],[])
        again=observe(current,state,'2026-10-28T13:00:00Z');self.assertEqual(again['events'],[])
        p['games'][0]['home_win_prob_v5_qb_plus']=.75;r['games'][p['games'][0]['game_id']]['players'][0]['expected_yards']=300
        changed=capture(p,r,ctx);result=observe(changed,again,'2026-10-28T14:00:00Z')
        self.assertEqual(len(result['events']),2);self.assertAlmostEqual(result['events'][0]['delta'],50)
        self.assertIn('no cause',result['events'][0]['reasons'][0])
        frozen=observe(current,result,'2026-10-30T12:00:00Z');self.assertEqual(frozen['events'],result['events']);self.assertEqual(frozen['games'],result['games'])
        self.assertEqual(original['games'][0]['home_win_prob_v5_qb_plus'],.6)
    def test_qb_and_model_version_changes_have_observable_reasons(self):
        p,d,r,s,i,c=fixtures();ctx,_=build_context(p,d,r,[i],[c],s,NOW);state=observe(capture(p,r,ctx),{},NOW)
        p['games'][0]['home_projected_qb_id']='new';p['games'][0]['home_projected_qb_name']='New QB';r['games'][p['games'][0]['game_id']]['model_version']='v2'
        events=observe(capture(p,r,ctx),state,'2026-10-28T13:00:00Z')['events']
        self.assertTrue(any(e['after']=='New QB' for e in events));self.assertTrue(any(e['field']=='research_model_version' for e in events))
    def test_rollover_changed_contract_and_missing_inputs_are_not_numeric_revisions(self):
        p,d,r,s,i,c=fixtures();current=capture(p,r,[]);state=observe(current,{},NOW)
        for variant in [copy.deepcopy(current) for _ in range(2)]:
            g=next(iter(variant.values()));g['kickoff']='2026-10-30T20:00:00Z';g['values']['home_win_prob_v5_qb_plus']['value']=.9
            self.assertEqual(observe(variant,state,NOW)['events'],[])
        self.assertEqual(observe(capture(p,{},[]),state,NOW)['events'],[])

class MonitoringTests(unittest.TestCase):
    def rows(self,n=200,target='winner:v5_qb_plus',version='v1',prob=.9):
        return [{'game_id':f'{i:04}','subject':'home','family':'winners','target':target,'version':version,'status':'graded','prediction':prob,'actual':0,'date':f'2026-01-{i//10+1:02d}'} for i in range(n)]
    def test_calibration_gates_nonoverlap_version_isolation_and_deduplication(self):
        self.assertEqual(calibration_watch(self.rows(99))[0]['status'],'sample_building')
        self.assertEqual(calibration_watch(self.rows(100))[0]['status'],'watch')
        result=calibration_watch(self.rows(200))[0];self.assertEqual(result['status'],'review');self.assertEqual([w['samples'] for w in result['windows']],[100,100])
        self.assertNotEqual(result['windows'][0]['start'],result['windows'][1]['start'])
        rows=self.rows(99)+self.rows(99,version='v2');self.assertTrue(all(c['status']=='sample_building' for c in calibration_watch(rows)))
        self.assertEqual(calibration_watch(self.rows(99)*2)[0]['samples'],99)
        wrong=self.rows(1);wrong[0]['prediction']=.1
        with self.assertRaises(ValueError):calibration_watch(self.rows(1)+wrong)
    def test_whole_game_td_windows_never_split_appearances(self):
        rows=[]
        for i in range(2):
            rows += [{'game_id':str(i),'subject':str(j),'family':'touchdowns','target':'any_td','version':'v1','status':'graded','prediction':.9,'actual':0,'date':f'2026-01-0{i+1}'} for j in range(5)]
        with patch.dict(POLICY['minimum'],{'touchdowns':3}):
            value=calibration_watch(rows)[0]
        self.assertEqual([w['samples'] for w in value['windows']],[5,5])
        self.assertEqual(value['status'],'review')
    def test_calibration_excludes_missing_ungraded_and_unknown_versions(self):
        rows=self.rows(200)
        for r in rows:r['status']='pending'
        self.assertEqual(calibration_watch(rows),[])
    def test_operational_flags_stale_mismatched_and_invalid_inputs(self):
        p,d,r,s,i,c=fixtures();d['week']=7;p['games'][0]['home_win_prob_v5_qb_plus']=2
        s['injuries']['status']='unavailable';r['features_through_week']=8
        report=monitor(p,r,d,[],[],{},s,NOW);ids={a['id'] for a in report['alerts']}
        self.assertIn('directory',ids);self.assertIn('source:injuries',ids);self.assertIn('cutoff:'+p['games'][0]['game_id'],ids)
        self.assertFalse(report['automatic_retraining']);self.assertFalse(POLICY['automatic_retraining'])
    def test_results_only_is_network_free_and_does_not_rewrite_forecasts(self):
        p,d,r,s,i,c=fixtures()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);public=root/'frontend/public';public.mkdir(parents=True)
            for name,value in [('predictions',p),('player_intelligence',d),('matchup_research',r),('research_performance',{})]: (public/f'{name}.json').write_text(json.dumps(value))
            original=(public/'predictions.json').read_bytes()
            with patch('src.ml.forecast_insights.source_tables',side_effect=AssertionError('network forbidden')):
                value=export(root,NOW,fetch_sources=False)
            self.assertEqual(original,(public/'predictions.json').read_bytes());self.assertEqual(value['changes'],[])
            self.assertTrue((root/'data/tracking/forecast_insights/2026-week-8.json').exists())

if __name__=='__main__':unittest.main()
