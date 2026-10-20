import { useEffect, useState } from "react";
import "./ReviewPages.css";
import "./PerformancePage.css";

import type { Model } from "./predictionModels";
import { MODEL_LABELS, MODEL_ORDER } from "./predictionModels";
type Row = {
  game_id: string; game_date: string; season: number; week: number;
  home_team: string; away_team: string; probability: number; pick: string;
  home_score: number | null; away_score: number | null; grade: string; status: string;
  saved_at: string | null; model_version: string; training_cutoff: string;
  eligibility: string; eligibility_reason: string; snapshot_id: string;
};
type Summary = { games: number; correct: number; incorrect: number; ties: number; pending: number; cancelled: number; accuracy: number | null; brier: number | null; log_loss: number | null };
type Point = { game_number: number; game_id: string; label: string; date: string; correct: boolean; game_brier: number; accuracy: number; brier: number; log_loss: number };
type Dataset = { rows: Row[]; summary: Summary; trend: Point[]; weekly: (Summary & { season: number; week: number })[]; calibration: { bin: string; games: number; predicted: number; observed: number; lower: number; upper: number }[] };
type Payload = { schema_version: number; updated_at: string; snapshot_count: number; datasets: Record<string, Record<Model, Dataset>> };
const names = MODEL_LABELS;
const models = MODEL_ORDER;
const pct = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const decimal = (value: number | null) => value === null ? "—" : value.toFixed(4);
function Empty({ children }: { children: React.ReactNode }) { return <div className="review-empty"><h3>No graded games yet</h3><p>{children}</p></div>; }

function Trend({ data, compare, metric }: { data: Dataset; compare?: Dataset; metric: "accuracy" | "brier" }) {
  if (!data.trend.length) return <Empty>Final scores will populate this chart after a verified forecast is graded.</Empty>;
  const series = [data.trend, ...(compare ? [compare.trend] : [])];
  const width = 620, height = 210, left = 48, top = 16, bottom = 175, right = 600;
  const count = Math.max(...series.map(s => s.length));
  const x = (i: number) => left + (i / Math.max(1, count - 1)) * (right - left);
  const y = (v: number) => bottom - v * (bottom - top);
  return <figure className="performance-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Cumulative ${metric === "accuracy" ? "accuracy" : "Brier score"} over ${data.trend.length} graded games. Last value ${metric === "accuracy" ? pct(data.summary.accuracy) : decimal(data.summary.brier)}.`}>
    {[0, .25, .5, .75, 1].map(tick => <g key={tick}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} stroke="#dce4e7" /><text x={left - 8} y={y(tick) + 4} textAnchor="end">{metric === "accuracy" ? `${tick * 100}%` : tick.toFixed(2)}</text></g>)}
    {series.map((points, seriesIndex) => <g key={seriesIndex}>
      <polyline points={points.map((p, i) => `${x(i)},${y(p[metric])}`).join(" ")} fill="none" stroke={seriesIndex === 0 ? "#187be8" : "#bb7338"} strokeWidth="2.5" />
      {points.length === 1 && <circle cx={x(0)} cy={y(points[0][metric])} r="4" fill={seriesIndex === 0 ? "#187be8" : "#bb7338"} />}
    </g>)}
    <text x={left} y={200}>Game 1</text><text x={right} y={200} textAnchor="end">Game {count}</text>
  </svg><figcaption>Ordered by available kickoff/date, then game ID; backtests use season/week and game ID. Ties excluded. {compare && "Blue: QB+ · Copper: Base."} Each point includes all preceding games.</figcaption></figure>;
}

