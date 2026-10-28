import test from 'node:test';
import assert from 'node:assert/strict';
import {availabilityLabel,changeDelta,displayValue,findContext,fresh,matchesInsights,reportedOut,starterLabel} from '../src/forecastInsights.ts';
import {rankWatchPlayers} from '../src/playerWatchRanking.ts';
const now=Date.parse('2026-10-28T12:00:00Z'),slate={season:2026,week:8};
const context={player_id:'p1',game_id:'g1',team:'TB',opponent:'ATL',kickoff:'2026-10-29T20:00:00Z',availability:{status:'Out',observed_at:'2026-10-28T10:00:00Z',blocked:true,practice:'Did Not Participate In Practice'},starter:{status:'listed_first_unit',updated_at:'2026-10-28T07:00:00Z'}};
const feed={schema_version:1,...slate,exported_at:'2026-10-28T11:00:00Z',players:[context]};
test('context requires current slate, unique identity, team and opponent',()=>{
 assert.equal(findContext(feed,slate,'p1','g1','TB','ATL',now),context);
 for(const value of [null,{...feed,week:7},{...feed,season:2025},{...feed,exported_at:'2026-10-20T12:00:00Z'},{...feed,players:[context,context]}])assert.equal(findContext(value,slate,'p1','g1','TB','ATL',now),null);
 assert.equal(findContext(feed,slate,'p1','g1','ATL','TB',now),null);
 assert.equal(matchesInsights({...feed,exported_at:'2026-10-29T12:00:00Z'},slate,now),false);
});
test('reported out blocks only a fresh, pregame sourced record',()=>{
 assert.equal(reportedOut(context,now),true);
 assert.equal(reportedOut(null,now),false);
 assert.equal(reportedOut(context,Date.parse('2026-10-30T12:00:00Z')),false);
 assert.equal(reportedOut({...context,availability:{...context.availability,observed_at:'2026-10-20T12:00:00Z'}},now),false);
 assert.equal(reportedOut({...context,kickoff:null},now),false);
});
test('practice DNP and questionable do not invent an absence or healthy clearance',()=>{
 const c={...context,availability:{...context.availability,status:'unknown',blocked:false}};
 assert.equal(reportedOut(c,now),false);assert.match(availabilityLabel(c,now),/game status not posted/);
 assert.equal(availabilityLabel(null,now),'Availability unknown');
 assert.equal(reportedOut({...c,availability:{...c.availability,status:'Questionable'}},now),false);
});
test('depth first unit remains distinct from game-specific confirmation and expires',()=>{
 assert.equal(starterLabel(context,now),'Depth-chart first unit');
 assert.equal(starterLabel({...context,starter:{...context.starter,status:'confirmed'}},now),'Reported confirmed starter');
 assert.equal(starterLabel({...context,starter:{...context.starter,updated_at:'2026-10-01T12:00:00Z'}},now),'Starter status unknown');
 assert.equal(fresh('not-a-date',now),false);
});
test('probability movement uses percentage points and never a relative percent claim',()=>{
 assert.equal(displayValue(.6,'probability'),'60.0%');assert.equal(changeDelta({delta:.05,unit:'probability'}),'+5.0 pp');
 assert.equal(changeDelta({delta:-20,unit:'yards'}),'-20.0 yd');assert.equal(displayValue(null,'yards'),'Unavailable');
});
test('current reported-out exclusions apply in blended and form watch rankings',()=>{
 const p=i=>({player_id:`p${i}`,name:`Player ${i}`,team:'TB',position:'QB',recent_average:200+i*10,season_average:150,trend_pct:20+i});
 const data={...slate,games:{g1:{away_team:'ATL',home_team:'TB',away_players:[],home_players:[p(1),p(2),p(3)]}}};
 for(const mode of ['blend','form'])assert.equal(rankWatchPlayers(data,null,mode,['p2']).players.some(p=>p.player_id==='p2'),false);
 assert.equal(rankWatchPlayers(data,null,'form').players.length,3);
});
