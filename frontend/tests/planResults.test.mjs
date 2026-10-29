import test from 'node:test';
import assert from 'node:assert/strict';
import {gradeSelection} from '../src/planResults.ts';
const offer={game_id:'g',player_id:'p',kickoff:'2026-10-25T17:00:00Z',forecastAt:'2026-10-23T00:00:00Z',category:'yardage',target:'rushing',direction:'over',line:60};
const row={game_id:'g',player_id:'p',family:'yardage',target:'rushing',actual:70,status:'graded'};
test('plan results retain boundaries and refuse ambiguous or postgame evidence',()=>{
 assert.equal(gradeSelection(offer,'2026-10-24',[row]).status,'hit');
 assert.equal(gradeSelection({...offer,direction:'under'},'2026-10-24',[row]).status,'miss');
 assert.equal(gradeSelection({...offer,line:70},'2026-10-24',[row]).status,'push');
 assert.equal(gradeSelection(offer,'2026-10-26',[row]).status,'unverified');
 assert.equal(gradeSelection(offer,'2026-10-24',[{...row,actual:null}]).status,'pending');
 assert.equal(gradeSelection(offer,'2026-10-24',[row,{...row,actual:80}]).status,'conflicting_results');
 assert.equal(gradeSelection(offer,'2026-10-24',[{...row,player_id:'other'}]).status,'pending');
});
