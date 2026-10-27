import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSnapshotCache} from '../src/snapshotCache.ts';
test('concurrent consumers share a download; aborting one cannot break another',async()=>{
 let calls=0,release;const cache=createSnapshotCache(async()=>{calls++;await new Promise(r=>release=r);return Response.json({week:8});});
 const controller=new AbortController(),first=cache('/predictions.json',{signal:controller.signal});
 const second=cache('/predictions.json');controller.abort();await assert.rejects(first,{name:'AbortError'});release();
 assert.equal((await (await second).json()).week,8);assert.equal((await (await cache('/predictions.json')).json()).week,8);assert.equal(calls,1);
});
test('failed or malformed responses retry and cache expires on the shorter quote clock',async()=>{
 let calls=0,time=0;
 const cache=createSnapshotCache(async()=>{calls++;if(calls===1)return new Response('unavailable',{status:503});if(calls===2)return new Response('<html>bad</html>');return Response.json({version:calls});},()=>time);
 await assert.rejects(cache('/odds.json'));await assert.rejects(cache('/odds.json'));
 assert.equal((await (await cache('/odds.json')).json()).version,3);time=59_999;await cache('/odds.json');assert.equal(calls,3);
 time=60_000;assert.equal((await (await cache('/odds.json')).json()).version,4);
 const a=await cache('/research/2026-week-7.json');assert.equal((await a.json()).version,5);await cache('/research/2026-week-8.json');assert.equal(calls,6);
 time+=299_999;await cache('/research/2026-week-7.json');assert.equal(calls,6);time++;await cache('/research/2026-week-7.json');assert.equal(calls,7);
});
