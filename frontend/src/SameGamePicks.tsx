import {useEffect, useState} from 'react';
import {fetchSnapshot} from './snapshotCache';
import Segmented from './Segmented';
import './SameGamePicks.css';

type Signal = 'strong' | 'limited' | 'none';
type Leg = {player_id:string; name:string; team:string; label:string; probability:number; actual?:number};
type Option = {legs:Leg[]; lower:number; upper:number; result:'pending' | 'hit' | 'miss' | 'incomplete' | 'cancelled'};
type Board = {signal:Signal; reason:string; options:Record<string, Option[]>; kickoff:string; forecast_at?:string; saved_at:string};
type Snapshot = {season:number; week:number; games:Record<string, Board>};
const labels:Record<Signal,string> = {strong:'Strong signal', limited:'Limited confidence', none:'No qualifying combo'};
const symbols:Record<Signal,string> = {strong:'✓', limited:'⚠', none:'×'};
const statusLabels = {pending:'Pending', hit:'All legs hit', miss:'Did not hit', incomplete:'Stats incomplete', cancelled:'Cancelled'};
const pct = (p:number) => `${(p * 100).toFixed(1)}%`;
const maxAge = 72 * 60 * 60 * 1000;

export function useSameGame(season?:number, week?:number) {
  const [snapshot, setSnapshot] = useState<Snapshot|null>(null);
  useEffect(() => {
    if (season == null || week == null) return;
    const controller = new AbortController();
    fetchSnapshot(`${import.meta.env.BASE_URL}same_game/${season}-week-${week}.json`, {signal:controller.signal})
      .then(r => r.json()).then(data => {if (!controller.signal.aborted) setSnapshot(data);}).catch(() => {});
    return () => controller.abort();
  }, [season,week]);
  return snapshot?.season === season && snapshot?.week === week ? snapshot?.games : undefined;
}

function stale(board:Board, now:number) {
  return now < Date.parse(board.kickoff) && board.signal !== 'none' &&
    now - Date.parse(board.forecast_at ?? '') > maxAge;
}

export function SameGameBadge({board}: {board?:Board}) {
  if (!board) return null;
  const started = Date.now() >= Date.parse(board.kickoff);
  const signal = stale(board, Date.now()) ? 'none' : board.signal;
  const label = started ? 'SGP archived' : labels[signal];
  const reason = signal !== board.signal ? 'Pregame player projections have aged out.' : board.reason;
  return <span className={`sgp-badge sgp-${started ? 'archived' : signal}`} title={`${label} · ${reason}`}>
    <b aria-hidden="true">{started ? '·' : symbols[signal]}</b><span className="sgp-status-text">{label}</span>
  </span>;
}

export default function SameGamePicks({season, week, gameId}: {season:number; week:number; gameId:string}) {
  const board = useSameGame(season,week)?.[gameId];
  const [count,setCount] = useState(2);
  const options = board?.options[count] ?? [];
  return <section className="sgp-panel" aria-label="Same-game picks">
    <header><div><h3>Same-game picks</h3><p>Ranked by the lower all-hit bound for the selected leg count.</p></div><SameGameBadge board={board}/></header>
    {!board ? <p className="sgp-muted">No saved same-game board for this matchup.</p> : <>
      <p className="sgp-muted">{stale(board,Date.now()) ? 'Pregame projections have aged out. The saved options are shown for reference.' : board.reason}</p>
      {board.options['2'] && <>
        <Segmented className="sgp-count" role="group" aria-label="Same-game leg count">
          {[2,5,6,7,8,9,10].map(n => <button key={n} type="button" aria-pressed={count===n} onClick={() => setCount(n)}>{n} legs</button>)}
        </Segmented>
        {count > 2 && <p className="sgp-muted">The slate badge grades the leading two-leg option. Longer combinations have their own bounds.</p>}
        <div className="sgp-options">{options.map((option, i) => <article key={option.legs.map(leg => leg.player_id).join(':')}>
          <header><h4>Option {i+1}</h4><strong>{pct(option.lower)}–{pct(option.upper)}</strong></header>
          <small>All-hit bounds given model probabilities</small>
          <ul>{option.legs.map(leg => <li key={leg.player_id}><span><b>{leg.name}</b><small>{leg.team} · {leg.label}</small></span><span>{pct(leg.probability)}{leg.actual != null && <small>Actual {leg.actual}</small>}</span></li>)}</ul>
          <p className="sgp-muted">{statusLabels[option.result]}</p>
        </article>)}</div>
        {!options.length && <p className="sgp-muted">Fewer than {count} distinct players have usable forecasts.</p>}
        <p className="sgp-muted">Player estimates assume those players appear. Bounds allow for dependence between legs and rely on the individual model probabilities. A 0% lower bound means the inputs alone provide no positive floor. Payout and sportsbook eligibility depend on the offered combination.</p>
      </>}
    </>}
  </section>;
}
