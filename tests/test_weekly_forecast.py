import unittest
from src.ml.weekly_forecast import target_slate, check_coverage, DataPending

NOW = '2026-10-20T12:00:00+00:00'
def row(week, **changes):
    return dict(game_id=f'2026_{week:02}_SEA_DEN',season=2026,week=week,game_type='REG',gameday='2026-10-18' if week==6 else '2026-10-25',gametime='13:00',home_team='DEN',away_team='SEA',home_score=None,away_score=None,result=None,**changes)

class WeeklyTests(unittest.TestCase):
    def test_advance_after_final(self):
        rows=[row(6),row(7)]
        self.assertEqual(target_slate(rows,NOW)[1],6)
        rows[0].update(home_score=20,away_score=10,result=10)
        self.assertEqual(target_slate(rows,NOW)[1],7)
        self.assertEqual(len(target_slate(rows,NOW)[2]),1)

    def test_not_advance_on_partial_or_future_final(self):
        games=[row(6),row(7)]
        games[0].update(home_score=20,away_score=10)
        self.assertEqual(target_slate(games,NOW)[1],6)
        games[0].update(result=10,gameday='2026-10-25')
        self.assertEqual(target_slate(games,NOW)[1],6)

    def test_postseason_and_offseason(self):
        games=[row(6),{**row(7),'game_type':'WC'}]
        games[0].update(home_score=20,away_score=10,result=10)
        self.assertIsNone(target_slate(games,NOW)[1])
        self.assertEqual(target_slate(games,'2027-01-01T12:00:00+00:00')[0],2026)

    def test_incomplete_team_and_qb_coverage(self):
        import polars as pl
        game={**row(6),'home_score':20,'away_score':10,'result':10}
        weekly=pl.DataFrame([{'game_id':game['game_id'],'season':2026,'week':6,'team':team} for team in ('SEA','DEN')])
        ngs=pl.DataFrame([{'season':2026,'week':6,'team_abbr':team,'attempts':20,'player_gsis_id':team} for team in ('SEA','DEN')])
        check_coverage([game],weekly,weekly,ngs,2026,7,NOW)
        with self.assertRaises(DataPending): check_coverage([game],weekly.head(1),weekly,ngs,2026,7,NOW)
        with self.assertRaises(DataPending): check_coverage([game],weekly,weekly,ngs.head(1),2026,7,NOW)
        with self.assertRaises(DataPending): check_coverage([game],pl.concat([weekly,weekly]),weekly,ngs,2026,7,NOW)

if __name__ == '__main__': unittest.main()
