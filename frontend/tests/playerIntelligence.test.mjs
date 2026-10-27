import test from 'node:test';
import assert from 'node:assert/strict';
import {directory,average,reliability,playerGrades,filteredPlayers,windowHistory} from '../src/playerIntelligence.ts';
const slate={season:2026,week:7,games:[{game_id:'g',home_team:'DEN',away_team:'SEA'}]};
const p={player_id:'one',name:'Player One',team:'DEN',opponent:'SEA',position:'QB',game_id:'g',history:[{week:5},{week:6},{week:7}]};
const data={schema_version:1,season:2026,week:7,players:[p]};
test('directory rejects wrong slate and opponents, excludes future history, and deduplicates identities',()=>{
 assert.equal(directory(slate,{...data,week:8},null,null,[]).length,0);assert.equal(directory(slate,{...data,players:[{...p,opponent:'KC'}]},null,null,[]).length,0);
 const result=directory(slate,{...data,players:[p,p]},null,null,['one']);assert.equal(result.length,1);assert.equal(result[0].history.length,2);assert.equal(result[0].watchRank,1);
});
test('missing observations stay missing and window selection does not mutate histories',()=>{
 assert.equal(average([null,undefined,NaN]),null);assert.equal(average([0,null,10]),5);const history=Array.from({length:12},(_,i)=>({week:i+1}));const player={...p,history};assert.equal(windowHistory(player,'5').length,5);assert.equal(windowHistory(player,'10').length,10);assert.equal(history.length,12);
});
test('only the same player, stat, season, version and graded forecasts support reliability',()=>{
 const row={game_id:'g',season:2026,week:6,subject:'one',family:'yardage',target:'passing',status:'graded',prediction:200,actual:220,inside_range:true,version:'a'};
 const rows=[row,{...row,subject:'other'},{...row,target:'rushing'},{...row,season:2025},{...row,status:'pending'},{...row,week:8},{...row,version:'b',prediction:240,inside_range:null}];
 const kept=playerGrades(p,rows,2026,7,'a');assert.equal(kept.length,1);assert.deepEqual(reliability(kept),{samples:1,mae:20,coverage:1,rangeSamples:1});assert.equal(reliability(playerGrades(p,rows,2026,7)).rangeSamples,1);assert.equal(reliability([]).mae,null);
});
test('search and position/team filters compose without changing original directory',()=>{
 const a={...p,watchRank:2},b={...p,player_id:'two',name:'Other Player',position:'RB',watchRank:1};const original=[a,b];assert.equal(filteredPlayers(original,' PLAYER ','DEN','QB','watch')[0].player_id,'one');assert.equal(filteredPlayers(original,'','all','all','watch')[0].player_id,'two');assert.deepEqual(original,[a,b]);
});
