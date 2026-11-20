import {useEffect, useState} from 'react';
import {fetchSnapshot} from './snapshotCache';
import Segmented from './Segmented';
import InterfaceIcon from './InterfaceIcon';
import ParlayLegs from './ParlayLegs';
import {sameGameSignal} from './sameGameSignal';
import {BookControls, BookPicks, LegPrice, TicketPayout, bookKeys, useQuoteFeeds} from './SportsbookPricing';
import type {Stake} from './SportsbookPricing';
import {quoteFor} from './sportsbookQuotes';
import type {Book, Leg as PriceLeg} from './sportsbookQuotes';
import './SameGamePicks.css';

type Signal = 'strong' | 'limited' | 'none';
type Leg = {stat:string; threshold:number; player_id:string; name:string; team:string; label:string; probability:number; actual?:number};
type Option = {legs:Leg[]; lower:number; upper:number; result:'pending' | 'hit' | 'miss' | 'incomplete' | 'cancelled'};
export type Board = {signal:Signal; reason:string; options:Record<string, Option[]>; kickoff:string; forecast_at?:string; saved_at:string};
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

export function sameGameBoardStale(board:Board, now:number) {
  return now < Date.parse(board.kickoff) && board.signal !== 'none' &&
    now - Date.parse(board.forecast_at ?? '') > maxAge;
}

export function SameGameBadge({board}: {board?:Board}) {
  if (!board) return null;
  const now = Date.now();
  const started = now >= Date.parse(board.kickoff);
  const expired = sameGameBoardStale(board, now);
  const option = board.options['2']?.[0];
  const {color, label} = started ? {color:'archived', label:'SGP archived'} : sameGameSignal(expired ? undefined : option?.lower);
  const reason = expired ? 'Pregame player projections have aged out.' : option
    ? `${pct(option.lower)}–${pct(option.upper)} all-hit model bounds for the leading two-leg combo.` : board.reason;
  const description = `${label} · ${reason}`;
  return <span className={`sgp-badge sgp-${color}`} title={description}>
    <InterfaceIcon name="poker-chips" size={25}/><span className="sgp-status-text">{description}</span>
  </span>;
}

function quoteLeg(leg:Leg, gameId:string, kickoff:string):PriceLeg {
  const targets:Record<string,string> = {attempts:'attempts',passing_yards:'passing',rushing_yards:'rushing',receiving_yards:'receiving',scoring_tds:'scoring_td',passing_tds:'passing_td'};
  const touchdown = leg.stat==='scoring_tds' || leg.stat==='passing_tds';
  return {game_id:gameId,team:leg.team,name:leg.name,target:targets[leg.stat]??leg.stat,
    direction:touchdown?'yes':'over',line:leg.stat==='scoring_tds'?null:leg.threshold-.5,kickoff};
}

export default function SameGamePicks({season, week, gameId}: {season:number; week:number; gameId:string}) {
  const board = useSameGame(season,week)?.[gameId];
  const [count,setCount] = useState(2);
  const [book,setBook] = useState<Book>('draftkings');
  const [stake,setStake] = useState<Stake>(1);
  const feeds = useQuoteFeeds();
  const now = Date.now();
  const options = board?.options[count] ?? [];
  const ranked = options.map((option,index)=>({option,index,legs:option.legs.map(leg=>quoteLeg(leg,gameId,board!.kickoff))}));
  const byBook = bookKeys.map(key=>({key,pick:ranked.find(({legs})=>legs.every(leg=>quoteFor(leg,key,feeds,now)))}));
  return <section className="sgp-panel" aria-label="Same-game picks">
    <header><div><h3>Same-game picks</h3><p>Ranked by the lower all-hit bound for the selected leg count.</p></div><SameGameBadge board={board}/></header>
    {!board ? <p className="sgp-muted">No saved same-game board for this matchup.</p> : <>
      {sameGameBoardStale(board,Date.now()) ? <p className="sgp-muted">Pregame projections have aged out. The saved options are shown for reference.</p>
        : !board.options['2'] && <p className="sgp-muted">{board.reason}</p>}
      {board.options['2'] && <>
        <Segmented className="sgp-count" role="group" aria-label="Same-game leg count">
          {[2,5,6,7,8,9,10].map(n => <button key={n} type="button" aria-pressed={count===n} onClick={() => setCount(n)}>{n} legs</button>)}
        </Segmented>
        <p className="sgp-muted">Chip color uses the leading two-leg option’s lower bound. Green starts at 80%, amber at 70%, and red is below 70% or has no available combo. Longer combinations have their own bounds.</p>
        <BookControls {...{book,stake,setBook,setStake}}/>
        {now<Date.parse(board.kickoff) && !!ranked.length && <BookPicks picks={byBook.map(({key,pick})=>({key,index:pick?.index}))} setBook={setBook}/>}
        <div className="sgp-options">{ranked.map(({option,index,legs}) => <article key={option.legs.map(leg => leg.player_id).join(':')}>
          <header><h4>Option {index+1}{index===0?' · Best model':''}</h4><strong>{pct(option.lower)}–{pct(option.upper)}</strong></header>
          <small>All-hit bounds given model probabilities</small>
          <ParlayLegs legs={option.legs.map((leg,i) => ({id:leg.player_id,context:leg.team,name:leg.name,market:leg.label,probability:leg.probability,actual:leg.actual,quote:now<Date.parse(board.kickoff)?<LegPrice leg={legs[i]} {...{book,feeds,now}}/>:undefined}))}/>
          <TicketPayout {...{legs,book,stake,feeds,now}}/>
          <small className="sgp-result">{statusLabels[option.result]}</small>
        </article>)}</div>
        {!options.length && <p className="sgp-muted">Fewer than {count} distinct players have usable forecasts.</p>}
        <p className="sgp-muted">Player estimates assume those players appear. Bounds allow for dependence between legs and rely on the individual model probabilities. A 0% lower bound means the inputs alone provide no positive floor. Payout and sportsbook eligibility depend on the offered combination.</p>
      </>}
    </>}
  </section>;
}
