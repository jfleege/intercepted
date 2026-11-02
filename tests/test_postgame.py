import unittest
from scripts.check_postgame import changed_finals,recent_games
from datetime import datetime
class PostgameTests(unittest.TestCase):
 def setUp(self):
  self.games={'g':{'home_team':'LA','away_team':'SEA','kickoff':'2026-11-01T21:05:00Z','status':'pending','home_score':None,'away_score':None}}
  self.event={'date':'2026-11-01T21:05:00Z','status':{'type':{'completed':True}},'competitions':[{'competitors':[{'homeAway':'home','team':{'abbreviation':'LAR'},'score':'24'},{'homeAway':'away','team':{'abbreviation':'SEA'},'score':'20'}]}]}
 def test_new_final_and_score_corrections(self):
  self.assertEqual(changed_finals(self.games,[self.event]),['g'])
  self.games['g'].update(status='final',home_score=24,away_score=20)
  self.assertEqual(changed_finals(self.games,[self.event]),[])
  self.games['g']['home_score']=23
  self.assertEqual(changed_finals(self.games,[self.event]),['g'])
 def test_live_or_wrong_event_never_triggers(self):
  self.event['status']['type']['completed']=False
  self.assertEqual(changed_finals(self.games,[self.event]),[])
  self.event['status']['type']['completed']=True;self.event['date']='2026-11-08T21:05:00Z'
  self.assertEqual(changed_finals(self.games,[self.event]),[])
 def test_ambiguous_or_invalid_scores_are_withheld(self):
  self.games['other']=self.games['g'].copy()
  self.assertEqual(changed_finals(self.games,[self.event]),[])
  self.games.pop('other');self.event['competitions'][0]['competitors'][0]['score']='nan'
  self.assertEqual(changed_finals(self.games,[self.event]),[])

 def test_chicago_dates_and_future_guard_across_dst(self):
  now=datetime.fromisoformat('2026-11-02T03:00:00+00:00')
  games={str(i):{'kickoff':at} for i,at in enumerate(['2026-11-01T01:00:00Z','2026-10-31T01:00:00Z','2026-11-02T04:00:00Z','2026-11-01T12:00:00',None])}
  self.assertEqual(set(recent_games(games,now)),{'0'})
