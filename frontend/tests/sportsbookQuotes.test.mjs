import test from 'node:test';
import assert from 'node:assert/strict';
import {payout,quoteFor} from '../src/sportsbookQuotes.ts';

test('quotes require the exact book, player, side and threshold',()=>{
  const kickoff='2026-11-22T18:00:00Z', saved='2026-11-22T12:00:00Z', now=Date.parse(saved);
  const leg={game_id:'2026_11_NYJ_LAC',team:'NYJ',name:'Geno Smith',target:'attempts',direction:'over',line:19.5,kickoff};
  const outcome={description:'Geno Smith',name:'Over',point:19.5,price:-105};
  const market={key:'player_pass_attempts_alternate',last_update:saved,outcomes:[outcome]};
  const offer={kickoff,home_team:'LAC',away_team:'NYJ',observed_at:saved,markets:[],by_book:{fanduel:[market]}};
  const feeds={games:null,props:{games:{[leg.game_id]:offer}}};
  assert.equal(quoteFor(leg,'fanduel',feeds,now)?.odds,-105);
  assert.equal(quoteFor(leg,'draftkings',feeds,now),null);
  assert.equal(quoteFor({...leg,line:20},'fanduel',feeds,now),null);
  assert.equal(quoteFor({...leg,direction:'under'},'fanduel',feeds,now),null);
  assert.equal(quoteFor(leg,'fanduel',feeds,Date.parse(kickoff)),null);
});
test('return includes stake and profit is displayed separately',()=>{
  assert.deepEqual(payout(240,5),{returned:'17.00',profit:'12.00'});
  assert.deepEqual(payout(-125,2),{returned:'3.60',profit:'1.60'});
});
