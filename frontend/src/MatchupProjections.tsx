import { useEffect, useState } from 'react';

type PlayerProjection = {
  player_id: string; name: string; headshot: string | null; position: string; team: string; opponent: string;
  status: string; prior_appearances: number; stat?: string; expected_yards?: number; range_80?: number[];
  recent_yards?: number; anytime_td_probability?: number; passing_td_probability?: number;
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
  validation: {scoring: Metric & {margin: Metric; total: Metric}; yardage: Record<string, Metric>; touchdowns: Record<string, {brier: number; baseline_brier: number}>};
  period_trends: {teams: Record<string, TeamPeriods>; excluded_games: string[]};
};
const range = (r: number[]) => `${r[0].toFixed(1)}–${r[1].toFixed(1)}`;
const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
const signed = (p: number) => `${p > 0 ? '+' : ''}${p.toFixed(1)}`;

function ProjectionCard({ player }: {player: PlayerProjection}) {
  return <article className="mr-player">
    <header><span className="mr-avatar">{player.name.split(' ').map(p => p[0]).slice(0, 2).join('')}{player.headshot && <img src={player.headshot} alt="" loading="lazy" referrerPolicy="no-referrer" onError={e => {e.currentTarget.style.display = 'none';}}/>}</span><div><small>{player.team} · {player.position}</small><h4>{player.name}</h4><small>vs {player.opponent}</small></div></header>
    {player.status !== 'available' ? <p className="mr-muted">At least three prior appearances are required.</p> : <>
      <div className="mr-yardage"><strong>{player.expected_yards!.toFixed(1)}</strong><span>expected {player.stat} yards</span></div>
      <div className="mr-pair"><span>Last 3 appearances</span><b>{player.recent_yards!.toFixed(1)}</b></div>
      <div className="mr-pair"><span>80% prediction range</span><b>{range(player.range_80!)}</b></div>
      <div className="mr-td-row"><span>1+ rush/receiving TD</span><strong>{pct(player.anytime_td_probability!)}</strong></div>
      {player.passing_td_probability != null && <div className="mr-pair"><span>1+ passing TD</span><b>{pct(player.passing_td_probability)}</b></div>}
      <small className="mr-sample">{player.prior_appearances} prior appearances · conditional on playing</small>
    </>}
  </article>;
}

