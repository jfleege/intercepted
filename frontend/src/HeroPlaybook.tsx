import { usePageActive } from "./pageActivity";
import { fetchSnapshot } from "./snapshotCache";
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Game } from './forecastTypes';
import { MODEL_LABELS, probability } from './predictionModels';
import type { Model } from './predictionModels';

const PERIOD = 10000;
const roles = ['WR', 'WR', 'TE', 'WR', 'RB', 'QB', 'LT', 'LG', 'C', 'RG', 'RT'];
const plays = [
  { name: 'Shotgun spread', numbers: [11, 18, 87, 14, 26, 9, 72, 66, 63, 70, 75], paths: [
    'M250 55 L340 55 Q365 55 385 80 L500 135', 'M235 110 L320 110 Q340 110 350 90 L385 40',
    'M250 280 L320 280 Q340 280 360 250 L440 190', 'M250 340 L390 340 L510 290',
    'M175 240 Q180 300 250 310 L350 310', 'M200 200 L175 200',
    'M250 160 L270 153', 'M250 180 L270 177', 'M250 200 L270 200', 'M250 220 L270 223', 'M250 240 L270 247',
  ]},
  { name: 'Trips right', numbers: [13, 10, 85, 17, 22, 12, 71, 68, 60, 74, 79], paths: [
    'M250 60 L410 60 Q430 60 450 90 L490 140', 'M240 285 L330 285 L420 200',
    'M235 320 L360 320 Q380 320 395 295 L480 180', 'M215 345 L280 345 L340 355',
    'M175 165 Q190 100 260 105 L345 105', 'M200 200 L170 210',
    'M250 160 L270 153', 'M250 180 L270 177', 'M250 200 L270 200', 'M250 220 L270 223', 'M250 240 L270 247',
  ]},
  { name: 'Two-back set', numbers: [19, 16, 88, 15, 28, 7, 73, 65, 62, 76, 78], paths: [
    'M250 65 L355 65 L355 155', 'M250 340 L420 340 L500 300',
    'M250 275 L315 275 Q340 275 360 250 L475 140', 'M170 240 Q195 290 255 295 L340 295',
    'M170 160 Q195 110 255 105 L350 105', 'M220 200 L185 200',
    'M250 160 L270 153', 'M250 180 L270 177', 'M250 200 L270 200', 'M250 220 L270 223', 'M250 240 L270 247',
  ]},
];
type TrendPlayer = { player_id: string; name: string; stat_label: string; recent_average: number; season_average: number; trend_pct: number | null; games_sampled: number };
type PlayerExport = { season: number; week: number; games: Record<string, { away_players: TrendPlayer[]; home_players: TrendPlayer[] }> };
const ease = (n: number) => n * n * (3 - 2 * n);