export default function PerformancePage() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [dataset, setDataset] = useState("verified");
  const [model, setModel] = useState<Model | "compare">("v5_qb_plus");
  const [metric, setMetric] = useState<"accuracy" | "brier">("accuracy");
  const [page, setPage] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}performance.json`, { signal: controller.signal, cache: "no-cache" })
      .then(response => { if (!response.ok) throw new Error("Performance data has not been published yet. Run the results refresh after merging."); return response.json(); })
      .then((result: Payload) => { if (result.schema_version !== 1 || !result.datasets?.verified) throw new Error("Unsupported performance data format"); setPayload(result); })
      .catch((e: Error) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [attempt]);
  const selected = model === "compare" ? "v4_qb_plus" : model;
  const data = payload?.datasets[dataset]?.[selected];
  const comparison = model === "compare" ? payload?.datasets[dataset]?.v4_a : undefined;
  const stats = data?.summary;
  const rows = data?.rows ?? [];
  const totalPages = Math.ceil(rows.length / 25);
  const descriptions: Record<string, string> = {
    verified: "First saved pregame forecast per game and model. Only final, non-tied games count toward accuracy and probability metrics.",
    retrospective: "Late or unverified forecasts, excluded from the verified record. These results are exploratory and must not be presented as live predictive performance.",
    backtest: "2022–2024 walk-forward experiments; regularization selected using earlier seasons. These are historical experiment results, not the fixed-C production model's live record.",
  };
  return <div className="review-page performance-page">
    <header className="review-heading"><div><p className="eyebrow">THE TRACK RECORD</p><h1>Performance</h1><p>Original forecasts. Final results. A record that grows with every game.</p></div><span className="review-draft">{payload ? `${payload.snapshot_count} ARCHIVED SNAPSHOTS` : "RESULTS TRACKER"}</span></header>
    <div className="review-controls"><div className="review-tabs" aria-label="Evaluation dataset">{[["verified", "Verified pregame"], ["retrospective", "Late / unverified"], ["backtest", "Historical backtest"]].map(([value, label]) => <button type="button" key={value} aria-pressed={dataset === value} onClick={() => { setDataset(value); setPage(0); }}>{label}</button>)}</div><label>Model <select value={model} onChange={e => { setModel(e.target.value as Model | "compare"); setPage(0); }}>{models.map(m => <option key={m} value={m}>{names[m]}</option>)}<option value="compare">Compare original QB+ / Base</option></select></label></div>
    <div className="review-notice">{descriptions[dataset]} {payload && <span>Updated {new Date(payload.updated_at).toLocaleString()}.</span>}</div>
    {error && <div className="review-notice" role="alert">{error} <button type="button" onClick={() => { setError(""); setAttempt(v => v + 1); }}>Retry loading</button></div>}
    {!payload && !error && <p className="performance-loading" role="status">Loading archived forecasts and results…</p>}
    <div className="review-metrics">{[
      ["Accuracy", pct(stats?.accuracy ?? null), `${stats?.games ?? 0} graded games`],
      ["Prediction record", stats ? `${stats.correct}–${stats.incorrect}` : "—", `${stats?.ties ?? 0} ties · ${stats?.pending ?? 0} pending · ${stats?.cancelled ?? 0} cancelled`],
      ["Brier score", decimal(stats?.brier ?? null), "Probability error · lower is better"],
      ["Log loss", decimal(stats?.log_loss ?? null), "Confident mistakes cost more · lower is better"],
    ].map(([title, value, note]) => <div className="review-metric" key={title}><span>{title}{model === "compare" && " · QB+"}</span><strong>{value}</strong><small>{note}</small></div>)}</div>
    {comparison && <section className="review-panel performance-block"><h2>Models on the same games</h2><div className="review-table-wrap"><table><thead><tr><th>Model</th><th>Graded</th><th>Accuracy</th><th>Brier</th><th>Log loss</th></tr></thead><tbody>{models.map(name => { const s = payload!.datasets[dataset][name].summary; return <tr key={name}><td>{names[name]}</td><td>{s.games}</td><td>{pct(s.accuracy)}</td><td>{decimal(s.brier)}</td><td>{decimal(s.log_loss)}</td></tr>; })}</tbody></table></div></section>}
    <div className="review-columns"><section className="review-panel"><div className="review-panel-heading"><h2>Overall trend</h2><select aria-label="Trend metric" value={metric} onChange={e => setMetric(e.target.value as "accuracy" | "brier")}><option value="accuracy">Cumulative accuracy</option><option value="brier">Cumulative Brier</option></select></div>{data ? <Trend data={data} compare={comparison} metric={metric} /> : <Empty>Results will appear after the first successful refresh.</Empty>}</section>
    <section className="review-panel"><div className="review-panel-heading"><h2>Game-by-game form</h2><span>Last 40 graded games · {names[selected]}</span></div>{data?.trend.length ? <><div className="performance-form">{data.trend.slice(-40).map(point => <div tabIndex={0} key={point.game_id} className={point.correct ? "is-correct" : "is-incorrect"} title={`${point.date} · ${point.label} · ${point.correct ? "Correct" : "Incorrect"} · Brier ${point.game_brier.toFixed(4)}`} aria-label={`${point.label}: ${point.correct ? "Correct" : "Incorrect"}, probability error ${point.game_brier.toFixed(4)}`}>{point.correct ? "✓" : "×"}</div>)}</div><p className="review-panel-note">Left to right: oldest to newest. Green = correct; red = incorrect. Hover or focus a game for its probability error. Full details are in the archive.</p></> : <Empty>Each graded game gets one result marker. No smoothing or invented results.</Empty>}</section></div>
    <div className="review-columns"><section className="review-panel"><div className="review-panel-heading"><h2>Week-by-week results</h2><span>{names[selected]}</span></div><div className="review-table-wrap"><table><thead><tr><th>Season / week</th><th>Record</th><th>Accuracy</th><th>Brier</th></tr></thead><tbody>{data?.weekly.map(w => <tr key={`${w.season}-${w.week}`}><td>{w.season} · W{w.week}</td><td>{w.correct}–{w.incorrect}<small>{w.pending} pending · {w.ties} ties</small></td><td>{pct(w.accuracy)}</td><td>{decimal(w.brier)}</td></tr>)}</tbody></table>{!data?.weekly.length && <Empty>Weekly totals accumulate as forecasts and final scores are archived.</Empty>}</div></section>
    <section className="review-panel"><div className="review-panel-heading"><h2>Probability calibration</h2><span>Home-win probabilities</span></div><div className="review-table-wrap"><table><thead><tr><th>Bin / n</th><th>Predicted</th><th>Observed</th><th>95% interval</th></tr></thead><tbody>{data?.calibration.map(bin => <tr key={bin.bin}><td>{bin.bin}<small>n = {bin.games}</small></td><td>{pct(bin.predicted)}</td><td>{pct(bin.observed)}</td><td>{pct(bin.lower)}–{pct(bin.upper)}</td></tr>)}</tbody></table>{!data?.calibration.length && <Empty>Calibration needs completed, non-tied games. Small samples will have wide uncertainty intervals.</Empty>}</div><p className="review-panel-note">Wilson intervals describe observed rates in each bin. Early samples are descriptive, not strong evidence of calibration.</p></section></div>
    <section className="review-panel"><div className="review-panel-heading"><div><h2>Forecast archive</h2><p>First eligible snapshot · {names[selected]} · {rows.length} games</p></div><span className="review-pill">{dataset === "verified" ? "PREGAME RECORD" : dataset.toUpperCase()}</span></div><div className="review-table-wrap"><table><thead><tr>{["Date / week", "Matchup", "Pick / confidence", "Final", "Grade", "Saved evidence"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.slice(page * 25, page * 25 + 25).map(row => <tr key={row.game_id}><td>{row.game_date}<small>{row.season} · W{row.week}</small></td><td>{row.away_team} @ {row.home_team}</td><td>{row.pick}<small>{pct(Math.max(row.probability, 1 - row.probability))}</small></td><td>{row.home_score !== null ? `${row.away_score}–${row.home_score}` : row.status === "final" ? "Winner only" : "—"}</td><td><span className={`performance-grade grade-${row.grade}`}>{row.grade}</span></td><td><details><summary>{row.saved_at ? new Date(row.saved_at).toLocaleString() : "Backtest"}</summary><small>{row.eligibility_reason}<br />Version: {row.model_version}<br />Training: {row.training_cutoff}<br />Snapshot: {row.snapshot_id}</small></details></td></tr>)}</tbody></table>{!rows.length && <Empty>No forecasts in this category. New pregame exports will be archived automatically.</Empty>}</div>{totalPages > 1 && <div className="performance-pagination"><button type="button" disabled={page === 0} onClick={() => setPage(v => v - 1)}>Previous</button><span>Page {page + 1} of {totalPages}</span><button type="button" disabled={page + 1 >= totalPages} onClick={() => setPage(v => v + 1)}>Next</button></div>}</section>
    <details className="review-method"><summary>How this record is evaluated</summary><p>Freeze the first verified snapshot per game and model. A saved timestamp must precede kickoff and follow the model creation timestamp; training must end before the forecast week. Git imports preserve the original commit reference as evidence, not independent timestamp certification. Late or unverified snapshots cannot enter verified metrics. Final ties, cancellations, and pending games are excluded from binary accuracy, Brier, and log loss. Scores come from nflverse schedules; provider corrections are retained as result revisions. Historical experiments use their original stored probabilities and selected regularization, separately from production. Current schedules may contain rescheduled kickoff times; the archive does not independently certify historical kickoff changes.</p><p>Daily refreshes are delayed snapshots, not live scores. Source: nflverse / nflreadpy (CC-BY 4.0). A result is graded only when the schedule publishes both final scores and a result.</p></details>
  </div>;
}
