import {useEffect,useState} from 'react';
import {fetchSnapshot} from './snapshotCache';
type Value={average:number|null;games:number;window_games:number};
type Report={schema_version:number;season:number;week:number;teams:Record<string,{through_week:number;windows:Record<string,Record<string,Record<string,Value>>>}>};
export default function PositionDefense({season,week,opponent,position}:{season:number;week:number;opponent:string;position:string}){
 const [report,setReport]=useState<Report|null>(null),[window,setWindow]=useState('last3');
 useEffect(()=>{let active=true;fetchSnapshot(`${import.meta.env.BASE_URL}position_defense/${season}-week-${week}.json`).then(r=>r.ok?r.json():null).then(d=>{if(active)setReport(d);}).catch(()=>{if(active)setReport(null);});return()=>{active=false;};},[season,week]);
 const team=report?.schema_version===1&&report.season===season&&report.week===week?report.teams[opponent]:null;
 const values=team&&team.through_week<week?team.windows[window]?.[position]:null;
 const fields=position==='QB'?[['passing_yards','Passing yards'],['rushing_yards','Rushing yards'],['passing_tds','Passing TDs'],['rushing_tds','Rushing TDs']]:position==='RB'?[['rushing_yards','Rushing yards'],['receiving_yards','Receiving yards']]:[['receiving_yards','Receiving yards'],['rushing_yards','Rushing yards']];
 return <section className="mr-defense" aria-label={`${opponent} allowances to ${position}`}><h5>{opponent} allowed to opposing {position}s</h5><label>Window<select aria-label={`${opponent} defense window for ${position}`} value={window} onChange={e=>setWindow(e.target.value)}><option value="last3">Last 3 games</option><option value="last5">Last 5 games</option><option value="season">Season</option></select></label>{values?<><dl>{fields.map(([field,label])=>{const v=values[field];return <div key={field}><dt>{label} / game</dt><dd>{v?.average==null?'Unavailable':v.average.toFixed(1)}<small>{v?`${v.games}/${v.window_games} games with data`:''}</small></dd></div>;})}</dl><p>Through Week {team!.through_week} · totals across all opposing {position}s, including OT.</p></>:<p>Matching position-level defensive data unavailable.</p>}<p>Historical allowances are context, not an individual player forecast or hit probability.</p></section>;
}
