import copy
import unittest
from src.features.injury_updates import espn_rows, supplement, game_evidence, backup_candidates, replace_qb_features, availability_changed
from tests.test_forecast_insights import fixtures, NOW
from src.features.player_context import build_context

class InjuryUpdateTests(unittest.TestCase):
    def feed(self):
        return {'timestamp': NOW, 'season': {'year': 2026, 'type': 2}, 'injuries': [{'injuries': [
            {'date': NOW, 'status': 'Questionable', 'details': {'type': 'Concussion'},
             'athlete': {'displayName': 'Player', 'team': {'abbreviation': 'TB'}, 'position': {'abbreviation': 'QB'}}}]}]}

    def test_source_identity_and_dates(self):
        _,d,_,_,_,_=fixtures();feed=self.feed()
        rows=espn_rows(feed,d,2026,8,NOW)
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['report_primary_injury'],'Concussion')
        for field,value in [('date','2026-10-20T12:00:00Z'),('date','2026-10-30T12:00:00Z'),('status','Active')]:
            bad=copy.deepcopy(feed);bad['injuries'][0]['injuries'][0][field]=value
            self.assertEqual(espn_rows(bad,d,2026,8,NOW),[])
        d['players'].append({**d['players'][0],'player_id':'ambiguous'})
        self.assertEqual(espn_rows(feed,d,2026,8,NOW),[])

    def test_newer_evidence_only_and_failure_independent(self):
        p,d,r,s,i,c=fixtures();extra=espn_rows(self.feed(),d,2026,8,NOW)
        official={**i,'date_modified':'2026-10-28T11:00:00Z'}
        rows=supplement([official],extra);self.assertEqual(rows[0]['report_status'],'Questionable')
        s['injuries']['status']='unavailable'
        context=build_context(p,d,r,rows,[c],s,NOW)[0][0]
        self.assertEqual(context['availability']['status'],'Questionable')
        self.assertFalse(context['availability']['blocked'])
        self.assertIn('espn.com',context['availability']['source'])
        newer={**official,'date_modified':NOW}
        self.assertEqual(supplement([newer],extra),[newer])
        self.assertEqual(supplement([official],[]),[official])

    def test_supplement_cannot_change_wrong_team_week_or_started_game(self):
        p,d,r,s,i,c=fixtures();extra=espn_rows(self.feed(),d,2026,8,NOW)
        for row in [{**extra[0],'week':7},{**extra[0],'team':'ATL'}]:
            self.assertEqual(build_context(p,d,r,[row],[c],s,NOW)[0][0]['availability']['status'],'unknown')
        self.assertEqual(build_context(p,d,r,extra,[c],s,'2026-10-30T12:00:00Z')[0][0]['availability']['status'],'unknown')

    def test_stable_evidence_and_unique_backup_gate(self):
        p,d,r,s,i,c=fixtures();i.update(date_modified=NOW,report_status='Questionable')
        contexts=build_context(p,d,r,[i],[c],s,NOW)[0]
        game={**p['games'][0],'gameday':'2026-10-29','gametime':'16:00'}
        evidence=game_evidence(game,contexts,NOW);self.assertEqual(len(evidence),1)
        contexts[0]['availability']['observed_at']='2026-10-28T11:59:00Z'
        self.assertEqual(game_evidence(game,contexts,NOW),evidence)
        reserve={**contexts[0],'name':'Backup','player_id':'backup','availability':{'status':'unknown','observed_at':None},'starter':{**contexts[0]['starter'],'rank':2}}
        self.assertEqual(backup_candidates(game,'home',evidence,contexts+[reserve],NOW),[reserve])
        self.assertEqual(backup_candidates(game,'home',evidence,contexts+[reserve,reserve],NOW),[])
        self.assertEqual(backup_candidates(game,'home',[],contexts+[reserve],NOW),[])
        self.assertEqual(game_evidence(game,contexts,'2026-10-30T12:00:00Z'),[])

    def test_backup_depth_change_triggers_revision_without_new_injury_news(self):
        p,d,r,s,i,c=fixtures();i.update(date_modified=NOW,report_status='Questionable')
        contexts=build_context(p,d,r,[i],[c],s,NOW)[0]
        game={**p['games'][0],'gameday':'2026-10-29','gametime':'16:00'}
        reserve={**contexts[0],'name':'Backup','player_id':'backup','availability':{'status':'unknown','observed_at':None},'starter':{**contexts[0]['starter'],'rank':2}}
        old={**game,'availability_watch':game_evidence(game,contexts,NOW),'qb_scenarios':[{'player_id':'backup'}]}
        self.assertFalse(availability_changed(old,game,contexts+[reserve],NOW))
        reserve['player_id']='new-backup'
        self.assertTrue(availability_changed(old,game,contexts+[reserve],NOW))

    def test_backup_features_replace_qb_only(self):
        a={'qb_career_attempts':100,'qb_career_epa':2,'qb_recent_epa':3}
        b={'qb_career_attempts':10,'qb_career_epa':1,'qb_recent_epa':1}
        primary=replace_qb_features({'diff_blended_off_epa':.5},a,b,['epa'])
        alternative=replace_qb_features(primary,b,b,['epa'])
        self.assertEqual(alternative['diff_blended_off_epa'],.5)
        self.assertEqual(alternative['diff_qb_career_epa'],0)
        self.assertEqual(alternative['qb_experience_diff'],0)
        self.assertEqual(primary['diff_qb_recent_epa'],2)

if __name__=='__main__':unittest.main()
