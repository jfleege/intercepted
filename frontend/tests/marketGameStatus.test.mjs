import assert from 'node:assert/strict';
import { test } from 'node:test';
import { marketGameCard, marketGameOpen, marketGameResults } from '../src/marketGameStatus.ts';

const game = {game_id: '2026_09_BUF_MIN', season: 2026, week: 9, away_team: 'BUF', home_team: 'MIN', game_date: '2026-11-09'};
const data = {season: 2026, week: 9, games: [game]};
const kickoff = '2026-11-10T01:15:00Z';
const start = Date.parse(kickoff);
const report = {kickoff, scoring: {away: {team: 'BUF'}, home: {team: 'MIN'}}};
const research = {season: 2026, week: 9, games: {[game.game_id]: report}};
const feed = row => ({schema_version: 1, datasets: {verified: {v5_qb_plus: {rows: [{...game, kickoff, ...row}]}}}});

test('a game closes exactly at kickoff, including a Monday night game after UTC midnight', () => {
  const result = marketGameResults(data, research, null).get(game.game_id);
  assert.deepEqual(marketGameCard(game, result, start - 1), {open: true, label: 'Upcoming'});
  assert.deepEqual(marketGameCard(game, result, start), {open: false, label: 'Started'});
  assert.equal(marketGameOpen(result, start + 1), false);
});

test('verified finals and cancellations override the clock and pending model rows', () => {
  const performance = feed({status: 'final', grade: 'tie'});
  performance.datasets.verified.v4_a = feed({status: 'pending'}).datasets.verified.v5_qb_plus;
  const final = marketGameResults(data, research, performance).get(game.game_id);
  assert.deepEqual(marketGameCard(game, final, start - 60_000), {open: false, label: 'Final'});
  const cancelled = marketGameResults(data, research, feed({status: 'cancelled'})).get(game.game_id);
  assert.deepEqual(marketGameCard(game, cancelled, start - 60_000), {open: false, label: 'Cancelled'});
});

test('matches kickoff by slate and teams, and blocks selection when kickoff is unknown', () => {
  const result = marketGameResults(data, null, feed({status: 'pending'})).get(game.game_id);
  assert.equal(marketGameOpen(result, start - 1), true);
  const unknown = marketGameResults(data, {...research, week: 8}, feed({home_team: 'DET', status: 'final'})).get(game.game_id);
  assert.deepEqual(marketGameCard(game, unknown, start - 1), {open: false, label: 'Kickoff TBD'});
  assert.deepEqual(marketGameCard(game, unknown, start + 86_400_000), {open: false, label: 'Closed'});
});

test('conflicting kickoff sources close at the earlier verified cutoff', () => {
  const later = '2026-11-10T02:15:00Z';
  const result = marketGameResults(data, research, feed({kickoff: later})).get(game.game_id);
  assert.equal(result.kickoff, kickoff);
  assert.equal(marketGameOpen(result, start + 1), false);
});
