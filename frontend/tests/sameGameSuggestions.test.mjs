import assert from 'node:assert/strict';
import test from 'node:test';
import {sameGameSuggestions} from '../src/sameGameSuggestions.ts';

test('same-game suggestions only use eligible exact matches from the current offer pool', () => {
  const kickoff = '2026-11-22T18:00:00Z';
  const saved_at = '2026-11-21T18:00:00Z';
  const now = Date.parse(saved_at);
  const common = {game_id:'g', team:'NYJ', kickoff, direction:'over', forecastAt:saved_at};
  const offers = [
    {...common,id:'qb-attempts',player_id:'qb',target:'attempts',line:19.5,probability:.9},
    {...common,id:'wr-yards',player_id:'wr',target:'receiving',line:24.5,probability:.8},
  ];
  const boards = {g:{kickoff,saved_at,forecast_at:saved_at,options:{2:[{result:'pending',legs:[
    {team:'NYJ',player_id:'qb',stat:'attempts',threshold:20},
    {team:'NYJ',player_id:'wr',stat:'receiving_yards',threshold:25},
  ]}]}}};
  const [option] = sameGameSuggestions(boards, offers, now, 2);
  assert.deepEqual(option.legs.map(leg=>leg.id), ['qb-attempts','wr-yards']);
  assert.equal(option.bounds.lower.toFixed(2), '0.70');
  assert.deepEqual(sameGameSuggestions(boards, offers.slice(0,1), now, 2), []);
  assert.deepEqual(sameGameSuggestions(boards, offers, Date.parse(kickoff), 2), []);
  assert.deepEqual(sameGameSuggestions(boards, [{...offers[0],line:20.5},offers[1]], now, 2), []);
});
