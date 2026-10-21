import test from 'node:test';
import assert from 'node:assert/strict';
import {seasonRecord,modelAgreement} from '../src/dashboardMetrics.ts';
const row=(id,week,grade,season=2026)=>({game_id:id,season,week,grade,game_date:`2026-10-${String(week).padStart(2,'0')}`});
test('season record excludes other seasons and future weeks; pending and ties do not grade',()=>{
 const rows=[row('a',6,'correct'),row('b',6,'incorrect'),row('c',7,'pending'),row('d',6,'tie'),row('e',8,'correct'),row('f',6,'correct',2025)];
 const r=seasonRecord(rows,2026,7);
 assert.deepEqual([r.total,r.graded,r.correct,r.incorrect,r.pending,r.excluded,r.accuracy],[4,2,1,1,1,1,.5]);
 assert.equal(seasonRecord(rows,2026,6).total,3);assert.deepEqual(r.trend,[1,.5]);
});
test('records preserve first snapshot, report real weekly change, and do not invent empty accuracy',()=>{
 const r=seasonRecord([row('a',5,'incorrect'),row('a',5,'correct'),row('b',6,'correct')],2026,7);
 assert.equal(r.total,2);assert.equal(r.accuracy,.5);assert.equal(r.delta,1);
 assert.equal(seasonRecord([row('c',7,'pending')],2026,7).accuracy,null);
 assert.equal(seasonRecord([],2026,7).delta,null);
});
const game=(id,values)=>({game_id:id,home_team:'CHI',away_team:'NE',home_win_prob_v4_a:values[0],home_win_prob_v4_qb_plus:values[1],home_win_prob_v5_qb_plus:values[2],home_win_prob_v5_boosted:values[3]});
test('agreement uses unanimous winner picks, not average confidence or majority rate',()=>{
 const r=modelAgreement([game('a',[.51,.6,.9,.7]),game('b',[.8,.7,.6,.2]),game('c',[.1,.4,.6,.7])]);
 assert.equal(r.models.length,4);assert.equal(r.unanimous,1);assert.equal(r.rate,1/3);
 assert.deepEqual(r.points.map(p=>p.votes),[4,3,2]);assert.equal(r.points[2].pick,null);
});
test('archived agreement uses only models actually saved for every matchup',()=>{
 const r=modelAgreement([game('a',[.6,.7]),game('b',[.4,.6])]);
 assert.equal(r.models.length,2);assert.equal(r.rate,.5);
 assert.equal(modelAgreement([]).rate,null);
 assert.equal(modelAgreement([game('a',[.6,NaN])]).rate,null);
});
