import Segmented from './Segmented';
import TeamMark from './TeamMark';
import { teamStyle } from './teamPalette';
import type { CSSProperties } from 'react';
import PositionDefense from './PositionDefense';
import { fetchSnapshot } from "./snapshotCache";
import { useEffect, useId, useRef, useState } from 'react';

type PlayerProjection = {
  player_id: string; name: string; headshot: string | null; position: string; team: string; opponent: string;
  status: string; prior_appearances: number; stat?: string; expected_yards?: number; range_80?: number[];
  recent_yards?: number; anytime_td_probability?: number; passing_td_probability?: number; passing_two_td_probability?: number; expected_receptions?: number; receptions_range_80?: number[];
};
type Period = { period: string; games: number; recent_games: number; points_for: number; points_against: number; recent_points_for: number; off_epa_per_play: number | null; success_rate: number | null };
type TeamPeriods = { games: number; summary: Period[]; history: { game_id: string; week: number; opponent: string; overtime_points_for: number; periods: { period: string; points_for: number }[] }[] };
type Metric = { mae: number; baseline_mae: number; interval_80_coverage?: number };
export type Report = {
  season: number; week: number; features_through_week: number;
  games: Record<string, { model_version: string; generated_at: string; kickoff: string; players: PlayerProjection[]; scoring: {
    away: {team: string; expected_points: number; range_80: number[]}; home: {team: string; expected_points: number; range_80: number[]};
    home_margin: number; total: number; margin_range_80: number[]; total_range_80: number[];
  } }>;
  model_versions: Record<string, {created_at: string; models: Record<string, {training_cutoff: number[]; calibration_cutoff: number[]; training_samples: number; calibration_samples: number}>}>;
  validation: {scoring: Metric & {margin: Metric; total: Metric}; yardage: Record<string, Metric>; receptions?: Metric; touchdowns: Record<string, {brier: number; baseline_brier: number}>};
  period_trends: {teams: Record<string, TeamPeriods>; excluded_games: string[]};
};
const range = (r: number[]) => `${r[0].toFixed(1)}–${r[1].toFixed(1)}`;
const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
const signed = (p: number) => `${p > 0 ? '+' : ''}${p.toFixed(1)}`;

const positions = ['QB', 'RB', 'WR', 'TE'];
const fmt = (value?: number) => value?.toFixed(1) ?? '—';

function Photo({player}: {player:PlayerProjection}) {
  return <span className="mr-avatar" aria-hidden="true">{player.name.split(' ').map(p => p[0]).slice(0, 2).join('')}
    {player.headshot && <img src={player.headshot} alt="" loading="lazy" referrerPolicy="no-referrer" onError={e => {e.currentTarget.style.display = 'none';}}/>}
  </span>;
}

function PlayerRow({player, onOpen}: {player:PlayerProjection; onOpen:(trigger:HTMLButtonElement)=>void}) {
  const qb = player.position === 'QB';
  const td = qb ? player.passing_td_probability : player.anytime_td_probability;
  return <button className="mr-player-row" type="button" onClick={event => onOpen(event.currentTarget)}>
    <span className="mr-player-name"><Photo player={player}/><span><b>{player.name}</b><small>{player.position}</small></span></span>
    <span className="mr-row-stat"><strong>{fmt(player.expected_yards)}</strong><small>{player.stat ? `${player.stat} yds` : 'No projection'}</small></span>
    <span className="mr-row-stat"><strong>{td == null ? '—' : pct(td)}</strong><small>{qb ? '1+ pass TD' : '1+ rush/rec TD'}</small></span>
    <span aria-hidden="true">›</span>
  </button>;
}

function PlayerDetails({player}: {player:PlayerProjection}) {
  if (player.status !== 'available') return <p className="mr-muted">At least three prior appearances are required.</p>;
  const fields = [
    [`Projected ${player.stat} yards`, fmt(player.expected_yards)],
    ['Last 3 appearances', fmt(player.recent_yards)],
    ['80% yardage range', player.range_80 ? range(player.range_80) : '—'],
    ['1+ rush/receiving TD', player.anytime_td_probability == null ? '—' : pct(player.anytime_td_probability)],
    ...(player.position === 'QB' ? [
      ['1+ passing TD', player.passing_td_probability == null ? '—' : pct(player.passing_td_probability)],
      ['2+ passing TD', player.passing_two_td_probability == null ? 'Unavailable in this snapshot' : pct(player.passing_two_td_probability)],
    ] : [
      ['Expected receptions', player.expected_receptions == null ? 'Unavailable in this snapshot' : fmt(player.expected_receptions)],
      ...(player.receptions_range_80 ? [['80% receptions range', range(player.receptions_range_80)]] : []),
    ]),
  ];
  return <><dl className="mr-player-measures">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <p className="mr-muted">{player.prior_appearances} prior appearances · conditional on playing</p></>;
}

