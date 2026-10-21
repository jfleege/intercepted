import test from 'node:test';
import assert from 'node:assert/strict';
import {filterGames} from '../src/matchupFilters.ts';

const games = [
  {game_id:'b',game_date:'2026-10-25',home_team:'DEN',away_team:'SEA',home_win_prob_v4_a:.55},
  {game_id:'a',game_date:'2026-10-22',home_team:'BUF',away_team:'NE',home_win_prob_v4_a:.8},
  {game_id:'c',game_date:'2026-10-25',home_team:'KC',away_team:'LV',home_win_prob_v4_a:.4},
];
test('search matches team names and abbreviations regardless of case or surrounding spaces',()=>{
  assert.deepEqual(filterGames(games,'v4_a',' HAWKS ','date').map(g=>g.game_id),['b']);
  assert.deepEqual(filterGames(games,'v4_a','buf','date').map(g=>g.game_id),['a']);
});
test('sorting preserves date, confidence and closest-matchup behavior',()=>{
  assert.deepEqual(filterGames(games,'v4_a','','date').map(g=>g.game_id),['a','b','c']);
  assert.deepEqual(filterGames(games,'v4_a','','confidence').map(g=>g.game_id),['a','c','b']);
  assert.deepEqual(filterGames(games,'v4_a','','closest').map(g=>g.game_id),['b','c','a']);
});
test('filtering and sorting never mutate the saved slate',()=>{
  const before=structuredClone(games);
  filterGames(games,'v4_a','','confidence');
  assert.deepEqual(games,before);
  assert.deepEqual(filterGames([],'v4_a','','date'),[]);
});
