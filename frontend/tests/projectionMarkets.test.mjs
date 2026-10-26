import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildOffers,editTarget,selectLeg,signature,slipAmounts,makeDraft,readDrafts,researchCombinations,estimatedEV,profile} from '../src/projectionMarkets.ts';
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const data=read('../public/predictions.json'),research=read(`../public/research/${data.season}-week-${data.week}.json`),odds=read('../public/odds.json');
const now=Math.min(...Object.values(research.games).map(r=>Date.parse(r.kickoff)))-3600000;
const offers=buildOffers(data,research,odds,[],'v5_qb_plus',now);
test('real saved slate supplies each eligible tracked player without inventing yardage hit rates or prop prices',()=>{
 const eligible=Object.values(research.games).flatMap(g=>g.players).filter(p=>p.status==='available'&&Number.isFinite(p.expected_yards));
 const yards=offers.filter(o=>o.category==='yardage');assert.equal(yards.length,eligible.length);
 for(const o of yards){assert.equal(o.probability,null);assert.equal(o.price,null);assert.equal(o.custom,true);assert.equal(estimatedEV(o,now),null);}
 assert.ok(offers.some(o=>o.target==='passing_td'&&o.probability>.5));
});
test('wrong week and team identity cannot mix player forecasts with another slate',()=>{
 assert.ok(buildOffers(data,{...research,week:99},odds,[],'v5_qb_plus',now).every(o=>o.category==='moneyline'));
 const copy=structuredClone(research);for(const g of Object.values(copy.games))g.scoring.home.team='WRONG';
 assert.ok(buildOffers(data,copy,odds,[],'v5_qb_plus',now).every(o=>o.category==='moneyline'));
});
test('custom target invalidates quote, hit rate, and combined quote; opposite sides replace each other',()=>{
 const original=offers.find(o=>o.category==='total');const edited=editTarget({...original,probability:.7,price:-110,quoteFresh:true},42,'under');
 assert.equal(edited.probability,null);assert.equal(edited.price,null);assert.equal(edited.quoteFresh,false);
 assert.throws(()=>editTarget(original,-1,'over'));
 const a=offers.find(o=>o.category==='moneyline'),b=offers.find(o=>o.contract===a.contract&&o.id!==a.id);
 assert.deepEqual(selectLeg([a],b),[b]);
 const manual={signature:signature([original]),price:'+350'};
 assert.equal(slipAmounts([original],10,manual).profit,35);assert.equal(slipAmounts([edited],10,manual).profit,null);
 assert.equal(slipAmounts([a,b],10,null).total,null);
});
test('combinations use upcoming games, known probabilities and distinct games only; never fill an insufficient request',()=>{
 for(const factor of ['higher','even','longer','agreement']){const combo=researchCombinations(offers,factor,2,now);if(combo.length){assert.equal(combo.length,2);assert.equal(new Set(combo.map(o=>o.game_id)).size,2);assert.ok(combo.every(o=>o.probability!==null));}}
 assert.deepEqual(researchCombinations(offers,'higher',2,now+30*86400000),[]);
 assert.deepEqual(researchCombinations(offers.filter(o=>o.category==='yardage'),'higher',2,now),[]);
 assert.equal(profile(.65),'higher');assert.equal(profile(.45),'even');assert.equal(profile(.55),'even');assert.equal(profile(.6),'all');assert.equal(profile(null),'unscored');
});
test('drafts freeze evidence and cannot become verified or assign a joint probability',()=>{
 const leg=structuredClone(offers[0]),draft=makeDraft([leg],10,null,now);leg.market='changed';assert.notEqual(draft.legs[0].market,'changed');assert.equal(draft.joint_probability,null);assert.equal(draft.combined_price,null);assert.equal(draft.kind,'unverified_research_draft');
 assert.deepEqual(readDrafts(JSON.stringify([draft])),[draft]);assert.throws(()=>readDrafts('{broken'));assert.throws(()=>readDrafts(JSON.stringify([{...draft,kind:'verified'}])));assert.throws(()=>makeDraft([offers[0],offers[0]],10,null,now));assert.throws(()=>makeDraft([offers[0]],0,null,now));
});
test('stale or mismatched quotes cannot imply expected value',()=>{
 assert.ok(offers.filter(o=>o.category==='moneyline').every(o=>estimatedEV(o,now)===null));
 const leg={...offers[0],probability:.7,price:100,quoteFresh:true,kickoff:new Date(now+3600000).toISOString()};assert.ok(Math.abs(estimatedEV(leg,now)-.4)<1e-9);assert.equal(estimatedEV({...leg,quoteFresh:false},now),null);assert.equal(estimatedEV(leg,now+3600000),null);
});
