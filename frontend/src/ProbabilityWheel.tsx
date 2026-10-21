import type { CSSProperties } from 'react';
import { TEAM_COLORS } from './teams';

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
export default function ProbabilityWheel({ awayTeam, homeTeam, homeProb }: {
  awayTeam: string; homeTeam: string; homeProb: number;
}) {
  const awayProb = 1 - homeProb, winnerIsHome = homeProb >= .5;
  const winner = winnerIsHome ? homeTeam : awayTeam;
  const winnerProb = Math.max(homeProb, awayProb);
  const primary = TEAM_COLORS[winner] ?? '#80d5ff';
  const [red, green, blue] = [1, 3, 5].map(start => parseInt(primary.slice(start,start+2),16));
  // Lift dark team colors against the dark panel while preserving the team's hue.
  const color = (red * .299 + green * .587 + blue * .114) < 100
    ? `color-mix(in srgb, ${primary} 60%, white)` : primary;
  const circumference = 2 * Math.PI * 61;
  const side = (team: string, p: number, favored: boolean) => <div className={`ud-wheel-side${favored ? ' is-favored' : ''}`}>
    <div className="ud-probability-column" aria-hidden="true"><span className="ud-probability-fill" style={{height:`${p*100}%`,backgroundColor:favored ? color : undefined}}/></div>
    <strong>{team}</strong><span>{pct(p)}</span>
  </div>;
  return <div className="ud-wheel" role="group" aria-label={`${awayTeam} ${pct(awayProb)}, ${homeTeam} ${pct(homeProb)}`}>
    {side(awayTeam, awayProb, !winnerIsHome)}
    <div className="ud-wheel-center">
      <svg className="ud-wheel-svg" viewBox="0 0 160 160" role="img" aria-label={`${winner} projected winner, ${pct(winnerProb)}`}>
        <circle cx="80" cy="80" r="61" fill="none" stroke="#35505f" strokeWidth="15"/>
        <circle className="ud-winner-arc" cx="80" cy="80" r="61" fill="none" stroke={color} strokeWidth="15"
          strokeDasharray={`${winnerProb*circumference} ${circumference}`}
          style={{'--ud-arc':winnerProb*circumference,'--ud-circumference':circumference} as CSSProperties}
          transform={winnerIsHome ? 'rotate(-90 80 80)' : 'translate(160 0) scale(-1 1) rotate(-90 80 80)'}/>
      </svg>
      <div className="ud-wheel-logos"><img src={`${import.meta.env.BASE_URL}logos/${awayTeam}.png`} alt={awayTeam}/><span/><img src={`${import.meta.env.BASE_URL}logos/${homeTeam}.png`} alt={homeTeam}/></div>
    </div>
    {side(homeTeam, homeProb, winnerIsHome)}
  </div>;
}
