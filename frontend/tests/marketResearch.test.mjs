import test from 'node:test';
import assert from 'node:assert/strict';
import {appendBrowserSelection,candidates,decimalOdds,expectedReturn,freshQuote,gradeBrowserSelection,makeBrowserSelection,parseBrowserLedger} from '../src/marketResearch.ts';
const now=Date.parse('2026-10-18T12:00:00Z');
const line={game_id:'2026_06_A_B',home_team:'B',away_team:'A',kickoff:'2026-10-18T17:00:00Z',bookmaker:'DraftKings',home_price:-200,away_price:180,home_market_probability:.65,away_market_probability:.35,probabilities:{v4_a:.7,v4_qb_plus:.7},observed_at:'2026-10-18T11:59:00Z',last_update:'2026-10-18T11:58:00Z',can_record:true,odds_snapshot_id:'quote-1',forecast_snapshot_id:'forecast-1'};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);

test('expected return uses actual payout, not no-vig probability difference',()=>{
  close(decimalOdds(-200),1.5);close(decimalOdds(180),2.8);
  close(expectedReturn(.7,-200),.05);close(expectedReturn(.3,180),-.16);
  assert.ok(line.probabilities.v4_qb_plus>line.home_market_probability);
  assert.ok(expectedReturn(.66,-200)<0); // A market probability gap alone does not imply value.
  for(const p of [0,99,NaN,Infinity])assert.throws(()=>decimalOdds(p));
  for(const p of [-.1,1.1,NaN])assert.throws(()=>expectedReturn(p,-200));
});

test('ranking can favor the underdog over the more likely winner',()=>{
  const [best]=candidates({...line,probabilities:{v4_a:.6,v4_qb_plus:.6}},'v4_a',.05,now);
  assert.equal(best.team,'A');assert.equal(best.qualifies,true);close(best.expectedReturn,.12);
});

test('threshold boundary, no positive edge, and invalid thresholds',()=>{
  assert.equal(candidates(line,'v4_a',.05,now)[0].qualifies,true);
  assert.equal(candidates(line,'v4_a',.051,now).some(c=>c.qualifies),false);
  const even={...line,home_price:-110,away_price:-110,probabilities:{v4_a:.5,v4_qb_plus:.5}};
  assert.equal(candidates(even,'v4_a',0,now).some(c=>c.qualifies),false);
  for(const t of [-1,NaN,1.1])assert.throws(()=>candidates(line,'v4_a',t,now));
});

test('freshness rejects kickoff equality, stale quotes, future observations and server ineligibility',()=>{
  assert.equal(freshQuote(line,now),true);
  for(const changed of [{can_record:false},{last_update:'2026-10-16T00:00:00Z'},{observed_at:'2026-10-18T13:00:00Z'},{last_update:'2026-10-18T12:00:01Z'},{kickoff:'bad'}]){
    assert.equal(freshQuote({...line,...changed},now),false);
    assert.equal(candidates({...line,...changed},'v4_a',0,now).some(c=>c.qualifies),false);
  }
  assert.equal(freshQuote(line,Date.parse(line.kickoff)),false);
});

test('recording rechecks the clock and freezes quote and model evidence',()=>{
  const record=makeBrowserSelection(line,'v4_a','B',2,.05,now);
  assert.equal(record.price,-200);assert.equal(record.model_probability,.7);
  assert.equal(record.odds_snapshot_id,'quote-1');assert.equal(record.forecast_snapshot_id,'forecast-1');
  assert.equal(record.recorded_at,new Date(now).toISOString());
  assert.throws(()=>makeBrowserSelection(line,'v4_a','B',1,.05,Date.parse(line.kickoff)));
  for(const stake of [0,-1,NaN,Infinity])assert.throws(()=>makeBrowserSelection(line,'v4_a','B',stake,.05,now));
  assert.throws(()=>makeBrowserSelection(line,'v4_a','A',1,.05,now));
  assert.throws(()=>makeBrowserSelection({...line,odds_snapshot_id:''},'v4_a','B',1,.05,now));
});

test('duplicate selection cannot overwrite an original price',()=>{
  const first=makeBrowserSelection(line,'v4_a','B',1,.05,now);
  const changed=makeBrowserSelection({...line,home_price:-150},'v4_a','B',2,.05,now+1000);
  const rows=appendBrowserSelection([],first);
  assert.throws(()=>appendBrowserSelection(rows,changed));
  assert.equal(rows[0].price,-200);assert.equal(rows[0].stake,1);
  assert.equal(rows.length,1);
});

test('settlement handles all grades and score corrections without changing evidence',()=>{
  const record=makeBrowserSelection(line,'v4_a','B',2,.05,now);
  const original=JSON.stringify(record);
  const result={home_team:'B',away_team:'A',status:'final',home_score:20,away_score:10};
  assert.deepEqual(gradeBrowserSelection(record,result),{grade:'win',profit:1});
  assert.deepEqual(gradeBrowserSelection(record,{...result,away_score:30}),{grade:'loss',profit:-2});
  assert.deepEqual(gradeBrowserSelection(record,{...result,away_score:20}),{grade:'push',profit:0});
  assert.deepEqual(gradeBrowserSelection(record,{...result,status:'cancelled'}),{grade:'void',profit:0});
  for(const pending of [undefined,{...result,status:'pending'},{...result,home_team:'WRONG'},{...result,home_score:null}])assert.deepEqual(gradeBrowserSelection(record,pending),{grade:'pending',profit:null});
  assert.equal(JSON.stringify(record),original);
});

test('storage round trip and corrupted data are handled without silent replacement',()=>{
  const record=makeBrowserSelection(line,'v4_a','B',1,.05,now);
  assert.deepEqual(parseBrowserLedger(null),[]);
  assert.deepEqual(parseBrowserLedger(JSON.stringify([record])),[record]);
  for(const raw of ['bad','{}','[null]',JSON.stringify([record,record]),JSON.stringify([{...record,price:0}]),JSON.stringify([{...record,recorded_at:line.kickoff}])])assert.throws(()=>parseBrowserLedger(raw));
});
