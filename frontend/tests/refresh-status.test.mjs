import {test} from 'node:test';
import assert from 'node:assert/strict';
import {statusSummary, sourceNote, nextCheck} from '../src/refreshStatus.ts';
const now=Date.parse('2026-10-27T14:00:00Z');
const base={schema_version:1,snapshot_at:'2026-10-27T13:50:00Z',active_season:2026,active_week:7,sources:[],forecast_check:{checked_at:'2026-10-27T13:45:00Z',active_season:2026,active_week:7,target_season:2026,target_week:8,state:'waiting_stats',message:'Missing QB stats'}};
test('waiting stats and stale or failed refreshes use distinct evidence',()=>{
 assert.match(statusSummary(base,now).label,/Waiting for Week 8 stats/);
 assert.match(statusSummary({...base,snapshot_at:'2026-10-25T13:00:00Z'},now).label,/30 hours/);
 assert.match(statusSummary({...base,attempt:{steps:{research:'failure'}}},now).label,/did not complete/);
 assert.match(statusSummary({...base,last_successful_refresh_at:'2026-10-25T13:00:00Z'},now).label,/overdue/);
 assert.match(statusSummary({...base,sources:[{id:'research',season:2026,week:6}]},now).label,/different week/);
 assert.equal(statusSummary({...base,forecast_check:{...base.forecast_check,state:'current_limited_qb'}},now).label,'Current slate · limited QB tracking');
 assert.equal(statusSummary(null,now).tone,'muted');
 assert.equal(statusSummary({...base,snapshot_at:'invalid'},now).tone,'muted');
 assert.equal(statusSummary({...base,snapshot_at:'2026-11-01T00:00:00Z'},now).tone,'muted');
 assert.match(statusSummary({...base,forecast_check:{...base.forecast_check,checked_at:'2026-10-25T13:00:00Z'}},now).label,/needs an update/);
 assert.match(statusSummary({...base,forecast_check:{...base.forecast_check,active_week:6}},now).label,/not yet recorded/);
});
test('weekly forecast age is distinct from fresh exports and quote age',()=>{
 assert.equal(sourceNote({id:'forecasts',updated_at:'2026-10-20T13:00:00Z',season:2026,week:7,features_through_week:6},base,now),'Inputs through Week 6');
 assert.match(sourceNote({id:'props',updated_at:'2026-10-25T13:00:00Z'},base,now),/older than 24/);
 assert.match(sourceNote({id:'research',updated_at:'2026-10-27T13:50:00Z',season:2026,week:6},base,now),/different forecast week/);
 assert.match(sourceNote({id:'players',refresh_outcome:'failure'},base,now),/Update failed/);
 assert.match(sourceNote({id:'players',updated_at:'not-a-date'},base,now),/unverified/);
 assert.equal(nextCheck({...base,next_forecast_check_at:'2026-10-27T13:17:00Z'},now),null);
});