export default function HeroPlaybook({ games, model, archived, season, week }: {
  games: Game[]; model: Model; archived: boolean; season?: number; week?: number;
}) {
  const pageActive = usePageActive();
  const root = useRef<HTMLDivElement>(null);
  const routes = useRef<(SVGPathElement | null)[][]>([]);
  const markers = useRef<(SVGGElement | null)[]>([]);
  const elapsed = useRef(0);
  const [cycle, setCycle] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [visible, setVisible] = useState(true);
  const [hidden, setHidden] = useState(() => document.hidden);
  const [players, setPlayers] = useState<PlayerExport | null>(null);
  const playIndex = cycle % plays.length;
  const play = plays[playIndex];

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReduced(query.matches);
    const visibility = () => setHidden(document.hidden);
    query.addEventListener('change', motion);
    document.addEventListener('visibilitychange', visibility);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    if (root.current) observer.observe(root.current);
    return () => { query.removeEventListener('change', motion); document.removeEventListener('visibilitychange', visibility); observer.disconnect(); };
  }, []);

  useEffect(() => {
    if (archived) return;
    const controller = new AbortController();
    fetchSnapshot(`${import.meta.env.BASE_URL}players_watch.json`, { signal: controller.signal })
      .then(r => { if (!r.ok) throw Error('Unavailable'); return r.json(); })
      .then((data: PlayerExport) => { if (!controller.signal.aborted) setPlayers(data); })
      .catch(() => { /* Matchup forecasts and the decorative playbook remain available. */ });
    return () => controller.abort();
  }, [archived]);

  useEffect(() => {
    let frame = 0, previous: number | undefined;
    const lengths = routes.current.map(paths => paths.map(p => p?.getTotalLength() ?? 0));
    const draw = () => {
      const phase = (elapsed.current % PERIOD) / PERIOD;
      const progress = ease(Math.max(0, Math.min(1, (phase - .24) / .51)));
      const setup = ease(Math.min(1, phase / .16));
      routes.current[playIndex]?.forEach((path, i) => {
        if (!path) return;
        const length = lengths[playIndex][i];
        path.style.strokeDasharray = `${length}`;
        path.style.strokeDashoffset = `${reduced ? 0 : length * (1 - progress)}`;
        path.style.opacity = `${reduced ? 1 : phase < .16 ? 0 : 1}`;
        const start = path.getPointAtLength(0);
        const prior = routes.current[(playIndex + plays.length - 1) % plays.length][i];
        const end = prior?.getPointAtLength(lengths[(playIndex + plays.length - 1) % plays.length][i]) ?? start;
        const point = reduced ? start : phase < .16 && cycle > 0
          ? { x: end.x + (start.x - end.x) * setup, y: end.y + (start.y - end.y) * setup }
          : path.getPointAtLength(progress * length);
        markers.current[i]?.setAttribute('transform', `translate(${point.x} ${point.y})`);
      });
    };
    if (!pageActive) return;
    draw();
    if (paused || reduced || hidden || !visible) return;
    const tick = (now: number) => {
      if (previous !== undefined) elapsed.current += Math.min(now - previous, 80);
      previous = now;
      const next = Math.floor(elapsed.current / PERIOD);
      if (next !== cycle) { setCycle(next); return; }
      draw();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cycle, playIndex, paused, reduced, hidden, visible, pageActive]);

  const game = games.length ? games[cycle % games.length] : null;
  const home = game ? probability(game, model) : null;
  const weeklyPlayers = !archived && players && players.season === season && players?.week === week && game ? players.games[game.game_id] : null;
  const trending = weeklyPlayers ? [...weeklyPlayers.away_players, ...weeklyPlayers.home_players]
    .filter(p => p.trend_pct !== null && Number.isFinite(p.trend_pct) && Number.isFinite(p.recent_average) && Number.isFinite(p.season_average))
    .sort((a, b) => (b.trend_pct ?? 0) - (a.trend_pct ?? 0))[0] : null;
  const maxYards = trending ? Math.max(1, trending.recent_average, trending.season_average) : 1;
  const advance = () => { elapsed.current = (cycle + 1) * PERIOD + 1600; setCycle(cycle + 1); };

  return <div ref={root} className="hero-playbook" aria-label="Weekly playbook preview" data-formation={playIndex} data-paused={paused || reduced || hidden || !visible}>
    <div className="hp-field-space" aria-hidden="true">
      <svg className="hp-field" viewBox="0 0 640 400" fill="none">
        <rect x="28" y="25" width="584" height="350" rx="3" className="hp-boundary"/>
        {Array.from({ length: 9 }, (_, i) => {
          const x = 76 + i * 61;
          return <g key={x} className="hp-yard-line"><path d={`M${x} 25V375`}/><text x={x - 4} y="60">{(i < 5 ? i + 1 : 9 - i) * 10}</text><text x={x - 4} y="355">{(i < 5 ? i + 1 : 9 - i) * 10}</text></g>;
        })}
        {Array.from({ length: 46 }, (_, i) => <path key={i} className="hp-hash" d={`M${46 + i * 12} 148v6 M${46 + i * 12} 246v6`}/>)}
        <path className="hp-scrimmage" d="M250 30V370"/>
        {plays.map((formation, index) => <g key={formation.name} className={`hp-routes${index === playIndex ? ' is-active' : ''}`}>
          {formation.paths.map((d, i) => <path key={i} ref={node => { (routes.current[index] ??= [])[i] = node; }} d={d} className={i >= 6 ? 'hp-block' : 'hp-route'}/>)}
        </g>)}
        {roles.map((role, i) => <g key={i} ref={node => { markers.current[i] = node; }} className={`hp-player${i >= 6 ? ' hp-lineman' : ''}`}>
          <circle r="10"/><text className="hp-number" textAnchor="middle" y="3">{play.numbers[i]}</text><text className="hp-role" textAnchor="middle" y="-16">{playIndex === 2 && i === 3 ? 'RB' : role}</text>
        </g>)}
      </svg>
    </div>
    <div className="hp-topline"><span>PLAYBOOK / {String(playIndex + 1).padStart(2, '0')}</span><span>{play.name}</span></div>
    <div className="hp-insight hp-matchup">
      <p>{archived ? 'ARCHIVED FORECAST' : 'WEEKLY FORECAST'} · {week ?? '—'}</p>
      {game && home !== null ? <>
        <div className="hp-teams"><span><img src={`${import.meta.env.BASE_URL}logos/${game.away_team}.png`} alt=""/>{game.away_team}</span><small>at</small><span><img src={`${import.meta.env.BASE_URL}logos/${game.home_team}.png`} alt=""/>{game.home_team}</span></div>
        <div className="hp-probabilities"><strong>{((1 - home) * 100).toFixed(1)}%</strong><strong>{(home * 100).toFixed(1)}%</strong></div>
        <div className="hp-probability-track" aria-hidden="true"><i style={{width:`${(1 - home) * 100}%`}}/></div>
        <small>{MODEL_LABELS[model]} · saved prediction</small>
      </> : <span className="hp-empty">Saved forecasts unavailable</span>}
    </div>
    <div className="hp-insight hp-trend">
      <p>PLAYER FORM</p>
      {trending ? <>
        <strong className="hp-player-name">{trending.name}</strong>
        <small>{trending.stat_label}/game</small>
        <div className="hp-form-row"><span>Season</span><i style={{'--hp-bar':`${Math.max(0, trending.season_average) / maxYards * 100}%`} as CSSProperties}/><b>{trending.season_average.toFixed(1)}</b></div>
        <div className="hp-form-row is-recent"><span>Last {trending.games_sampled}</span><i style={{'--hp-bar':`${Math.max(0, trending.recent_average) / maxYards * 100}%`} as CSSProperties}/><b>{trending.recent_average.toFixed(1)}</b></div>
      </> : <span className="hp-empty">{archived ? 'Player trends belong to the current week.' : 'No saved player trend for this matchup.'}</span>}
    </div>
    <div className="hp-footer"><span>Illustrative playbook · Saved stats</span><div>
      <button type="button" onClick={() => setPaused(value => !value)} aria-label={paused ? 'Resume playbook' : 'Pause playbook'} aria-pressed={paused} disabled={reduced}>{paused || reduced ? '▶' : 'Ⅱ'}</button>
      <button type="button" onClick={advance} aria-label="Next playbook formation">→</button>
    </div></div>
  </div>;
}
