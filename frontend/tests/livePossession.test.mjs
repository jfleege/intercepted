import test from 'node:test';
import assert from 'node:assert/strict';
import {possessionSide} from '../src/livePossession.ts';
const competition={situation:{possession:'6'},competitors:[{id:'21',homeAway:'home',team:{id:'21',abbreviation:'PHI'}},{id:'6',homeAway:'away',team:{id:'6',abbreviation:'DAL'}}]};
test('explicit provider possession follows the correct team and changes sides',()=>{
 assert.equal(possessionSide(competition,'in',false,false),'away');
 assert.equal(possessionSide({...competition,situation:{possession:21}},'in',false,false),'home');
});
test('missing, ambiguous, unknown, stale, scheduled and final possession stays hidden',()=>{
 for(const c of [undefined,{...competition,situation:undefined},{...competition,situation:{possession:''}},{...competition,situation:{possession:'unknown'}},{...competition,competitors:[competition.competitors[1],competition.competitors[1]]}])assert.equal(possessionSide(c,'in',false,false),null);
 for(const [state,completed,failed] of [['pre',false,false],['post',true,false],['in',true,false],['in',false,true]])assert.equal(possessionSide(competition,state,completed,failed),null);
});
