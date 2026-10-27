import unittest
from src.features.player_intelligence import build, periods
NOW='2026-10-20T12:00:00Z'
GAME={'game_id':'2026_06_A_B','season':2026,'week':6,'game_type':'REG','gameday':'2026-10-18','gametime':'13:00','home_team':'DEN','away_team':'SEA','home_score':20,'away_score':10,'result':10}
SLATE={'season':2026,'week':7,'games':[{'game_id':'2026_07_DEN_LV','home_team':'LV','away_team':'DEN'}]}
ROW={'season':2026,'week':6,'season_type':'REG','player_id':'p1','position':'RB','recent_team':'DEN','player_display_name':'Player One','rushing_yards':70,'carries':14,'receptions':None}
class IntelligenceTests(unittest.TestCase):
 def test_history_only_completed_prior_regular_season_appearances_missing_is_not_zero(self):
  out=build(SLATE,[ROW,{**ROW,'week':7},{**ROW,'player_id':'other','season_type':'POST'}],[GAME],[],[],NOW)
  self.assertEqual(len(out['players']),1);p=out['players'][0];self.assertEqual(p['opponent'],'LV');self.assertEqual(len(p['history']),1);self.assertIsNone(p['history'][0]['receptions']);self.assertIsNone(p['history'][0]['periods'])
  self.assertEqual(build(SLATE,[ROW],[{**GAME,'home_score':None,'away_score':None,'result':None}],[],[],NOW)['players'],[])
 def test_periods_exclude_penalties_kneels_spikes_and_keep_overtime_separate(self):
  rows=[{'game_id':GAME['game_id'],'qtr':q} for q in [1,2,3,4]]
  run={'game_id':GAME['game_id'],'qtr':1,'rusher_player_id':'p1','rush_attempt':1}
  rows += [run,{**run,'qtr':5},{**run,'no_play':1},{**run,'qb_kneel':1},{**run,'qb_spike':1}]
  result=periods(rows,[GAME])[(GAME['game_id'],'p1')];self.assertEqual([r['carries'] for r in result],[1,0,0,0,1])
  self.assertEqual(periods([run],[GAME]),{})
 def test_receiver_targets_receptions_and_touches_are_distinct(self):
  rows=[{'game_id':GAME['game_id'],'qtr':q} for q in [1,2,3,4]]
  target={'game_id':GAME['game_id'],'qtr':2,'receiver_player_id':'p1','pass_attempt':1}
  rows += [target,{**target,'complete_pass':1}]
  q=periods(rows,[GAME])[(GAME['game_id'],'p1')][1];self.assertEqual(q['targets'],2);self.assertEqual(q['receptions'],1);self.assertEqual(q['touches'],1)
