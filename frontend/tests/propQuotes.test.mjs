import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOffers,pricedOffers,editTarget,estimatedEV,makeDraft} from '../src/projectionMarkets.ts';
const now=Date.parse('2026-10-22T12:00:00Z'),start='2026-10-25T17:00:00Z';
const game={game_id:'2026_07_SEA_DEN',home_team:'DEN',away_team:'SEA',home_win_prob_v4_a:.6,home_win_prob_v4_qb_plus:.6};
const data={season:2026,week:7,games:[game]};
const player={player_id:'nix',name:'Bo Nix',team:'DEN',opponent:'SEA',position:'QB',status:'available',stat:'passing',expected_yards:240,range_80:[150,330],anytime_td_probability:.2,passing_td_probability:.8};
const report={kickoff:start,generated_at:'2026-10-22T11:00:00Z',model_version:'v1',players:[player],scoring:{home:{team:'DEN',expected_points:24},away:{team:'SEA',expected_points:20},total:44,home_margin:4}};
const research={season:2026,week:7,games:{[game.game_id]:report}};
const quote={event_id:'ev1',home_team:'DEN',away_team:'SEA',kickoff:start,bookmaker:'DraftKings',observed_at:'2026-10-22T11:55:00Z',markets:[{key:'player_pass_yds',last_update:'2026-10-22T11:54:00Z',outcomes:[{description:'BO NIX',name:'Over',point:225.5,price:-110},{description:'Bo Nix',name:'Under',point:225.5,price:-115}]},{key:'player_anytime_td',last_update:'2026-10-22T11:54:00Z',outcomes:[{description:'Bo Nix',name:'Yes',price:350},{description:'Bo Nix',name:'No',price:-500}]}]};
const feed={schema_version:1,season:2026,week:7,exported_at:'2026-10-22T11:55:00Z',status:'cached',games:{[game.game_id]:quote}};
const base=()=>buildOffers(data,research,null,[],'v4_a',now);
const priced=(q=quote,f=feed,r=research,t=now)=>pricedOffers(base(),{...f,games:{[game.game_id]:q}},r,data,t);
test('exact saved book targets and both prices replace the guide, without inventing yardage probabilities',()=>{
 const rows=priced().filter(o=>o.category==='yardage');assert.equal(rows.length,2);assert.deepEqual(rows.map(o=>o.line),[225.5,225.5]);assert.deepEqual(rows.map(o=>o.price),[-110,-115]);assert.ok(rows.every(o=>o.probability===null&&!o.custom&&o.quoteFresh));assert.ok(rows.every(o=>o.prediction===240&&o.quoteEventId==='ev1'));
 const changed=editTarget(rows[0],230.5,'over');assert.equal(changed.price,null);assert.equal(changed.quoteEventId,null);assert.equal(changed.probability,null);assert.equal(changed.custom,true);
});
test('anytime Yes gets the matching conditional probability; passing TD probability never receives anytime odds',()=>{
 const td=priced().find(o=>o.target==='scoring_td');assert.equal(td.price,350);assert.equal(td.probability,.2);assert.equal(priced().find(o=>o.target==='passing_td').price,null);
 const frozen=makeDraft([td],10,null,now);assert.equal(frozen.legs[0].quotePlayer,'Bo Nix');assert.equal(frozen.legs[0].quoteMarketAt,'2026-10-22T11:54:00Z');assert.equal(frozen.combined_price,null);
});
test('wrong slate, opponent identity, kickoff, book, name, or stat cannot attach a price',()=>{
 for(const q of [{...quote,home_team:'KC'},{...quote,kickoff:'2026-10-26T17:00:00Z'},{...quote,bookmaker:'Other'},{...quote,markets:quote.markets.map(m=>({...m,outcomes:m.outcomes.map(o=>({...o,description:'Different Player'}))}))},{...quote,markets:quote.markets.map(m=>({...m,key:'player_rush_yds'}))}])assert.ok(priced(q).filter(o=>o.category==='yardage').every(o=>o.price===null));
 assert.ok(priced(quote,{...feed,week:8}).every(o=>o.price===null));
 const ambiguous={...research,games:{[game.game_id]:{...report,players:[player,{...player,player_id:'other',name:'Bo Nix Jr.'}]}}};assert.ok(priced(quote,feed,ambiguous).filter(o=>o.category==='yardage').every(o=>o.price===null));
});
test('stale, future, invalid timestamps and post-kickoff quotes cannot be called fresh or support EV',()=>{
 const later=now+2*86400000;
 for(const [q,t] of [[quote,later],[{...quote,observed_at:'2026-10-22T13:00:00Z'},now],[{...quote,markets:quote.markets.map(m=>({...m,last_update:'bad'}))},now],[quote,Date.parse(start)]]){
  const td=priced(q,feed,research,t).find(o=>o.target==='scoring_td');assert.equal(td.price,350);assert.equal(td.quoteFresh,false);assert.equal(estimatedEV(td,t),null);
 }
});
test('ambiguous or invalid outcomes are ignored instead of selecting an arbitrary price',()=>{
 const duplicate={...quote,markets:[{...quote.markets[0],outcomes:[quote.markets[0].outcomes[0],{...quote.markets[0].outcomes[0],price:-120}]}]};assert.equal(priced(duplicate).find(o=>o.category==='yardage').price,null);
 const invalid={...quote,markets:[{...quote.markets[0],outcomes:[{...quote.markets[0].outcomes[0],price:99},{...quote.markets[0].outcomes[1],point:NaN}]}]};assert.equal(priced(invalid).find(o=>o.category==='yardage').price,null);
});
