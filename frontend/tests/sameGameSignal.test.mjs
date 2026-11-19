import test from 'node:test';
import assert from 'node:assert/strict';
import {sameGameSignal} from '../src/sameGameSignal.ts';

test('poker chip tiers follow the leading combo lower bound', () => {
  assert.equal(sameGameSignal(.8).color, 'green');
  assert.equal(sameGameSignal(.799999).color, 'amber');
  assert.equal(sameGameSignal(.7).color, 'amber');
  assert.equal(sameGameSignal(.699999).color, 'red');
  assert.match(sameGameSignal().label, /No qualifying/);
  assert.match(sameGameSignal(NaN).label, /No qualifying/);
});
