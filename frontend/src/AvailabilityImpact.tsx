import type { PredictionFields, Model } from './predictionModels';
import { probability } from './predictionModels';
export type AvailabilityImpactFields = {
  availability_watch?: {player_id:string;name:string;team:string;position:string;status:string;injury:string|null;source:string;report_updated_at:string}[];
  qb_scenarios?: (Partial<PredictionFields> & {team:string;name:string;status:string;assumption?:string})[];
};
export default function AvailabilityImpact({game,model}: {game: AvailabilityImpactFields & PredictionFields & {home_team:string;away_team:string;game_date:string}; model:Model}) {
  // These are pregame assumptions. Archived reports retain their original snapshot.
  if (!game.availability_watch?.length) return null;
  return <aside className="qb-coverage-note" aria-label="Availability and model assumptions">
    <strong>Availability watch</strong>
    {game.availability_watch.map(p=><span key={p.player_id}>{p.team} · {p.name}: {p.status.toLowerCase()}{p.injury?` · ${p.injury}`:''}. <a href={p.source} target="_blank" rel="noreferrer">Source</a></span>)}
    <span>The main forecast uses the displayed projected quarterbacks. Other player injuries have no separately estimated team probability adjustment. Player yardage and TD estimates remain conditional on appearing.</span>
    {game.qb_scenarios?.map(s=>{
      const p=s[`home_win_prob_${model}`];
      if(typeof p!=='number')return <span key={s.team+s.name}>If {s.name} starts: insufficient model history.</span>;
      const side=s.team===game.home_team?p:1-p;
      const base=probability(game,model); const difference=(s.team===game.home_team?p-base:base-p)*100;
      return <span key={s.team+s.name}><b>If {s.name} starts:</b> {s.team} win probability {(side*100).toFixed(1)}% ({difference>=0?'+':''}{difference.toFixed(1)} pp). Conditional scenario; not a starter announcement or chance of playing.</span>;
    })}
  </aside>;
}
