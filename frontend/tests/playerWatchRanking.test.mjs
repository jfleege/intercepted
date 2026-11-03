import test from 'node:test';
import assert from 'node:assert/strict';
import {rankWatchPlayers,watchTouchdown} from '../src/playerWatchRanking.ts';
const player=(id, position='WR', recent=60, season=50)=>({player_id:id,name:id,team:'NE',position,recent_average:recent,season_average:season,trend_pct:(recent/season-1)*100});
const data=(players)=>({season:2026,week:7,games:{game:{away_team:'NE',home_team:'CHI',away_players:players,home_players:[]}}});
const report=(players)=>({season:2026,week:7,games:{game:{players:players.map(([id,yards,position='WR'])=>({player_id:id,position,team:'NE',opponent:'CHI',status:'available',stat:position==='QB'?'passing':'receiving',expected_yards:yards,range_80:[0,yards+30]}))}}});
test('projection can change top ranking even when recent trend alone favors another player',()=>{
 const d=data([player('small','WR',20,10),player('large','WR',80,60),player('middle','WR',55,50)]);
 const r=report([['small',15],['large',90],['middle',60]]);
 assert.equal(rankWatchPlayers(d,r,'form').players[0].player_id,'small');
 assert.equal(rankWatchPlayers(d,r,'blend').players[0].player_id,'large');
});
test('wrong week, game, team, opponent, stat and nonfinite estimates cannot enter blend',()=>{
 const d=data([player('one')]); const r=report([['one',50]]);
 for(const change of [r=>r.week++,r=>r.games.other=r.games.game&&delete r.games.game,r=>r.games.game.players[0].team='CHI',r=>r.games.game.players[0].opponent='BUF',r=>r.games.game.players[0].stat='passing',r=>r.games.game.players[0].expected_yards=NaN]){
  const bad=structuredClone(r);change(bad);assert.equal(rankWatchPlayers(d,bad,'blend').blended,false);
 }
});
test('position normalization does not automatically put passing yards first; ties stable',()=>{
 const d=data([player('a'),player('z','QB',300,250)]);const r=report([['a',60],['z',300,'QB']]);
 const ranked=rankWatchPlayers(d,r,'blend').players;
 assert.deepEqual(ranked.map(p=>p.watchScore),[50,50]);assert.equal(ranked[0].player_id,'a');
});
test('deduplicates players, caps at ten and permits projected players with negative form',()=>{
 const players=Array.from({length:12},(_,i)=>player(String(i),'WR',40,50));
 const result=rankWatchPlayers(data([...players,players[0]]),report(players.map(p=>[p.player_id,50])),'blend');
 assert.equal(result.total,12);assert.equal(result.players.length,10);
 assert.equal(new Set(result.players.map(p=>p.player_id)).size,10);
 assert.equal(rankWatchPlayers(data(players),null,'form').players.length,0);
});

test('TD probability uses the correct event and never substitutes passing for scoring',()=>{
 const p={passing_td_probability:.81,anytime_td_probability:.12};
 assert.deepEqual(watchTouchdown('QB',p),{label:'1+ passing TD',probability:.81});
 assert.deepEqual(watchTouchdown('WR',p),{label:'1+ rush/receiving TD',probability:.12});
 assert.equal(watchTouchdown('QB',{anytime_td_probability:.3}).probability,null);
 for(const value of [NaN,Infinity,-.1,1.1,null]) assert.equal(watchTouchdown('RB',{anytime_td_probability:value}).probability,null);
 assert.equal(watchTouchdown('RB',{anytime_td_probability:0}).probability,0);
});
