import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gameScheduleLabel } from '../src/gameSchedule.ts';

const game = { home_team:'NYG', away_team:'WAS', game_date:'2026-11-12' };
const schedule = { home_team:'NYG', away_team:'WAS', kickoff:'2026-11-13T01:15:00Z', networks:['Prime Video'] };
test('kickoff rolls UTC into the correct Central date and U.S. listing', () => {
  assert.equal(gameScheduleLabel(game, schedule), 'Thu, Nov 12 · 7:15 PM CT · Prime Video');
});
test('Central daylight time is applied in summer', () => {
  assert.equal(gameScheduleLabel(game, {...schedule, kickoff:'2026-09-11T00:15:00Z', networks:[]}), 'Thu, Sep 10 · 7:15 PM CT');
});
test('unavailable or unrelated schedules never invent a time or channel', () => {
  assert.equal(gameScheduleLabel(game), 'Thu, Nov 12 · Time TBD');
  assert.equal(gameScheduleLabel(game, {...schedule, home_team:'DAL'}), 'Thu, Nov 12 · Time TBD');
  assert.equal(gameScheduleLabel(game, {...schedule, kickoff:'2026-11-12T19:15:00'}), 'Thu, Nov 12 · Time TBD');
});
test('saved kickoff is available without the schedule export', () => {
  assert.equal(gameScheduleLabel({...game, result:{kickoff:schedule.kickoff}}), 'Thu, Nov 12 · 7:15 PM CT');
});
