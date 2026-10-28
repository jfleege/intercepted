import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {likelihoodOffers,eligible,crossGameIdeas,probabilitySummary,decision,support,makePlan,readPlans,withoutPrice} from '../src/likelihoodMarkets.ts';
const data=JSON.parse(readFileSync(new URL('../public/predictions.json',import.meta.url)));
const research=JSON.parse(readFileSync(new URL(`../public/research/${data.season}-week-${data.week}.json`,import.meta.url)));
const now=Math.min(...Object.values(research.games).map(r=>Date.parse(r.kickoff)))-3600000;
const offers=likelihoodOffers(data,research,'v5_qb_plus',now),winner=offers.find(o=>o.category==='moneyline');
const offer=(id,game,p,extra={})=>({...winner,id,contract:game,game_id:game,probability:p,kickoff:new Date(now+86400000).toISOString(),forecastAt:new Date(now-60000).toISOString(),...extra});
test('Markets offers have no quotes, use winner snapshot time, and leave projection guides unscored',()=>{
 assert.ok(offers.length);for(const o of offers){assert.equal(o.price,null);assert.equal(o.bookmaker,null);assert.equal(o.quoteFresh,false);if(['yardage','spread','total'].includes(o.category))assert.equal(o.probability,null);}
 assert.equal(winner.forecastAt,data.generated_at);assert.ok(offers.some(o=>o.category==='moneyline'&&eligible(o,now)));
 assert.ok(likelihoodOffers(data,{...research,week:99},'v5_qb_plus',now).every(o=>o.category==='moneyline'));
});
test('multiple ideas are deterministic, unique, exact-size, distinct-game and satisfy the profile',()=>{
 const pool=Array.from({length:6},(_,n)=>[offer(`${n}:a`,`${n}`,.8-n*.01),offer(`${n}:b`,`${n}`,.7-n*.005)]).flat();
 const result=crossGameIdeas(pool,'higher',3,6,now);assert.equal(result.length,6);assert.deepEqual(result,crossGameIdeas([...pool].reverse(),'higher',3,6,now));
 assert.equal(new Set(result.map(x=>x.id)).size,6);for(const x of result){assert.equal(x.legs.length,3);assert.equal(new Set(x.legs.map(o=>o.game_id)).size,3);assert.ok(x.legs.every(o=>o.probability>=.65));}
 assert.deepEqual(crossGameIdeas(pool.filter(o=>o.game_id==='0'),'higher',2,3,now),[]);assert.deepEqual(crossGameIdeas(pool,'higher',0,3,now),[]);
});
test('cutoff guards exclude missing/future forecast times, kickoff and unknown probabilities',()=>{
 const base=offer('a','a',.7),bad=[{forecastAt:null},{forecastAt:new Date(now+1).toISOString()},{kickoff:new Date(now).toISOString()},{probability:null},{probability:NaN},{probability:1.1}];
 for(const extra of bad)assert.equal(eligible({...base,...extra},now),false);
 assert.deepEqual(crossGameIdeas([base,...bad.map((e,n)=>offer('bad'+n,'bad'+n,.8,e))],'higher',2,3,now),[]);
});
test('agreement scores the selected side, near-even and longer respect event probabilities',()=>{
 const away=offer('away','a',.7,{modelRange:[.8,.7,.6]}),home=offer('home','b',.9,{modelRange:[.9,.4,.3]});assert.equal(support(away),1);assert.equal(support(home),1/3);
 const pool=[away,home,offer('c','c',.55,{modelRange:[.55,.6,.4]})];assert.ok(crossGameIdeas(pool,'agreement',2,3,now)[0].legs.some(o=>o.id==='away'));
 assert.ok(crossGameIdeas([offer('x','x',.5),offer('y','y',.55),offer('z','z',.8)],'even',2,3,now).every(x=>x.legs.every(o=>o.probability<=.55)));
 assert.deepEqual(crossGameIdeas([offer('x','x',.45),offer('y','y',.44)],'longer',2,3,now),[]);
});
test('Frechet bounds, hypothetical independence and percentage-point stress have known analytical results',()=>{
 const legs=[offer('a','a',.8),offer('b','b',.7)];const x=probabilitySummary(legs);assert.ok(Math.abs(x.lower-.5)<1e-12);assert.equal(x.upper,.7);assert.ok(Math.abs(x.independent-.56)<1e-12);
 const stressed=probabilitySummary(legs,10);assert.ok(Math.abs(stressed.lower-.3)<1e-12);assert.equal(stressed.upper,.6);
 assert.equal(probabilitySummary([{...legs[0],probability:null}]),null);assert.equal(probabilitySummary([],5),null);assert.equal(probabilitySummary(legs,-1),null);
 assert.equal(decision(offer('c','c',.64),.6,5).label,'Sensitive to assumptions');assert.equal(decision(offer('c','c',.55),.6,5).label,'Below your threshold');assert.equal(decision(offer('c','c',.7),.6,5).label,'Meets your threshold');
});
test('new plans freeze unpriced selections; malformed storage and duplicate contracts are rejected',()=>{
 const original=offer('a','a',.7,{price:150,bookmaker:'DraftKings',quoteAt:'old',quoteFresh:true});const plan=makePlan([original],now);
 assert.equal(plan.legs[0].price,null);assert.equal(plan.legs[0].bookmaker,null);assert.equal(plan.legs[0].quoteFresh,false);original.probability=.1;assert.equal(plan.legs[0].probability,.7);assert.deepEqual(readPlans(JSON.stringify([plan])),[plan]);
 assert.throws(()=>makePlan([plan.legs[0],plan.legs[0]],now));assert.throws(()=>readPlans('broken'));assert.throws(()=>readPlans(JSON.stringify([{...plan,legs:[{...plan.legs[0],price:100}]}])));assert.equal(withoutPrice(original).quoteAt,null);
});
