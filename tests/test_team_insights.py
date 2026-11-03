import copy
import unittest
from src.features.team_insights import build_team_insights, ranks
NOW='2026-10-24T12:00:00+00:00'

def schedule(week):
    return {'game_id':f'g{week}', 'season':2026, 'week':week,'game_type':'REG','gameday':f'2026-09-{week*4:02}','gametime':'13:00','home_team':'CHI','away_team':'NE','home_score':7,'away_score':0,'result':7}

def plays(week, chi_epa=.2, ne_epa=-.1):
    common={'game_id':f'g{week}','season_type':'REG','total_home_score':7,'total_away_score':0,'play_type':'pass','success':1,'yardline_100':15,'third_down_converted':1,'third_down_failed':0,'pass_touchdown':0,'rush_touchdown':0,'interception':0,'fumble_lost':0}
    return [{**common,'posteam':'CHI','defteam':'NE','epa':chi_epa,'fixed_drive':1,'pass_touchdown':1},
            {**common,'posteam':'NE','defteam':'CHI','epa':ne_epa,'fixed_drive':2,'interception':1,'success':0}]

class TeamInsightTests(unittest.TestCase):
    def test_cutoff_ranks_and_real_movement(self):
        games=[schedule(w) for w in range(1,4)]
        rows=plays(1)+plays(2,-.5,.8)+plays(3,100,-100)
        result=build_team_insights(rows,games,2026,3,NOW)
        self.assertEqual(result['features_through_week'],2)
        self.assertEqual(result['teams']['CHI']['season']['games'],2)
        self.assertEqual(result['teams']['CHI']['off_rank'],2)
        self.assertEqual(result['teams']['CHI']['off_movement'],-1)
        self.assertEqual(result['teams']['NE']['off_movement'],1)
        self.assertEqual(result['teams']['NE']['def_movement'],1)
        self.assertEqual(result['teams']['CHI']['history'][-1]['week'],2)

    def test_td_drives_redzone_and_event_denominators(self):
        r=build_team_insights(plays(1),[schedule(1)],2026,2,NOW)['teams']
        self.assertEqual(r['CHI']['season']['pass_td_per_game'],1)
        self.assertEqual(r['CHI']['season']['td_drive_rate'],1)
        self.assertEqual(r['CHI']['season']['redzone_td_rate'],1)
        self.assertEqual(r['NE']['season']['redzone_td_rate'],0)
        self.assertEqual(r['NE']['season']['turnovers_per_100'],100)
        self.assertIsNone(r['CHI']['off_movement'])
        self.assertIsNone(r['CHI']['season']['rush_off_epa'])

    def test_missing_scores_or_team_plays_fail_instead_of_distorting_ranks(self):
        rows=plays(1);rows[0]['total_home_score']=0;rows[1]['total_home_score']=0
        with self.assertRaises(ValueError):build_team_insights(rows,[schedule(1)],2026,2,NOW)
        with self.assertRaises(ValueError):build_team_insights(plays(1)[:1],[schedule(1)],2026,2,NOW)

    def test_weighted_rates_and_zero_attempts(self):
        rows=plays(1);second=copy.deepcopy(rows[0]);second.update(epa=.8,pass_touchdown=0,third_down_converted=0,success=0)
        rows.append(second)
        r=build_team_insights(rows,[schedule(1)],2026,2,NOW)['teams']['CHI']['season']
        self.assertEqual(r['off_epa'],.5)
        self.assertEqual(r['success_rate'],.5)
        self.assertEqual(r['third_down_rate'],1)
        self.assertEqual(r['td_drive_rate'],1)

    def test_tied_values_share_competition_rank(self):
        data={'a':{'x':.1},'b':{'x':.1},'c':{'x':.2}}
        self.assertEqual(ranks(data,'x',False),{'a':1,'b':1,'c':3})

    def test_future_and_unfinished_games_excluded(self):
        games=[schedule(1),schedule(2)];games[1]['result']=None
        result=build_team_insights(plays(1)+plays(2),games,2026,4,NOW)
        self.assertEqual(result['teams']['NE']['season']['games'],1)

if __name__=='__main__':unittest.main()
