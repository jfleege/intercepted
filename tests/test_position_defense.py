import unittest
from src.features.position_defense import build
class DefenseTests(unittest.TestCase):
 def game(self,week):
  return {'season':2026,'week':week,'game_type':'REG','game_id':f'g{week}','gameday':f'2026-09-{week+1:02d}','gametime':'12:00','home_team':'TB','away_team':'ATL','home_score':20,'away_score':10,'result':10}
 def row(self,pid,position,week,yards):
  return dict(season=2026,week=week,season_type='REG',team='ATL',player_id=pid,position=position,receiving_yards=yards,passing_yards=200,rushing_yards=0,passing_tds=2,rushing_tds=0)
 def test_sums_all_receivers_per_defensive_game_and_excludes_current_week(self):
  games=[self.game(w) for w in range(1,5)]
  rows=[self.row('a','WR',w,20*w) for w in range(1,5)]+[self.row('b','WR',w,10*w) for w in range(1,5)]
  x=build({'season':2026,'week':4},games,rows,'2026-11-02T00:00:00Z')
  v=x['teams']['TB']['windows']['last3']['WR']['receiving_yards']
  self.assertEqual(v,{'average':60,'games':3,'window_games':3})
  self.assertEqual(x['teams']['TB']['through_week'],3)
  self.assertIsNone(x['teams']['ATL']['windows']['last3']['WR']['receiving_yards']['average'])
 def test_missing_duplicate_and_zero_rows_are_distinct(self):
  games=[self.game(1),self.game(2),self.game(3)]
  rows=[self.row('a','RB',1,0),self.row('a','RB',2,10),self.row('a','RB',2,10)]
  x=build({'season':2026,'week':4},games,rows,'2026-11-02T00:00:00Z')
  v=x['teams']['TB']['windows']['last3']['RB']['receiving_yards']
  self.assertEqual(v,{'average':0,'games':1,'window_games':3})
 def test_qb_td_totals_include_multiple_quarterbacks(self):
  rows=[self.row('a','QB',1,0),self.row('b','QB',1,0)]
  x=build({'season':2026,'week':2},[self.game(1)],rows,'2026-11-02T00:00:00Z')
  self.assertEqual(x['teams']['TB']['windows']['season']['QB']['passing_tds']['average'],4)

 def test_unclassified_production_does_not_silently_undercount_a_position(self):
  rows=[self.row('a','WR',1,20),self.row('b',None,1,50)]
  x=build({'season':2026,'week':2},[self.game(1)],rows,'2026-11-02T00:00:00Z')
  self.assertIsNone(x['teams']['TB']['windows']['season']['WR']['receiving_yards']['average'])
