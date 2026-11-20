import {useEffect, useState} from 'react';
import {fetchSnapshot} from './snapshotCache';
import Segmented from './Segmented';
import InterfaceIcon from './InterfaceIcon';
import {sameGameSignal} from './sameGameSignal';
import './SameGamePicks.css';

type Signal = 'strong' | 'limited' | 'none';
type Leg = {player_id:string; name:string; team:string; label:string; probability:number; actual?:number};
type Option = {legs:Leg[]; lower:number; upper:number; result:'pending' | 'hit' | 'miss' | 'incomplete' | 'cancelled'};
type Board = {signal:Signal; reason:string; options:Record<string, Option[]>; kickoff:string; forecast_at?:string; saved_at:string};
type Snapshot = {season:number; week:number; games:Record<string, Board>};
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
  const now = Date.now();
  const started = now >= Date.parse(board.kickoff);
  const expired = stale(board, now);
  const option = board.options['2']?.[0];
  const {color, label} = started ? {color:'archived', label:'SGP archived'} : sameGameSignal(expired ? undefined : option?.lower);
  const reason = expired ? 'Pregame player projections have aged out.' : option
    ? `${pct(option.lower)}–${pct(option.upper)} all-hit model bounds for the leading two-leg combo.` : board.reason;
  const description = `${label} · ${reason}`;
  return <span className={`sgp-badge sgp-${color}`} title={description}>
    <InterfaceIcon name="poker-chips" size={25}/><span className="sgp-status-text">{description}</span>
  </span>;
}

export default function SameGamePicks({season, week, gameId}: {season:number; week:number; gameId:string}) {
  const board = useSameGame(season,week)?.[gameId];
  const [count,setCount] = useState(2);
  const options = board?.options[count] ?? [];
  return <section className="sgp-panel" aria-label="Same-game picks">
    <header><div><h3>Same-game picks</h3><p>Ranked by the lower all-hit bound for the selected leg count.</p></div><SameGameBadge board={board}/></header>
    {!board ? <p className="sgp-muted">No saved same-game board for this matchup.</p> : <>
      {stale(board,Date.now()) ? <p className="sgp-muted">Pregame projections have aged out. The saved options are shown for reference.</p>
        : !board.options['2'] && <p className="sgp-muted">{board.reason}</p>}
      {board.options['2'] && <>
        <Segmented className="sgp-count" role="group" aria-label="Same-game leg count">
          {[2,5,6,7,8,9,10].map(n => <button key={n} type="button" aria-pressed={count===n} onClick={() => setCount(n)}>{n} legs</button>)}
        </Segmented>
        <p className="sgp-muted">Chip color uses the leading two-leg option’s lower bound. Green starts at 80%, amber at 70%, and red is below 70% or has no available combo. Longer combinations have their own bounds.</p>
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
