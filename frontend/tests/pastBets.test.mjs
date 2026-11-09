import assert from 'node:assert/strict';
import { test } from 'node:test';
import { betReturn, netBetProfit, parseBetAmount, readPastBets, savePastBet, summarizePastBets } from '../src/pastBets.ts';

const parlay = {
  id: 'one', name: 'Two legs', date: '2026-11-08', stake: 2000, returned: 6400,
  result: 'Won', notes: 'Used the final payout from my bet slip.',
  legs: [{name: 'Buffalo moneyline', result: 'Won'}, {name: 'Seattle +3.5', result: 'Won'}],
};
const single = (id, result, returned, stake = 1500) => ({
  ...parlay, id, result, returned, stake, legs: [{name: 'Game total over 44.0', result: 'Pending'}],
});

test('money is parsed exactly and rejects blank, negative or sub-cent amounts', () => {
  assert.equal(parseBetAmount(' 20.05 '), 2005);
  assert.equal(parseBetAmount('.1'), 10);
  assert.equal(parseBetAmount('0'), 0);
  for (const invalid of ['', '-1', '2.001', 'Infinity', '1e2', '1000000.01']) {
    assert.equal(parseBetAmount(invalid), null, invalid);
  }
});

test('actual payout drives settled profit and only wins and losses count in the record', () => {
  assert.equal(betReturn('Lost', 1500, 9000), 0);
  assert.equal(betReturn('Push', 1500, null), 1500);
  assert.equal(betReturn('Void', 1500, null), 1500);
  assert.equal(betReturn('Pending', 1500, 9000), null);
  assert.equal(betReturn('Cash out', 1500, 1100), 1100);
  assert.equal(netBetProfit(parlay), 4400);
  assert.deepEqual(summarizePastBets([
    parlay, single('loss', 'Lost', 0), single('push', 'Push', 1500),
    single('void', 'Void', 1500), single('cash', 'Cash out', 1100),
    single('open', 'Pending', null),
  ]), {profit: 2500, staked: 9500, wins: 1, losses: 1});
});

test('saving edits updates the original bet and retains other records', () => {
  const other = single('other', 'Lost', 0);
  const edited = {...parlay, notes: 'Added a third leg', legs: [...parlay.legs, {name: 'Game total over 44.0', result: 'Push'}]};
  const records = savePastBet([other, parlay], edited, parlay);
  assert.deepEqual(readPastBets(JSON.stringify(records)), [other, edited]);
  assert.throws(() => savePastBet(records, parlay, parlay), /changed in another tab/);
  assert.deepEqual(savePastBet(records, single('new', 'Pending', null)).slice(0, 2), records);
});

test('malformed history, invalid dates and impossible stored refunds fail validation', () => {
  assert.deepEqual(readPastBets(null), []);
  for (const invalid of [[parlay, parlay], [{...parlay, date: '2026-02-30'}],
    [single('bad', 'Lost', 1500)], [single('bad', 'Pending', 0)], [{...parlay, legs: []}]]) {
    assert.throws(() => readPastBets(JSON.stringify(invalid)));
  }
  assert.throws(() => readPastBets('['));
});
