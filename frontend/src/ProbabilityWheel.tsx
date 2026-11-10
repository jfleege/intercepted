import { useAnimatedNumber } from './useAnimatedNumber';
import { useId } from 'react';
import type { CSSProperties } from 'react';
import { TEAM_COLORS } from './teams';

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
export default function ProbabilityWheel({ awayTeam, homeTeam, homeProb }: {
  awayTeam: string; homeTeam: string; homeProb: number;
}) {
  const gradientId = useId();
  const shownHome = useAnimatedNumber(homeProb, .5) ?? homeProb;
  const shownWinner = homeProb >= .5 ? shownHome : 1 - shownHome;
  const awayProb = 1 - homeProb, winnerIsHome = homeProb >= .5;
  const winner = winnerIsHome ? homeTeam : awayTeam;
  const winnerProb = Math.max(homeProb, awayProb);
  const primary = TEAM_COLORS[winner] ?? '#80d5ff';
  const [red, green, blue] = [1, 3, 5].map(start => parseInt(primary.slice(start,start+2),16));
  const brightness = red * .299 + green * .587 + blue * .114;
  // Dark jerseys need more lift to stay visible against the wheel track.
  const shadeStrength = brightness < 60 ? 55 : brightness < 100 ? 68 : 92;
  const palette = {
    '--wheel-highlight': `color-mix(in oklab, ${primary} ${shadeStrength - 25}%, white)`,
    '--wheel-shade': `color-mix(in oklab, ${primary} ${shadeStrength}%, white)`,
  } as CSSProperties;
  const circumference = 2 * Math.PI * 61;
  const side = (team: string, p: number, favored: boolean) => <div className={`ud-wheel-side${favored ? ' is-favored' : ''}`}>
    <div className="ud-probability-column" aria-hidden="true"><span className="ud-probability-fill" style={{height:`${p*100}%`}}/></div>
    <strong>{team}</strong><span aria-hidden="true" style={{fontVariantNumeric:"tabular-nums"}}>{pct(p)}</span>
  </div>;
  return <div className="ud-wheel" role="group" style={palette} aria-label={`${awayTeam} ${pct(awayProb)}, ${homeTeam} ${pct(homeProb)}`}>
    {side(awayTeam, 1 - shownHome, !winnerIsHome)}
    <div className="ud-wheel-center">
      <svg className="ud-wheel-svg" viewBox="0 0 160 160" role="img" aria-label={`${winner} projected winner, ${pct(winnerProb)}`}>
        <defs>
          <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="141" y1="80" x2="19" y2="80">
            <stop offset="0%" stopColor="var(--wheel-highlight)"/>
            <stop offset="100%" stopColor="var(--wheel-shade)"/>
          </linearGradient>
        </defs>
        <circle cx="80" cy="80" r="61" fill="none" stroke="#35505f" strokeWidth="15"/>
        <circle className="ud-winner-arc" cx="80" cy="80" r="61" fill="none" stroke={`url(#${gradientId})`} strokeWidth="15"
          strokeDasharray={`${shownWinner*circumference} ${circumference}`}
          style={{'--ud-arc':shownWinner*circumference} as CSSProperties}
          transform={winnerIsHome ? 'rotate(-90 80 80)' : 'translate(160 0) scale(-1 1) rotate(-90 80 80)'}/>
      </svg>
      <div className="ud-wheel-logos"><img src={`${import.meta.env.BASE_URL}logos/${awayTeam}.png`} alt={awayTeam}/><span/><img src={`${import.meta.env.BASE_URL}logos/${homeTeam}.png`} alt={homeTeam}/></div>
    </div>
    {side(homeTeam, shownHome, winnerIsHome)}
  </div>;
}
