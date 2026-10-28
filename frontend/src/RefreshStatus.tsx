import { useEffect, useState } from 'react';
import { nextCheck, sourceNote, statusSummary, validDate } from './refreshStatus';
import type { RefreshStatus as Status } from './refreshStatus';
import './RefreshStatus.css';

function dateLabel(value?: string | null) {
  const time = validDate(value);
  return time === null ? 'Not yet recorded' : new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: 'America/Chicago',
  }).format(time);
}
export default function RefreshStatus({season, week}: {season?: number; week?: number}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const controller = new AbortController();
    const load = () => fetch(`${import.meta.env.BASE_URL}refresh_status.json`, {signal: controller.signal, cache: 'no-cache'})
      .then(r => {if (!r.ok) throw Error('Status unavailable'); return r.json();})
      .then((value: Status) => {if (value.schema_version !== 1 || !Array.isArray(value.sources)) throw Error('Invalid status'); setStatus(value);})
      .catch(() => { /* Existing data remains usable; the summary reports unavailable status. */ });
    void load();
    const onVisible = () => {setNow(Date.now()); if (document.visibilityState === 'visible') void load();};
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible);};
  }, []);
  const matches = status && status.active_season === season && status.active_week === week;
  const summary = statusSummary(matches ? status : null, now);
  const next = status ? nextCheck(status, now) : null;
  return <details className={`refresh-status is-${summary.tone}`}>
    <summary>
      <span className="refresh-status-slate">ACTIVE SLATE <b>{season ?? '—'} · Week {week ?? '—'}</b></span>
      <span className="refresh-status-state"><i aria-hidden="true"/>{summary.label}</span>
      <span className="refresh-status-last">Last full refresh <b>{dateLabel(status?.last_successful_refresh_at)}</b></span>
      <span className="refresh-status-toggle">Data status <span aria-hidden="true">⌄</span></span>
    </summary>
    <div className="refresh-status-body">
      <div className="refresh-status-explanation"><div><h2>Refresh &amp; data freshness</h2><p>Active slate is separate from any saved week you’re viewing. Times are Central.</p></div>
        {status?.workflow_url && /^https:\/\/github\.com\/jfleege\/intercepted\/actions\/runs\/\d+$/.test(status.workflow_url) && <a href={status.workflow_url} target="_blank" rel="noreferrer">View refresh run ↗</a>}
      </div>
      {matches && status.forecast_check ? <p className="refresh-status-check"><strong>Weekly check · {dateLabel(status.forecast_check.checked_at)}</strong><span>{status.attempt?.steps?.forecast === 'failure' ? 'The latest forecast check failed. Previously published forecasts are retained.' : status.forecast_check.message}</span></p> : <p className="refresh-status-check">Weekly refresh evidence isn’t available for this active slate yet.</p>}
      {matches && status.attempt?.completed_at && <p className="refresh-status-attempt">Latest data attempt: {dateLabel(status.attempt.completed_at)} · {status.attempt.state === 'success' ? (status.attempt.mode === 'results' ? 'Results refresh completed' : 'Data refresh completed') : status.attempt.state === 'partial' ? 'Incomplete refresh · previous successful timestamp retained' : 'Initial status snapshot'}</p>}
      <p className="refresh-status-schedule">{next ? <>Next scheduled forecast check: <strong>{dateLabel(new Date(next).toISOString())}</strong>.</> : <>Forecast checks run daily at 13:17 UTC (8:17 a.m. CDT / 7:17 a.m. CST).</>} Weekly archive &amp; refresh: Tuesdays at noon Central. Stats delays can postpone rollover. Prop quote checks begin Thursday.</p>
      {matches && <dl className="refresh-status-sources">{status.sources.map(source => <div key={source.id}>
        <dt>{source.label}</dt><dd>{dateLabel(source.updated_at)}<small>{sourceNote(source, status, now)}</small></dd>
      </div>)}</dl>}
      <p className="refresh-status-footnote">This is a published status snapshot, not a live workflow monitor. A failed deployment can leave the previous snapshot visible. Full refresh means the data steps completed; it does not mean every source or quote changed.</p>
    </div>
  </details>;
}
