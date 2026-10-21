import { useEffect, useId, useState } from 'react';
import { MODEL_LABELS, MODEL_ORDER } from './predictionModels';
import type { Model } from './predictionModels';
import type { PredictionData } from './forecastTypes';
import { modelAgreement, seasonRecord } from './dashboardMetrics';
import type { PerformanceFeed } from './dashboardMetrics';
import './DashboardMetrics.css';

const pct = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(1)}%`;
function AccuracyChart({ values }: { values: number[] }) {
  const id = useId();
  const points = values.map((value, i) => `${8 + i / Math.max(1, values.length - 1) * 204},${70 - value * 60}`);
  return <svg className="pulse-chart" viewBox="0 0 220 80" role="img" aria-label={`Cumulative accuracy over ${values.length} graded games`}>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#69cfff" stopOpacity=".25"/><stop offset="1" stopColor="#69cfff" stopOpacity="0"/></linearGradient></defs>
    {[10, 40, 70].map(y => <line key={y} x1="8" x2="212" y1={y} y2={y} className="pulse-guide"/>)}
    {points.length > 1 && <><polygon points={`8,78 ${points.join(' ')} 212,78`} fill={`url(#${id})`}/><polyline points={points.join(' ')} fill="none" stroke="#73d0ff" strokeWidth="2" strokeLinejoin="round"/></>}
    {values.map((v, i) => <circle key={i} cx={8 + i / Math.max(1, values.length - 1) * 204} cy={70 - v * 60} r={i === values.length - 1 ? 3 : 1.6} fill="#a5e3ff"/>)}
    {!values.length && <text x="110" y="43" textAnchor="middle" className="pulse-empty">Awaiting final scores</text>}
  </svg>;
}

export default function DashboardMetrics({ data }: { data: PredictionData | null }) {
  const [feed, setFeed] = useState<PerformanceFeed | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [recordModel, setRecordModel] = useState<Model>('v4_qb_plus');
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}performance.json`, { signal: controller.signal, cache: 'no-cache' })
      .then(response => { if (!response.ok) throw Error('Results unavailable'); return response.json(); })
      .then((value: PerformanceFeed) => {
        if (value.schema_version !== 1 || !value.datasets?.verified) throw Error('Unsupported results');
        if (!controller.signal.aborted) { setFeed(value); setFailed(false); }
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [attempt]);
  const record = seasonRecord(feed?.datasets.verified[recordModel]?.rows ?? [], data?.season ?? 0, data?.week ?? 0);
  const agreement = modelAgreement(data?.games ?? []);
  const ready = !!feed && !!data;
  const maxWeek = Math.max(1, ...record.weekly.map(w => w.total));
  const status = failed ? 'Results unavailable' : !ready ? 'Loading verified record…' : `${record.graded} graded · ${record.pending} pending${record.excluded ? ` · ${record.excluded} ties/voids` : ''}`;
  return <section className="season-pulse" aria-label="Dashboard season metrics">
    <div className="pulse-heading"><span>SEASON PULSE <b> / {data?.season ?? '—'}</b></span>
      <label>Record model <select aria-label="Record model" value={recordModel} onChange={event => setRecordModel(event.target.value as Model)}>{MODEL_ORDER.map(model => <option key={model} value={model}>{MODEL_LABELS[model]}</option>)}</select></label>
    </div>
    <div className="pulse-grid">
      <article className="pulse-card">
        <div className="pulse-card-top"><h3>Model accuracy</h3><span className="pulse-badge">VERIFIED</span></div>
        <div className="pulse-card-main"><div><strong className="pulse-value">{ready ? pct(record.accuracy) : '—'}</strong>
          <p className="pulse-support">{ready && record.graded ? `${record.correct}W – ${record.incorrect}L` : 'No graded games yet'}</p></div>
          <div className="pulse-visual"><AccuracyChart values={record.trend}/><span>Cumulative · game by game</span></div>
        </div>
        <div className="pulse-card-foot"><span>{status}</span>{record.delta !== null && <span className={record.delta >= 0 ? 'pulse-positive' : 'pulse-negative'}>{record.delta >= 0 ? '+' : ''}{(record.delta * 100).toFixed(1)} pp vs prior graded week</span>}</div>
        {record.form.length > 0 && <div className="pulse-form" aria-label="Last 14 graded results">{record.form.map(row => <span key={row.gameId} className={row.correct ? 'won' : 'lost'} title={`${row.gameId}: ${row.correct ? 'Correct' : 'Incorrect'}`}><span className="sr-only">{row.gameId}: </span>{row.correct ? 'W' : 'L'}</span>)}</div>}
      </article>
      <article className="pulse-card">
        <div className="pulse-card-top"><h3>Forecasts this season</h3><span className="pulse-badge">THROUGH W{data?.week ?? '—'}</span></div>
        <div className="pulse-card-main"><div><strong className="pulse-value">{ready ? record.total : '—'}</strong><p className="pulse-support">{MODEL_LABELS[recordModel]}</p></div>
          <div className="pulse-visual"><div className="pulse-week-bars" role="img" aria-label={record.weekly.map(w => `Week ${w.week}: ${w.total} forecasts, ${w.correct + w.incorrect} graded`).join('; ') || 'No saved forecasts'}>
            {record.weekly.map(w => <div className="pulse-week" key={w.week}><div className="pulse-week-column" title={`Week ${w.week}: ${w.total} forecasts, ${w.correct + w.incorrect} graded`} style={{height: `${w.total / maxWeek * 64}px`}}><span style={{height:`${(w.correct + w.incorrect) / w.total * 100}%`}}/></div><small>W{w.week}</small></div>)}
          </div><span><i className="pulse-legend"/> Graded <i className="pulse-legend pending"/> Pending / other</span></div>
        </div>
        <div className="pulse-card-foot"><span>Unique saved games · {data?.season ?? '—'}</span><a href="#performance">View record ↗</a></div>
      </article>
      <article className="pulse-card">
        <div className="pulse-card-top"><h3>Model agreement</h3><span className="pulse-badge">WEEK {data?.week ?? '—'}</span></div>
        <div className="pulse-card-main"><div><strong className="pulse-value">{pct(agreement.rate)}</strong><p className="pulse-support">{agreement.total ? `${agreement.unanimous} / ${agreement.total} unanimous picks` : 'Need two saved models'}</p></div>
          <div className="pulse-visual"><div className="pulse-consensus" role="img" aria-label={`Pick consensus by matchup, ${agreement.models.length} models. ${agreement.points.map(p => `${p.away} at ${p.home}: ${p.pick ? `${p.votes} of ${p.total} pick ${p.pick}` : 'even split'}`).join('; ')}`}>
            {agreement.points.map(p => <span className={p.share === 1 ? 'unanimous' : ''} key={p.gameId} style={{height:`${p.share * 64}px`}} title={`${p.away} @ ${p.home}: ${p.pick ? `${p.votes}/${p.total} pick ${p.pick}` : 'Even split'}`}/>)}
          </div><span>Pick consensus by matchup</span></div>
        </div>
        <div className="pulse-card-foot"><span>{agreement.models.length} saved models · same winner</span><span>Agreement ≠ confidence</span></div>
      </article>
    </div>
    {failed && <p className="pulse-error" role="status">Could not load the saved record. <button type="button" onClick={() => setAttempt(n => n + 1)}>Retry</button></p>}
  </section>;
}
