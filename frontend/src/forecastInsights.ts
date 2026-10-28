export type Availability={status:string;practice:string|null;injury:string|null;observed_at:string|null;report_updated_at:string|null;source:string;reason:string;blocked:boolean};
export type PlayerContext={player_id:string;game_id:string;team:string;opponent:string;name:string;position:string;kickoff:string|null;availability:Availability;starter:{status:string;rank:number|null;updated_at:string|null;source:string;reason:string};usage:{status:string;field?:string;estimate:number|null;recent_average?:number;last?:number;observed_range?:number[];samples:number;through_week?:number;version:string;method?:string}};
export type ForecastChange={id:string;game_id:string;season:number;week:number;matchup:string;field:string;label:string;player_id?:string;unit:string;before:string|number|null;after:string|number|null;delta:number|null;previous_observed_at:string;observed_at:string;source_at?:string;reasons:string[]};
export type Signal={id:string;severity:string;message:string;game_id?:string;target?:string;version?:string};
export type CalibrationWatch={target:string;version:string;family:string;samples:number;minimum:number;status:string;windows:{samples:number;predicted:number;observed:number;gap:number;ece:number;start:string;end:string}[]};
export type ForecastInsights={schema_version:number;season:number;week:number;exported_at:string;tracking_started_at:string;sources:Record<string,{status:string;observed_at:string;rows:number;latest_report_at?:string}>;players:PlayerContext[];changes:ForecastChange[];usage_validation:{field:string;samples:number;mae:number;baseline_mae:number;version:string;evaluation:string}[];monitoring:{checked_at:string;alerts:Signal[];calibration:CalibrationWatch[];policy:{label:string;calibration_gap:number;automatic_retraining:boolean};automatic_retraining:boolean}};
export const fresh=(at:string|null|undefined,now:number,hours=48)=>{const age=now-Date.parse(at??'');return Number.isFinite(age)&&age>=0&&age<=hours*3600000;};
export function matchesInsights(feed:ForecastInsights|null,slate:{season:number;week:number}|null,now:number){return !!feed&&!!slate&&feed.schema_version===1&&feed.season===slate.season&&feed.week===slate.week&&fresh(feed.exported_at,now);}
export function findContext(feed:ForecastInsights|null,slate:{season:number;week:number}|null,id:string,game:string,team:string,opponent:string,now:number){
 if(!matchesInsights(feed,slate,now))return null;
 const matches=feed!.players.filter(p=>p.player_id===id&&p.game_id===game&&p.team===team&&p.opponent===opponent);
 return matches.length===1?matches[0]:null;
}
export function reportedOut(context:PlayerContext|null,now:number){return !!context&&context.availability.blocked&&context.availability.status==='Out'&&fresh(context.availability.observed_at,now)&&Number.isFinite(Date.parse(context.kickoff??''))&&now<Date.parse(context.kickoff!);}
export function availabilityLabel(context:PlayerContext|null,now:number){
 if(!context)return 'Availability unknown';
 if(!context.kickoff||now>=Date.parse(context.kickoff))return 'Pregame snapshot · game started/time unknown';
 if(!fresh(context.availability.observed_at,now))return 'Availability unknown';
 return context.availability.status!=='unknown'?`Reported ${context.availability.status.toLowerCase()}`:context.availability.practice?'Practice report · game status not posted':'Availability unknown';
}
export const starterLabel=(c:PlayerContext|null,now:number)=>!c||!fresh(c.starter.updated_at,now)||!c.kickoff||now>=Date.parse(c.kickoff)?'Starter status unknown':({listed_first_unit:'Depth-chart first unit',listed_reserve:`Depth-chart reserve · #${c.starter.rank}`,confirmed:'Reported confirmed starter',reported_expected:'Reported expected starter'}[c.starter.status]??'Starter status unknown');
export function displayValue(value:string|number|null,unit:string){return value===null?'Unavailable':typeof value==='number'?unit==='probability'?`${(value*100).toFixed(1)}%`:`${value.toFixed(1)}${unit==='yards'?' yd':unit==='points'?' pts':''}`:value.replaceAll('_',' ');}
export function changeDelta(change:ForecastChange){const d=change.delta;return d===null?'Updated':`${d>=0?'+':''}${(d*(change.unit==='probability'?100:1)).toFixed(1)}${change.unit==='probability'?' pp':change.unit==='yards'?' yd':change.unit==='points'?' pts':''}`;}
