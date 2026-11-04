import './AvailabilityImpact.css';
import type { PredictionFields, Model } from './predictionModels';
import { probability } from './predictionModels';
export type AvailabilityImpactFields = {
  availability_watch?: {player_id:string;name:string;team:string;position:string;status:string;injury:string|null;source:string;report_updated_at:string}[];
  qb_scenarios?: (Partial<PredictionFields> & {team:string;name:string;status:string;assumption?:string})[];
};
export default function AvailabilityImpact({game,model}: {game: AvailabilityImpactFields & PredictionFields & {home_team:string;away_team:string;game_date:string}; model:Model}) {
  // These are pregame assumptions. Archived reports retain their original snapshot.
  if (!game.availability_watch?.length) return null;
  return <aside className="availability-callout" aria-label="Availability and model assumptions">
    <div className="availability-callout-heading"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 10 18H2zM12 9v5"/><path d="M12 17h.01"/></svg><strong>Availability watch</strong></div>
    <ul className="availability-callout-players">{game.availability_watch.map(p=><li key={p.player_id}><span>{p.team} · {p.name} · {p.status}{p.injury?` · ${p.injury}`:''}</span><a href={p.source} target="_blank" rel="noreferrer" aria-label={`${p.name} injury source (opens in a new tab)`}>Source</a></li>)}</ul>
    <p className="availability-callout-note">Projections assume the player appears. Injury effects are not fully reflected in team win probabilities.</p>
    <div className="availability-callout-scenarios">{game.qb_scenarios?.map(s=>{
      const p=s[`home_win_prob_${model}`];
      if(typeof p!=='number')return <span key={s.team+s.name}>If {s.name} starts: insufficient model history.</span>;
      const side=s.team===game.home_team?p:1-p;
      const base=probability(game,model); const difference=(s.team===game.home_team?p-base:base-p)*100;
      return <span key={s.team+s.name}><b>If {s.name} starts:</b> {s.team} win probability {(side*100).toFixed(1)}% ({difference>=0?'+':''}{difference.toFixed(1)} pp). Conditional scenario; not a starter announcement or chance of playing.</span>;
    })}</div>
  </aside>;
}
