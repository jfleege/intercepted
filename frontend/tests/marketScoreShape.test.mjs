import test from 'node:test';
import assert from 'node:assert/strict';
import {marketScoreShape} from '../src/marketScoreShape.ts';
test('paired spreads and total produce scoring totals on the correct sides',()=>{
 assert.deepEqual(marketScoreShape(50.5,-8.5,8.5),{away:29.5,home:21});
 assert.deepEqual(marketScoreShape(44,4,-4),{away:20,home:24});
 assert.deepEqual(marketScoreShape(44,0,0),{away:22,home:22});
});
test('missing, conflicting and impossible lines never produce an implied score',()=>{
 for(const args of [[null,-8,8],[44,null,4],[44,4,null],[44,-4,-4],[0,0,0],[44,-50,50],[NaN,0,0]])assert.equal(marketScoreShape(...args),null);
});
