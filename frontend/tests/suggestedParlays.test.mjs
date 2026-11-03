import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestedParlays } from '../src/suggestedParlays.ts';
const now = Date.parse('2026-11-03T12:00:00Z');
const pool = Array.from({length:8},(_,i)=>['moneyline','yardage','touchdown'].map((category,j)=>({id:`${i}:${j}`,game_id:`game${i}`,category,player_id:j?`player${i}`:null,probability:[.8,.7,.4][j]-i*.005,kickoff:new Date(now+86400000).toISOString(),forecastAt:new Date(now-60000).toISOString()}))).flat();
test('suggestions provide multiple profiles and leg counts with scored distinct games',()=>{
 const ideas=suggestedParlays(pool,now);
 assert.equal(new Set(ideas.map(i=>i.profile)).size,4);
 assert.ok(new Set(ideas.map(i=>i.legs.length)).size>=3);
 assert.equal(new Set(ideas.map(i=>i.id)).size,ideas.length);
 for(const idea of ideas)assert.equal(new Set(idea.legs.map(o=>o.game_id)).size,idea.legs.length);
 assert.ok(ideas.filter(i=>i.profile==='Mixed markets').every(i=>new Set(i.legs.map(o=>o.category)).size>1));
 assert.deepEqual(ideas,suggestedParlays([...pool].reverse(),now));
});
test('requested leg counts and eligibility remain strict',()=>{
 assert.ok(suggestedParlays(pool,now,5).every(i=>i.legs.length===5));
 const bad=pool.map(o=>({...o,probability:null}));assert.deepEqual(suggestedParlays(bad,now),[]);
 assert.deepEqual(suggestedParlays(pool,now+86400000),[]);
 assert.deepEqual(suggestedParlays(pool.filter(o=>o.game_id==='game0'),now),[]);
});