export default function MatchupProjections({ game, mode = 'forecasts' }: {game: {game_id: string; season: number; week: number; away_team: string; home_team: string}; mode?: 'forecasts' | 'periods' | 'players'}) {
  const [report, setReport] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);
  const [period, setPeriod] = useState('quarters');
  const [side, setSide] = useState<'away' | 'home'>('away');
  const file = `${game.season}-week-${game.week}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}research/${file}.json`, {signal: controller.signal})
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
      <div className="mr-section-title"><div><p className="ic-eyebrow">HOW THE GAME DEVELOPS</p><h3>Quarter & half performance</h3><p>Historical averages through Week {report.features_through_week}. Halves exclude overtime.</p></div><div className="mr-toggle"><button type="button" aria-pressed={period === 'quarters'} onClick={() => setPeriod('quarters')}>Quarters</button><button type="button" aria-pressed={period === 'halves'} onClick={() => setPeriod('halves')}>Halves</button></div></div>
      <div className="mr-panel"><div className="mr-chart-heading"><h4>Points scored per game</h4><span><i/>{teams[0]} <i/>{teams[1]}</span></div>
        <div className="mr-period-chart" role="img" aria-label={`Average points by ${period}; ${teams.join(' versus ')}. Exact values are in the tables below.`}>{labels.map(label => <div key={label} className="mr-period-group"><div>{series.map((team, i) => {const value = team.summary.find(p => p.period === label)!.points_for;return <div className={`mr-period-column mr-side-${i}`} key={teams[i]}><b>{value.toFixed(1)}</b><i style={{height:`${value / max * 125}px`}}/><small>{teams[i]}</small></div>;})}</div><strong>{label}</strong></div>)}</div>
      </div>
      <div className="mr-team-tables">{series.map((team, i) => <section className="mr-panel" key={teams[i]}><h4>{teams[i]} · {team.games} completed games</h4><div className="mr-table-scroll"><table><thead><tr><th>Period</th><th>For</th><th>Allowed</th><th>Last 3 for</th><th>Off. EPA/play</th></tr></thead><tbody>{team.summary.filter(p => labels.includes(p.period)).map(p => <tr key={p.period}><th>{p.period}</th><td>{p.points_for.toFixed(1)}</td><td>{p.points_against.toFixed(1)}</td><td>{p.recent_points_for.toFixed(1)}</td><td>{p.off_epa_per_play?.toFixed(3) ?? '—'}</td></tr>)}</tbody></table></div></section>)}</div>
      <div className="mr-panel"><div className="mr-chart-heading"><h4>Game-by-game scoring splits</h4><div className="mr-toggle">{teams.map((t, i) => <button key={t} type="button" aria-pressed={side === (i ? 'home' : 'away')} onClick={() => setSide(i ? 'home' : 'away')}>{t}</button>)}</div></div><div className="mr-table-scroll"><table><thead><tr><th>Week</th><th>Opponent</th>{labels.map(l => <th key={l}>{l}</th>)}<th>OT</th></tr></thead><tbody>{selected.history.map(g => <tr key={g.game_id}><th>{g.week}</th><td>{g.opponent}</td>{labels.map(l => <td key={l}>{g.periods.find(p => p.period === l)?.points_for ?? '—'}</td>)}<td>{g.overtime_points_for}</td></tr>)}</tbody></table></div></div>
      <p className="mr-muted">Descriptive performance, not quarter-by-quarter predictions. Pass/run EPA is weighted by plays; recent form uses up to three completed games. Games with incomplete or inconsistent quarter scores are excluded.</p>
    </div>;
  }
  const lineage = report.model_versions[prediction.model_version];
  return <div className="mr-report">
    {mode !== 'players' && <><div className="mr-section-title"><div><p className="ic-eyebrow">BEYOND THE WINNER</p><h3>Scoring & player projections</h3><p>Experimental models · pregame inputs through Week {report.features_through_week}</p></div><span className="mr-badge">RESEARCH v1</span></div>
    <div className="mr-score-grid">{(['away', 'home'] as const).map(s => <section className="mr-score-card" key={s}><span><img src={`${import.meta.env.BASE_URL}logos/${scoring[s].team}.png`} alt=""/>{scoring[s].team} expected points</span><strong>{scoring[s].expected_points.toFixed(1)}</strong><small>80% range {range(scoring[s].range_80)}</small></section>)}<section className="mr-score-card"><span>Expected game total</span><strong>{scoring.total.toFixed(1)}</strong><small>80% range {range(scoring.total_range_80)}</small></section><section className="mr-score-card"><span>{game.home_team} scoring margin</span><strong>{signed(scoring.home_margin)}</strong><small>80% range {range(scoring.margin_range_80)}</small></section></div>
    <p className="mr-muted">Expected points are averages, not an exact score prediction. Positive home margin means {game.home_team} scores more. {report.validation.scoring.margin.mae >= report.validation.scoring.margin.baseline_mae ? "Margin error did not beat the baseline in the 2025 benchmark." : "See the validation details for benchmark errors."}</p>
    </>}
    <div className="mr-section-title"><div><h3>Individual player outlook</h3><p>Yardage and touchdown probabilities, conditional on appearing. These models do not predict player availability.</p></div></div>
    <div className="mr-player-grid">{prediction.players.map(p => <ProjectionCard player={p} key={p.player_id}/>)}</div>
    <p className="mr-muted">Rush/receiving TD excludes passing touchdowns and return scores. “1+ passing TD” is a separate quarterback event. Estimates are not player-prop prices or parlay probabilities.</p>
    <details className="mr-method"><summary>Model validation & data provenance</summary>
      <p>Development benchmark: fit 2018–2023, calibrate 2024, test 2025. This is retrospective evaluation, separate from the live winner-model record. Lower error and lower Brier scores are better.</p>
      <div className="mr-table-scroll"><table><thead><tr><th>Forecast</th><th>Model error</th><th>Baseline error</th><th>Measure</th></tr></thead><tbody>{[['Team points', report.validation.scoring], ['Game total', report.validation.scoring.total], ['Home margin', report.validation.scoring.margin], ...Object.entries(report.validation.yardage).map(([kind, m]) => [`${kind} yards`, m])].map(([name, metric]) => {const m = metric as Metric;return <tr key={String(name)}><th>{String(name)}</th><td>{m.mae.toFixed(2)}</td><td>{m.baseline_mae.toFixed(2)}</td><td>MAE</td></tr>;})}{Object.entries(report.validation.touchdowns).map(([name, m]) => <tr key={name}><th>{name === 'any_td' ? 'Rush/receiving TD' : 'Passing TD'}</th><td>{m.brier.toFixed(4)}</td><td>{m.baseline_brier.toFixed(4)}</td><td>Brier</td></tr>)}</tbody></table></div>
      <p>Scoring baseline: average of the team’s recent points and its opponent’s recent points allowed. Yardage baseline: last three appearances. TD baseline: smoothed historical per-appearance rate. Full reliability bins and prediction-range coverage are in the saved validation export.</p>
      <p>Ranges target 80% coverage using a separate calibration period. They express outcome uncertainty and may include negative player yardage. They are not confidence ratings for a bet.</p>
      {lineage && <div className="mr-table-scroll"><table><thead><tr><th>Current model</th><th>Fit through</th><th>Calibrated through</th><th>Fit / calibration samples</th></tr></thead><tbody>{Object.entries(lineage.models).map(([name, m]) => <tr key={name}><th>{name.replaceAll('_', ' ')}</th><td>{m.training_cutoff[0]} W{m.training_cutoff[1]}</td><td>{m.calibration_cutoff[0]} W{m.calibration_cutoff[1]}</td><td>{m.training_samples} / {m.calibration_samples}</td></tr>)}</tbody></table></div>}
      <p>Snapshot saved {new Date(prediction.generated_at).toLocaleString()} · model version {prediction.model_version}. Sources: nflverse schedules, weekly player stats and play-by-play. New projections are saved only before kickoff.</p>
    </details>
  </div>;
}
