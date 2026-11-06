import test from 'node:test';
import assert from 'node:assert/strict';
import {likelihoodOffers,eligible,crossGameIdeas,probabilitySummary,decision,support,makePlan,readPlans,withoutPrice} from '../src/likelihoodMarkets.ts';
// A midweek revision can be published after one game starts and before another.
const now = Date.parse('2026-11-06T12:00:00Z');
const generated_at = '2026-11-06T09:00:00Z';
const games = [
  {game_id: 'started', away_team: 'JAX', home_team: 'BAL', home_win_prob_v5_qb_plus: .6},
  {game_id: 'upcoming', away_team: 'SEA', home_team: 'DEN', home_win_prob_v5_qb_plus: .7},
];
const data = {season: 2026, week: 9, generated_at, games};
const research = {
  season: data.season,
  week: data.week,
  games: Object.fromEntries(games.map((game, index) => [game.game_id, {
    kickoff: index === 0 ? '2026-11-06T01:00:00Z' : '2026-11-08T18:00:00Z',
    generated_at: '2026-11-05T12:00:00Z',
    model_version: 'research-fixture',
    players: [{player_id: 'rb', name: 'Example RB', team: game.home_team, opponent: game.away_team,
      status: 'available', position: 'RB', stat: 'rushing', expected_yards: 65}],
    scoring: {home: {team: game.home_team}, away: {team: game.away_team}, total: 45, home_margin: 3},
  }])),
};
const offers=likelihoodOffers(data,research,'v5_qb_plus',now),winner=offers.find(o=>o.category==='moneyline');
const offer=(id,game,p,extra={})=>({...winner,id,contract:game,game_id:game,probability:p,kickoff:new Date(now+86400000).toISOString(),forecastAt:new Date(now-60000).toISOString(),...extra});
test('Markets offers have no quotes, use winner snapshot time, and leave projection guides unscored',()=>{
 assert.ok(offers.length);for(const o of offers){assert.equal(o.price,null);assert.equal(o.bookmaker,null);assert.equal(o.quoteFresh,false);if(['yardage','spread','total'].includes(o.category))assert.equal(o.probability,null);}
 const moneylines = offers.filter(o => o.category === 'moneyline');
 assert.equal(moneylines.length, 4);
 for (const o of moneylines) {
   assert.equal(o.forecastAt, data.generated_at);
   assert.equal(eligible(o, now), o.game_id === 'upcoming');
 }
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

test('pins, exclusions and shared-leg limits constrain the alternatives',()=>{
 const pool=Array.from({length:6},(_,n)=>offer(`${n}`,`${n}`,.8));
 const pinned=crossGameIdeas(pool,'higher',3,3,now,{pinned:['0'],excluded:['5'],maxShared:1});
 assert.ok(pinned.length>0);assert.ok(pinned.every(x=>x.legs.some(o=>o.id==='0')&&!x.legs.some(o=>o.id==='5')));
 for(let i=0;i<pinned.length;i++)for(let j=0;j<i;j++)assert.ok(pinned[i].legs.filter(o=>pinned[j].legs.some(l=>l.id===o.id)).length<=1);
 assert.equal(crossGameIdeas(pool,'higher',3,3,now,{pinned:['missing']}).length,0);
});

test('expanded customization supports eight legs and 24 unique options, with custom probability floor',()=>{
 const pool=Array.from({length:14},(_,n)=>[offer(`${n}:a`,`${n}`,.8),offer(`${n}:b`,`${n}`,.6)]).flat();
 const ideas=crossGameIdeas(pool,'custom',8,24,now,{minimum:.55,maxShared:7,diversity:.5});
 assert.equal(ideas.length,24);assert.equal(new Set(ideas.map(i=>i.id)).size,24);
 for(const idea of ideas){assert.equal(idea.legs.length,8);assert.equal(new Set(idea.legs.map(l=>l.game_id)).size,8);assert.ok(idea.legs.every(l=>l.probability>=.55));}
 assert.deepEqual(crossGameIdeas(pool,'custom',2,24,now,{minimum:.9}),[]);
 for(const [count,limit] of [[9,24],[8,25],[2.5,6],[2,3.5]])assert.deepEqual(crossGameIdeas(pool,'higher',count,limit,now),[]);
});

test('hindsight uses only verified winning outcomes and pregame forecasts, and preserves actual save time',async()=>{
 const {retrospectiveResult}=await import('../src/likelihoodMarkets.ts');
 const {gradeSelection}=await import('../src/planResults.ts');
 const kickoff=now-10000,forecastAt=new Date(kickoff-10000).toISOString();
 const legs=[0,1,2,3].map(n=>offer(`past:${n}`,`past:${n}`,.7,{category:'yardage',player_id:`p${n}`,target:'rushing',line:49.5,direction:'over',kickoff:new Date(kickoff).toISOString(),forecastAt}));
 const rows=legs.map((o,n)=>({game_id:o.game_id,player_id:o.player_id,family:'yardage',target:'rushing',actual:n===3?40:60,status:'graded'}));
 const ideas=crossGameIdeas(legs,'higher',2,6,now,{retrospective:true,actuals:rows});assert.equal(ideas.length,3);assert.ok(ideas.every(i=>i.legs.every(o=>o.id!=='past:3')));
 assert.deepEqual(crossGameIdeas(legs,'higher',2,6,now),[]);
 for(const rows2 of [[],rows.map(r=>({...r,status:'pending'})),[...rows,...rows.map(r=>({...r,actual:0}))]])assert.deepEqual(crossGameIdeas(legs,'higher',2,6,now,{retrospective:true,actuals:rows2}),[]);
 assert.equal(retrospectiveResult({...legs[0],forecastAt:new Date(kickoff).toISOString()},rows).status,'unverified');
 const plan=makePlan(ideas[0].legs,now,true);assert.equal(plan.saved_at,new Date(now).toISOString());assert.equal(plan.retrospective,true);assert.deepEqual(readPlans(JSON.stringify([plan])),[plan]);
 assert.equal(gradeSelection(plan.legs[0],plan.saved_at,rows).status,'unverified');
 assert.equal(retrospectiveResult(plan.legs[0],rows).status,'hit');
 assert.throws(()=>readPlans(JSON.stringify([{...plan,retrospective:'yes'}])));
});
