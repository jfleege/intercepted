import copy
import unittest

from src.ml.export_game_schedule import build_schedule


class GameScheduleTests(unittest.TestCase):
    def setUp(self):
        self.predictions = {'season': 2026, 'week': 10, 'games': [
            {'game_id': '2026_10_WAS_NYG', 'home_team': 'NYG', 'away_team': 'WAS'}]}
        self.scoreboard = {'season': {'year': 2026, 'type': 2}, 'week': {'number': 10}, 'events': [
            {'id': '123', 'date': '2026-11-13T01:15Z', 'competitions': [{
                'competitors': [{'homeAway': 'home', 'team': {'abbreviation': 'NYG'}},
                                {'homeAway': 'away', 'team': {'abbreviation': 'WSH'}}],
                'geoBroadcasts': [{'region': 'us', 'lang': 'en', 'type': {'shortName': 'Streaming'},
                                   'media': {'shortName': 'Prime Video'}}]}]}]}

    def export(self):
        return build_schedule(self.predictions, self.scoreboard, '2026-11-12T12:00:00Z')

    def test_alias_join_and_verified_kickoff(self):
        game = self.export()['games']['2026_10_WAS_NYG']
        self.assertEqual(game['kickoff'], '2026-11-13T01:15:00+00:00')
        self.assertEqual(game['networks'], ['Prime Video'])

    def test_wrong_week_or_season_rejected(self):
        for field, value in [('number', 9)]:
            self.scoreboard['week'][field] = value
            with self.assertRaises(ValueError):
                self.export()
        self.scoreboard['week']['number'] = 10
        self.scoreboard['season']['year'] = 2025
        with self.assertRaises(ValueError):
            self.export()

    def test_foreign_and_radio_listings_excluded(self):
        listings = self.scoreboard['events'][0]['competitions'][0]['geoBroadcasts']
        listings.extend([dict(listings[0], region='gb'), dict(listings[0], type={'shortName': 'Radio'})])
        self.assertEqual(self.export()['games']['2026_10_WAS_NYG']['networks'], ['Prime Video'])
        listings.clear()
        self.assertEqual(self.export()['games']['2026_10_WAS_NYG']['networks'], [])

    def test_ambiguous_matchup_and_missing_kickoff_rejected(self):
        self.scoreboard['events'].append(copy.deepcopy(self.scoreboard['events'][0]))
        with self.assertRaises(ValueError):
            self.export()
        self.scoreboard['events'].pop()
        self.scoreboard['events'][0]['date'] = '2026-11-12T19:15'
        with self.assertRaises(ValueError):
            self.export()
