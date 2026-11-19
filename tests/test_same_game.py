import json
import tempfile
import unittest
from pathlib import Path

from src.ml.same_game import board, combinations, grade_saved, publish, stamp, write_json


class SameGameTests(unittest.TestCase):
    def test_rankings_use_distinct_players_and_bounds(self):
        legs = [dict(player_id=str(i), stat='passing_tds', threshold=1, probability=p)
                for i, p in enumerate([.8, .75, .7, .65, .6, .55])]
        legs.append({**legs[0], 'threshold': 2, 'probability': .7})
        picks = combinations(legs, 2)
        self.assertEqual((picks[0]['lower'], picks[0]['upper']), (.55, .75))
        long = combinations(legs, 5)
        self.assertEqual(long[0]['lower'], 0)
        self.assertEqual(len({leg['player_id'] for leg in long[0]['legs']}), 5)
        self.assertEqual(combinations(legs, 10), [])

    def test_availability_and_green_evidence_gate(self):
        game = {'game_id': 'g', 'home_team': 'HOU', 'away_team': 'IND'}
        time = '2026-11-19T18:00:00+00:00'
        report = dict(generated_at=time, kickoff='2026-11-20T01:15:00+00:00', players=[
            dict(player_id=pid, team='HOU', opponent='IND', position='WR', status='available', name=pid, anytime_td_probability=.8)
            for pid in ('a', 'b', 'out')
        ])
        extensions = {('g', row['player_id'], 'HOU', 'IND'): dict(kickoff=report['kickoff'], role_rank=1,
                      availability_evidence={'blocked':row['player_id']=='out'}) for row in report['players']}
        self.assertEqual(board(game, report, extensions, stamp(time), False)['signal'], 'limited')
        result = board(game, report, extensions, stamp(time), True)
        self.assertEqual(result['signal'], 'strong')
        self.assertEqual([leg['player_id'] for leg in result['options']['2'][0]['legs']], ['a', 'b'])
        self.assertEqual(board(game, report, extensions, stamp('2026-11-23T18:00:00+00:00'), True)['signal'], 'none')

    def test_freeze_and_grade_without_treating_missing_stats_as_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            game = dict(game_id='g', season=2026, week=11, home_team='HOU', away_team='IND',
                        gameday='2026-11-19', gametime='19:15', home_score=20, away_score=10, result=10)
            start = '2026-11-20T01:15:00+00:00'
            time = '2026-11-19T20:00:00+00:00'
            after = '2026-11-21T20:00:00+00:00'
            players = [dict(player_id=pid, team='HOU', opponent='IND', position='WR', status='available', name=pid, anytime_td_probability=.8) for pid in ('a','b')]
            write_json(root / 'predictions.json', dict(season=2026, week=11, games=[game]))
            write_json(root / 'matchup_research.json', dict(season=2026, week=11, games={'g':dict(generated_at=time,kickoff=start,players=players)}))
            publish(root, time, validated=False)
            path = root / 'same_game/2026-week-11.json'
            originally_saved = path.read_text()
            publish(root, after, validated=False)
            self.assertEqual(path.read_text(), originally_saved)
            rows = [dict(season=2026, week=11, team='HOU', player_id=pid, rushing_tds=0, receiving_tds=1) for pid in ('a','b')]
            for stats, expected in [(rows[:1], 'incomplete'), (rows, 'hit')]:
                grade_saved({'g':game}, stats, after, root)
                option = json.loads(path.read_text())['games']['g']['options']['2'][0]
                self.assertEqual(option['result'], expected)
