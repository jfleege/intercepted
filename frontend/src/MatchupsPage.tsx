import LoadingSurface from "./LoadingSurface";
import { usePageActive } from "./pageActivity";
import { fetchSnapshot } from "./snapshotCache";
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Game, PredictionData } from './forecastTypes';
import { availableModels, MODEL_LABELS, probability } from './predictionModels';
import type { Model } from './predictionModels';
import { TEAM_NAMES } from './teams';
import MatchupProjections from './MatchupProjections';
import type { Report } from './MatchupProjections';
import DashboardMarkets from './DashboardMarkets';
import './MatchupReport.css';
import './MatchupsPage.css';

type Metrics = Record<string, number | null> & {games: number};
type Team = {season: Metrics; recent: Metrics; off_rank: number | null; def_rank: number | null; off_movement: number | null; def_movement: number | null; history: ({week: number; opponent: string} & Metrics)[]};
type Insights = {season: number; week: number; features_through_week: number; comparison_through_week: number; generated_at: string; teams: Record<string, Team>};
const format = (v: number | null | undefined, digits = 2) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—';
const pct = (v: number | null | undefined) => typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—';
function Logo({team}: {team: string}) {return <img className="mx-logo" src={`${import.meta.env.BASE_URL}logos/${team}.png`} alt="" loading="lazy"/>;}
function Legend({teams}: {teams: string[]}) {return <div className="mx-legend">{teams.map((t,i)=><span key={t}><i className={`mx-series-${i}`}/>{t}</span>)}</div>;}
function Ranking({kind, data, teams}: {kind: 'off' | 'def'; data: Insights; teams: string[]}) {
  const [expanded, setExpanded] = useState(false);
  const rankKey = kind === 'off' ? 'off_rank' : 'def_rank';
  const ordered = Object.entries(data.teams).filter(([,v])=>v[rankKey] != null).sort((a,b)=>a[1][rankKey]! - b[1][rankKey]! || a[0].localeCompare(b[0]));
  const shown = expanded ? ordered : ordered.filter(([t],i)=>i<8 || teams.includes(t));
  return <section className="mx-panel mx-ranking"><h2>{kind === 'off' ? 'Offensive' : 'Defensive'} power</h2><p className="mx-caption">{kind === 'off' ? 'EPA/play · higher is better' : 'EPA allowed/play · lower is better'}</p><div className="mx-rank-labels"><span>TEAM</span><span>EPA/PLAY · Δ</span></div>
    <ol>{shown.map(([t,v])=>{const movement=v[kind === 'off' ? 'off_movement' : 'def_movement'];return <li key={t} className={teams.includes(t)?'mx-selected-team':''}><span className="mx-rank-number">{v[rankKey]}</span><Logo team={t}/><abbr title={TEAM_NAMES[t] ?? t}>{t}</abbr><span className="mx-rank-value">{format(v.season[kind === 'off' ? 'off_epa' : 'def_epa'],3)}</span><span className={`mx-movement ${movement != null && movement>0?'mx-up':movement != null && movement<0?'mx-down':''}`} aria-label={movement == null ? 'No previous ranking' : movement>0?`Up ${movement} places`:movement<0?`Down ${-movement} places`:'Unchanged'}>{movement == null ? '—' : movement>0 ? `▲ ${movement}` : movement<0 ? `▼ ${-movement}` : '–'}</span></li>;})}</ol>
    <button type="button" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'Collapse league':`Full league · ${ordered.length} teams`}</button><p className="mx-caption">Change since Week {data.comparison_through_week}. Ties share a rank.</p>
  </section>;
}
function Bars({labels, values, teams, unit = '', digits = 1}: {labels: string[]; values: (number | null)[][]; teams: string[]; unit?: string; digits?: number}) {
  const max = Math.max(1, ...values.flat().filter((v): v is number=>v != null));
  return <div className="mx-bar-chart" role="img" aria-label={`${labels.join(', ')} comparison for ${teams.join(' and ')}; values are labeled.`}>{labels.map((label,i)=><div className="mx-bar-category" key={label}><span>{label}</span>{teams.map((t,j)=><div className="mx-bar-row" key={t}><small>{t}</small><div className="mx-track"><i className={`mx-series-${j}`} style={{width:`${Math.max(0,values[j][i] ?? 0)/max*100}%`}}/></div><b>{format(values[j][i],digits)}{values[j][i]!=null?unit:''}</b></div>)}</div>)}</div>;
}
function Strengths({a,h,teams}: {a?: Team; h?: Team; teams: string[]}) {
  const metrics=[['Pass offense','pass_off_epa'],['Rush offense','rush_off_epa'],['Pass defense','pass_def_epa'],['Rush defense','rush_def_epa']];
  const max=Math.max(.05,...metrics.flatMap(([,key])=>[Math.abs(a?.season[key]??0),Math.abs(h?.season[key]??0)]));
  return <div className="mx-efficiency">{metrics.map(([label,key])=><div className="mx-eff-row" key={key}><span>{label}</span>{[a,h].map((team,i)=>{const v=team?.season[key];return <div key={teams[i]}><small>{teams[i]}</small><div className="mx-diverge"><i className={`mx-series-${i}`} style={{left:`${v!=null&&v<0?50-Math.abs(v)/max*50:50}%`,width:`${Math.abs(v??0)/max*50}%`}}/></div><b>{v!=null&&v>0?'+':''}{format(v,3)}</b></div>;})}</div>)}<p className="mx-caption">Bars share a zero midpoint and scale. Lower defensive values are better.</p></div>;
}
function FormChart({a,h,teams}: {a?: Team; h?: Team; teams: string[]}) {
  const series=[a?.history.slice(-6)??[],h?.history.slice(-6)??[]];
  const records=series.flat();const weeks=[...new Set(records.map(r=>r.week))].sort((a,b)=>a-b);
  const vals=records.map(r=>r.off_epa).filter((v):v is number=>v!=null);
  if(!vals.length)return <p className="mx-empty">Efficiency history unavailable.</p>;
  const low=Math.min(0,...vals)-.03,high=Math.max(0,...vals)+.03;
  const x=(week:number)=>45+(week-weeks[0])/Math.max(1,weeks.at(-1)!-weeks[0])*330;
  const y=(v:number)=>145-(v-low)/(high-low)*110;
  return <><svg className="mx-line-chart" viewBox="0 0 400 180" role="img" aria-label={`Offensive EPA per play over up to six prior games: ${teams.join(' and ')}. Exact values are in the table.`}>{[low,0,high].map((v,i)=><g key={i}><line x1="45" x2="375" y1={y(v)} y2={y(v)}/><text x="39" y={y(v)+4} textAnchor="end">{v.toFixed(2)}</text></g>)}{series.map((rows,i)=><g key={teams[i]}><polyline className={`mx-line-${i}`} points={rows.filter(r=>r.off_epa!=null).map(r=>`${x(r.week)},${y(r.off_epa!)}`).join(' ')}/>{rows.filter(r=>r.off_epa!=null).map(r=><circle key={r.week} className={`mx-series-${i}`} cx={x(r.week)} cy={y(r.off_epa!)} r="3"><title>{teams[i]} Week {r.week}: {r.off_epa}</title></circle>)}</g>)}{weeks.map(w=><text key={w} x={x(w)} y="165" textAnchor="middle">W{w}</text>)}</svg><details className="mx-details"><summary>Game-by-game values</summary><table><thead><tr><th>Week</th>{teams.map(t=><th key={t}>{t} EPA/play</th>)}</tr></thead><tbody>{weeks.map(w=><tr key={w}><td>{w}</td>{series.map((s,i)=><td key={teams[i]}>{format(s.find(r=>r.week===w)?.off_epa,3)}</td>)}</tr>)}</tbody></table></details></>;
}
export default function MatchupsPage({data,games,game,model,onSelect,weekControl,error}: {data: PredictionData | null; games: Game[]; game: Game | null; model: Model; onSelect:(id:string)=>void; weekControl: ReactNode; error:string}) {
  const pageActive = usePageActive();
  const [insights,setInsights]=useState<Insights|null>(null);
  const [report,setReport]=useState<Report|null>(null);
  const [period,setPeriod]=useState<'quarters'|'halves'>('quarters');
  const [loading,setLoading]=useState(true);
  const key=data?`${data.season}-week-${data.week}`:'';
  useEffect(()=>{
    if(!key||!pageActive)return;
    const controller=new AbortController();
    const get=(path:string)=>fetchSnapshot(`${import.meta.env.BASE_URL}${path}`,{signal:controller.signal}).then(r=>{if(!r.ok)throw Error('Unavailable');return r.json();});
    Promise.allSettled([get(`team_insights/${key}.json`),get(`research/${key}.json`)]).then(results=>{
      if(controller.signal.aborted)return;
      const same=(v:{season:number;week:number})=>`${v.season}-week-${v.week}`===key;
      setInsights(results[0].status==='fulfilled'&&same(results[0].value)?results[0].value:null);
      setReport(results[1].status==='fulfilled'&&same(results[1].value)?results[1].value:null);
      setLoading(false);
    });return()=>controller.abort();
  },[key,pageActive]);
  const matching=insights&&data&&insights.season===data.season&&insights.week===data.week?insights:null;
  const research=report&&data&&report.season===data.season&&report.week===data.week?report:null;
  if(!data)return <section className="mx-page"><h1>Matchups</h1>{error?<p>{error}</p>:<LoadingSurface label="Loading matchups" kind="matchups"/>}</section>;
  const teams=game?[game.away_team,game.home_team]:[];
  const a=matching?.teams[teams[0]],h=matching?.teams[teams[1]];
  const score=game?research?.games[game.game_id]?.scoring:null;
  const periods=game?teams.map(t=>research?.period_trends.teams[t]):[];
  const periodLabels=period==='quarters'?['Q1','Q2','Q3','Q4']:['H1','H2'];
  return <div className="mx-page"><header className="mx-page-heading"><div><p className="ud-eyebrow">THE MATCHUP DESK</p><h1>Every angle. One game.</h1><p>Team strengths, scoring outlooks, and how the game develops.</p></div>{weekControl}</header>
    <div className="mx-slate" aria-label="Select matchup">{games.map(g=><button type="button" key={g.game_id} aria-pressed={g.game_id===game?.game_id} onClick={()=>onSelect(g.game_id)}><span><Logo team={g.away_team}/>{g.away_team}<small>@</small><Logo team={g.home_team}/>{g.home_team}</span><small>{g.game_date}</small></button>)}</div>
    {!game?<p className="mx-empty">No matchups match your search.</p>:<div className="mx-layout"><aside className="mx-rail" aria-label="Team power rankings">{matching?<>{(['off','def'] as const).map(kind=><Ranking key={kind} kind={kind} data={matching} teams={teams}/>)}</>:<section className="mx-panel"><h2>Team power rankings</h2><p>{loading?'Loading team context…':'No team ranking export is available for this week.'}</p></section>}</aside>
    <div className="mx-report" key={game.game_id}>
      <section className="mx-panel mx-briefing"><header><div><Logo team={teams[0]}/><h2>{teams[0]} <small>{TEAM_NAMES[teams[0]]}</small></h2><p>{game.away_projected_qb_name??'QB unavailable'}</p>{game.away_qb_selection?.ngs_coverage_note&&<small className="qb-coverage-note">{game.away_qb_selection.ngs_coverage_note}</small>}</div><span className="mx-at">@</span><div><Logo team={teams[1]}/><h2>{teams[1]} <small>{TEAM_NAMES[teams[1]]}</small></h2><p>{game.home_projected_qb_name??'QB unavailable'}</p>{game.home_qb_selection?.ngs_coverage_note&&<small className="qb-coverage-note">{game.home_qb_selection.ngs_coverage_note}</small>}</div></header><p className="mx-caption">{game.game_date} · Week {data.week} · projected quarterbacks</p>
      {score?<><div className="mx-scoreboard"><div><span>{teams[0]} expected points</span><strong>{format(score.away.expected_points,1)}</strong><small>80% range {score.away.range_80.map(v=>format(v,1)).join('–')}</small></div><div><span>Expected total</span><strong>{format(score.total,1)}</strong><small>80% range {score.total_range_80.map(v=>format(v,1)).join('–')}</small></div><div><span>{teams[1]} expected points</span><strong>{format(score.home.expected_points,1)}</strong><small>80% range {score.home.range_80.map(v=>format(v,1)).join('–')}</small></div></div><p className="mx-caption">Projected margin: {score.home_margin>=0?teams[1]:teams[0]} by {format(Math.abs(score.home_margin),1)} · experimental averages, not exact scores.</p>{research!.validation.scoring.margin.mae>=research!.validation.scoring.margin.baseline_mae&&<p className="mx-caption">Margin error did not beat the baseline in the 2025 benchmark.</p>}</>:<p className="mx-empty">No pregame scoring projection was saved for this matchup.</p>}</section>
      <div className="mx-two"><section className="mx-panel"><h2>Where models disagree</h2><p className="mx-caption">Home win probability · saved forecasts</p><Legend teams={teams}/>{availableModels([game],true).map(m=>{const p=probability(game,m);return <div className="mx-model-row" key={m}><span>{MODEL_LABELS[m]}</span><div className="mx-probability"><i style={{width:`${p*100}%`}}/></div><b>{pct(p)}</b></div>;})}</section>
      <section className="mx-panel"><h2>Matchup signals</h2><div className="mx-signals"><p><b>Model range</b>{format(Math.min(...availableModels([game],true).map(m=>probability(game,m)))*100,1)}–{format(Math.max(...availableModels([game],true).map(m=>probability(game,m)))*100,1)}% home win probability.</p><p><b>Passing comparison</b>{teams[0]} pass offense {format(a?.season.pass_off_epa,3)} EPA/play; {teams[1]} pass defense {format(h?.season.pass_def_epa,3)} allowed.</p><p><b>Scoring environment</b>Historical scoring: {teams[0]} {format(a?.season.points_per_game,1)} and {teams[1]} {format(h?.season.points_per_game,1)} points/game.</p></div><p className="mx-caption">Measured context, not a causal explanation of the winner model.</p></section></div>
      <section className="mx-panel"><div className="mx-heading"><div><h2>Strength meets resistance</h2><p className="mx-caption">Season passing and rushing efficiency</p></div><Legend teams={teams}/></div><Strengths a={a} h={h} teams={teams}/></section>
      <div className="mx-two"><section className="mx-panel"><div className="mx-heading"><div><h2>Touchdown production</h2><p className="mx-caption">Offensive TDs per game · excludes returns</p></div><Legend teams={teams}/></div><Bars teams={teams} labels={['Passing TDs / game','Rushing TDs / game']} values={[a,h].map(t=>[t?.season.pass_td_per_game??null,t?.season.rush_td_per_game??null])}/></section>
      <section className="mx-panel"><div className="mx-heading"><div><h2>Drive outcomes</h2><p className="mx-caption">Percentage of offensive drives</p></div><Legend teams={teams}/></div><Bars teams={teams} labels={['Touchdown drives','Field goal drives']} values={[a,h].map(t=>['td_drive_rate','fg_drive_rate'].map(k=>t?.season[k]!=null?t.season[k]!*100:null))} unit="%"/></section></div>
      <div className="mx-two"><section className="mx-panel"><div className="mx-heading"><div><h2>Scoring by period</h2><p className="mx-caption">Historical points/game · excludes OT</p></div><div className="mx-toggle"><button type="button" aria-pressed={period==='quarters'} onClick={()=>setPeriod('quarters')}>Quarters</button><button type="button" aria-pressed={period==='halves'} onClick={()=>setPeriod('halves')}>Halves</button></div></div><Legend teams={teams}/><Bars teams={teams} labels={periodLabels} values={periods.map(t=>periodLabels.map(label=>t?.summary.find(p=>p.period===label)?.points_for??null))}/></section>
      <section className="mx-panel"><div className="mx-heading"><div><h2>Offensive form</h2><p className="mx-caption">EPA/play · up to six completed games</p></div><Legend teams={teams}/></div><FormChart a={a} h={h} teams={teams}/></section></div>
      <div className="mx-two"><section className="mx-panel"><div className="mx-heading"><div><h2>Situational efficiency</h2><p className="mx-caption">Rates from completed games</p></div><Legend teams={teams}/></div><Bars teams={teams} labels={['Third-down conversion','Red-zone TD drives','Successful plays']} values={[a,h].map(t=>['third_down_rate','redzone_td_rate','success_rate'].map(k=>t?.season[k]!=null?t.season[k]!*100:null))} unit="%"/></section>
      <section className="mx-panel"><h2>Team production</h2><table><thead><tr><th>Per game / rate</th>{teams.map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{[['Points / game','points_per_game'],['Points allowed / game','points_allowed_per_game'],['Pass/run plays / game','plays_per_game'],['Turnovers / 100 plays','turnovers_per_100']].map(([label,k])=><tr key={k}><th>{label}</th>{[a,h].map((t,i)=><td key={teams[i]}>{format(t?.season[k],1)}</td>)}</tr>)}</tbody></table></section></div>
      {!data.archived?<div className="mx-two mx-markets"><DashboardMarkets key={game.game_id} game={game} model={model} showModelPicks={false}/></div>:<p className="mx-caption">Current sportsbook snapshots are not shown for saved weeks.</p>}
      <details className="mx-panel mx-player-detail"><summary>Individual player outlook & model validation</summary><MatchupProjections game={game} mode="players"/></details>
      <section className="mx-panel"><h2>Data & ranking definitions</h2><p className="mx-caption">Team inputs through Week {data.week-1}. Power lists rank season EPA/play, weighted by plays; defense ranks lowest EPA allowed first. Arrows compare with inputs through Week {Math.max(0,data.week-2)}. Red-zone TD rate counts offensive drives reaching the opponent’s 20 and ending in a rushing/passing TD. Drive rates include kneel-down possessions; EPA uses valid pass/run plays. Historical trends are not period forecasts. Missing values stay unavailable.</p><p className="mx-caption">{matching?`Source: nflverse · ${Object.keys(matching.teams).length} teams · exported ${new Date(matching.generated_at).toLocaleString()}`:'Team statistics unavailable for this saved week; current-week context is never substituted.'}</p></section>
    </div></div>}
  </div>;
}