export default function MatchupProjections({ game, mode = 'forecasts' }: {game: {game_id: string; season: number; week: number; away_team: string; home_team: string}; mode?: 'forecasts' | 'periods' | 'players'}) {
  const [report, setReport] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);
  const [playerPosition,setPlayerPosition]=useState('all');
  const [drawer, setDrawer] = useState<{team?:string; player?:PlayerProjection; validation?:boolean} | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const drawerTitle = useId();
  const opener = useRef<HTMLElement>(null);
  const open = (content: NonNullable<typeof drawer>, trigger:HTMLElement) => {
    opener.current = trigger;
    setDrawer(content);
    dialog.current?.showModal();
  };
  const [period, setPeriod] = useState('quarters');
  const [side, setSide] = useState<'away' | 'home'>('away');
  const file = `${game.season}-week-${game.week}`;
  useEffect(() => {
    const controller = new AbortController();
    fetchSnapshot(`${import.meta.env.BASE_URL}research/${file}.json`, {signal: controller.signal})
      .then(r => {if (!r.ok) throw Error('No research snapshot'); return r.json();})
      .then((data: Report) => {if (!controller.signal.aborted && data.season === game.season && data.week === game.week && data.games[game.game_id]) {setReport(data); setFailed(false);} else if (!controller.signal.aborted) setFailed(true);})
      .catch(() => {if (!controller.signal.aborted) setFailed(true);});
    return () => controller.abort();
  }, [file, game.season, game.week, game.game_id]);
  if (failed) return <div className="mr-empty">No pregame research snapshot was saved for this matchup. Existing winner forecasts remain available.</div>;
  if (!report || !report.games[game.game_id]) return <div className="mr-empty">Loading matchup research…</div>;
  const prediction = report.games[game.game_id];
  const scoring = prediction.scoring;
  const teams = [game.away_team, game.home_team];
  if (mode === 'periods') {
    const labels = period === 'quarters' ? ['Q1', 'Q2', 'Q3', 'Q4'] : ['H1', 'H2'];
    const series = teams.map(t => report.period_trends.teams[t]);
    if (series.some(t => !t)) return <div className="mr-empty">Complete, score-reconciled period data is unavailable for this matchup.</div>;
    const max = Math.max(1, ...series.flatMap(t => t.summary.filter(p => labels.includes(p.period)).map(p => p.points_for)));
    const selected = series[side === 'away' ? 0 : 1];
    return <div className="mr-report mr-periods">
      <div className="mr-section-title"><div><p className="ic-eyebrow">HOW THE GAME DEVELOPS</p><h3>Quarter & half performance</h3><p>Historical averages through Week {report.features_through_week}. Halves exclude overtime.</p></div><Segmented className="mr-toggle"><button type="button" aria-pressed={period === 'quarters'} onClick={() => setPeriod('quarters')}>Quarters</button><button type="button" aria-pressed={period === 'halves'} onClick={() => setPeriod('halves')}>Halves</button></Segmented></div>
      <div className="mr-panel"><div className="mr-chart-heading"><h4>Points scored per game</h4><span><TeamMark team={teams[0]}/><TeamMark team={teams[1]}/></span></div>
        <div className="mr-period-chart" role="img" aria-label={`Average points by ${period}; ${teams.join(' versus ')}. Exact values are in the tables below.`}>{labels.map(label => <div key={label} className="mr-period-group"><div>{series.map((team, i) => {const value = team.summary.find(p => p.period === label)!.points_for;return <div className={`mr-period-column mr-side-${i}`} key={teams[i]} style={teamStyle(teams[i]) as CSSProperties}><b>{value.toFixed(1)}</b><i style={{height:`${value / max * 125}px`}}/><small><TeamMark team={teams[i]}/></small></div>;})}</div><strong>{label}</strong></div>)}</div>
      </div>
      <div className="mr-team-tables">{series.map((team, i) => <section className="mr-panel" key={teams[i]}><h4><TeamMark team={teams[i]}/><span className="team-caption">{team.games} completed games</span></h4><div className="mr-table-scroll"><table><thead><tr><th>Period</th><th>For</th><th>Allowed</th><th>Last 3 for</th><th>Off. EPA/play</th></tr></thead><tbody>{team.summary.filter(p => labels.includes(p.period)).map(p => <tr key={p.period}><th>{p.period}</th><td>{p.points_for.toFixed(1)}</td><td>{p.points_against.toFixed(1)}</td><td>{p.recent_points_for.toFixed(1)}</td><td>{p.off_epa_per_play?.toFixed(3) ?? '—'}</td></tr>)}</tbody></table></div></section>)}</div>
      <div className="mr-panel"><div className="mr-chart-heading"><h4>Game-by-game scoring splits</h4><Segmented className="mr-toggle">{teams.map((t, i) => <button key={t} type="button" aria-pressed={side === (i ? 'home' : 'away')} onClick={() => setSide(i ? 'home' : 'away')}><TeamMark team={t}/></button>)}</Segmented></div><div className="mr-table-scroll"><table><thead><tr><th>Week</th><th>Opponent</th>{labels.map(l => <th key={l}>{l}</th>)}<th>OT</th></tr></thead><tbody>{selected.history.map(g => <tr key={g.game_id}><th>{g.week}</th><td><TeamMark team={g.opponent}/></td>{labels.map(l => <td key={l}>{g.periods.find(p => p.period === l)?.points_for ?? '—'}</td>)}<td>{g.overtime_points_for}</td></tr>)}</tbody></table></div></div>
      <p className="mr-muted">Descriptive performance, not quarter-by-quarter predictions. Pass/run EPA is weighted by plays; recent form uses up to three completed games. Games with incomplete or inconsistent quarter scores are excluded.</p>
    </div>;
  }
  const lineage = report.model_versions[prediction.model_version];
  return <div className="mr-report">
    {mode !== 'players' && <><div className="mr-section-title"><div><p className="ic-eyebrow">BEYOND THE WINNER</p><h3>Scoring & player projections</h3><p>Experimental models · pregame inputs through Week {report.features_through_week}</p></div><span className="mr-badge">RESEARCH v1</span></div>
    <div className="mr-score-grid">{(['away', 'home'] as const).map(s => <section className="mr-score-card" key={s}><span><img src={`${import.meta.env.BASE_URL}logos/${scoring[s].team}.png`} alt=""/>{scoring[s].team} expected points</span><strong>{scoring[s].expected_points.toFixed(1)}</strong><small>80% range {range(scoring[s].range_80)}</small></section>)}<section className="mr-score-card"><span>Expected game total</span><strong>{scoring.total.toFixed(1)}</strong><small>80% range {range(scoring.total_range_80)}</small></section><section className="mr-score-card"><span>{game.home_team} scoring margin</span><strong>{signed(scoring.home_margin)}</strong><small>80% range {range(scoring.margin_range_80)}</small></section></div>
    <p className="mr-muted">Expected points are averages, not an exact score prediction. Positive home margin means {game.home_team} scores more. {report.validation.scoring.margin.mae >= report.validation.scoring.margin.baseline_mae ? "Margin error did not beat the baseline in the 2025 benchmark." : "See the validation details for benchmark errors."}</p>
    </>}
    <div className="mr-section-title"><div><h3>Individual player outlook</h3><p>Projections assume the player appears.</p></div><button className="mr-show-players" type="button" onClick={e => open({validation:true}, e.currentTarget)}>Model validation</button></div>
    <Segmented role="group" aria-label="Matchup player position">{['all', ...positions].map(p => <button type="button" key={p} aria-pressed={playerPosition === p} onClick={() => setPlayerPosition(p)}>{p === 'all' ? 'All' : p}</button>)}</Segmented>
    <div className="mr-team-columns">{teams.map((team, index) => {
      const roster = prediction.players.filter(p => p.team === team && p.opponent === teams[1-index])
        .sort((a,b) => positions.indexOf(a.position) - positions.indexOf(b.position) || (b.expected_yards ?? -1) - (a.expected_yards ?? -1));
      const pool = roster.filter(p => playerPosition === 'all' || p.position === playerPosition);
      return <section className="mr-team-column" key={team} aria-label={`${team} player outlooks`}>
        <h4 className="mr-team-title"><TeamMark team={team}/><small>{index === 0 ? 'Away' : 'Home'} · {roster.length} players</small></h4>
        <div className="mr-player-row mr-player-head" aria-hidden="true"><span>Player</span><span className="mr-row-stat">Projected yards</span><span className="mr-row-stat">TD probability</span><span/></div>
        {pool.slice(0,4).map(player => <PlayerRow key={player.player_id} player={player} onOpen={trigger => open({player}, trigger)}/>)}
        {!pool.length && <p className="mr-muted">No saved player outlooks for this position.</p>}
        {roster.length > 0 && <button className="mr-show-players" type="button" onClick={e => open({team},e.currentTarget)}>View all {roster.length} {team} players</button>}
      </section>;
    })}</div>
    <PositionDefense season={game.season} week={game.week} opponents={[game.home_team, game.away_team]} position={playerPosition}/>
    <dialog ref={dialog} className="mr-outlook-drawer" aria-labelledby={drawerTitle}
      onKeyDown={event => {if (event.key === 'Escape' || event.key === 'Tab') event.stopPropagation();}}
      onClose={() => {setDrawer(null); opener.current?.focus();}}
      onClick={event => {if (event.target === event.currentTarget) dialog.current?.close();}}>
      <div className="mr-drawer-content">
      <header>{drawer?.player && <Photo player={drawer.player}/>}<h3 id={drawerTitle}>{drawer?.player?.name ?? (drawer?.validation ? 'Model validation & data provenance' : `${drawer?.team ?? ''} player outlooks`)}</h3><button className="mr-drawer-close" type="button" aria-label="Close" onClick={() => dialog.current?.close()}><span aria-hidden="true">×</span></button></header>
      {drawer?.player && <>{drawer.team && <button className="mr-show-players" type="button" onClick={() => setDrawer({team:drawer.team})}>Back to {drawer.team} roster</button>}<p>{drawer.player.position} · {drawer.player.team} vs {drawer.player.opponent}</p><PlayerDetails player={drawer.player}/></>}
      {drawer?.team && !drawer.player && prediction.players.filter(p => p.team === drawer.team).map(player => <PlayerRow key={player.player_id} player={player} onOpen={() => setDrawer({team:drawer.team, player})}/>)}
      {drawer?.validation && <div className="mr-method">
      <p>Development benchmark: fit 2018–2023, calibrate 2024, test 2025. This is retrospective evaluation, separate from the live winner-model record. Lower error and lower Brier scores are better.</p>
      <div className="mr-table-scroll"><table><thead><tr><th>Forecast</th><th>Model error</th><th>Baseline error</th><th>Measure</th></tr></thead><tbody>{[['Team points', report.validation.scoring], ['Game total', report.validation.scoring.total], ['Home margin', report.validation.scoring.margin], ...(report.validation.receptions ? [['Receptions', report.validation.receptions]] : []), ...Object.entries(report.validation.yardage).map(([kind, m]) => [`${kind} yards`, m])].map(([name, metric]) => {const m = metric as Metric;return <tr key={String(name)}><th>{String(name)}</th><td>{m.mae.toFixed(2)}</td><td>{m.baseline_mae.toFixed(2)}</td><td>MAE</td></tr>;})}{Object.entries(report.validation.touchdowns).map(([name, m]) => <tr key={name}><th>{name === 'any_td' ? 'Rush/receiving TD' : name === 'pass_two_td' ? '2+ passing TD' : '1+ passing TD'}</th><td>{m.brier.toFixed(4)}</td><td>{m.baseline_brier.toFixed(4)}</td><td>Brier</td></tr>)}</tbody></table></div>
      <p>Scoring baseline: average of the team’s recent points and its opponent’s recent points allowed. Yardage baseline: last three appearances. Receptions baseline: last three appearances. TD baseline: smoothed historical per-appearance rate. Full reliability bins and prediction-range coverage are in the saved validation export.</p>
      <p>Ranges target 80% coverage using a separate calibration period. They express outcome uncertainty and may include negative player yardage. They are not confidence ratings for a bet.</p>
      {lineage && <div className="mr-table-scroll"><table><thead><tr><th>Current model</th><th>Fit through</th><th>Calibrated through</th><th>Fit / calibration samples</th></tr></thead><tbody>{Object.entries(lineage.models).map(([name, m]) => <tr key={name}><th>{name.replaceAll('_', ' ')}</th><td>{m.training_cutoff[0]} W{m.training_cutoff[1]}</td><td>{m.calibration_cutoff[0]} W{m.calibration_cutoff[1]}</td><td>{m.training_samples} / {m.calibration_samples}</td></tr>)}</tbody></table></div>}
      <p>Snapshot saved {new Date(prediction.generated_at).toLocaleString()} · model version {prediction.model_version}. Sources: nflverse schedules, weekly player stats and play-by-play. New projections are saved only before kickoff.</p>
      </div>}
      </div>
    </dialog>
  </div>;
}
