import {useEffect,useState} from 'react';
import {fetchSnapshot} from './snapshotCache';
import Segmented from './Segmented';
import {BOOKS, american, isPrice, payout, quoteFor} from './sportsbookQuotes';
import type {Book, Leg, QuoteFeeds} from './sportsbookQuotes';
import './SportsbookPricing.css';

export const bookKeys = Object.keys(BOOKS) as Book[];
export type Stake = 1|2|5;

export function useQuoteFeeds():QuoteFeeds {
  const [feeds,setFeeds] = useState<QuoteFeeds>({props:null,games:null});
  useEffect(()=>{
    const controller = new AbortController();
    for (const [key,file] of [['props','player_props.json'],['games','odds.json']] as const) {
      fetchSnapshot(`${import.meta.env.BASE_URL}${file}`,{signal:controller.signal})
        .then(r=>r.json()).then(data=>{if (!controller.signal.aborted) setFeeds(current=>({...current,[key]:data}));}).catch(()=>{});
    }
    return ()=>controller.abort();
  },[]);
  return feeds;
}

export function BookControls({book, stake, setBook, setStake}: {book:Book;stake:Stake;setBook:(book:Book)=>void;setStake:(stake:Stake)=>void}) {
  return <div className="book-controls">
    <Segmented role="group" aria-label="Sportsbook">{bookKeys.map(key=><button type="button" key={key} aria-pressed={book===key} onClick={()=>setBook(key)}>{BOOKS[key]}</button>)}</Segmented>
    <Segmented role="group" aria-label="Example stake">{([1,2,5] as const).map(value=><button type="button" key={value} aria-pressed={stake===value} onClick={()=>setStake(value)}>${value}</button>)}</Segmented>
  </div>;
}

export function BookPicks({picks,setBook}:{picks:{key:Book;index:number|undefined}[];setBook:(book:Book)=>void}) {
  return <div className="book-picks">
    <small>Top model option with all legs quoted by book. Check the full ticket at the sportsbook.</small>
    <div>{picks.map(({key,index})=>index==null
      ? <small key={key}>{BOOKS[key]} · No match</small>
      : <button type="button" key={key} onClick={()=>setBook(key)}>{BOOKS[key]} · Option {index+1}</button>)}</div>
  </div>;
}

export function LegPrice({leg,book,feeds,now}: {leg:Leg;book:Book;feeds:QuoteFeeds;now:number}) {
  const price = quoteFor(leg,book,feeds,now);
  return <small className="book-leg-price" title={price ? `Quote updated ${new Date(price.updated).toLocaleString()}` : undefined}>
    {BOOKS[book]} · {price ? `${american(price.odds)} · saved ${new Date(price.saved).toLocaleDateString()}` : 'No exact quote'}
  </small>;
}

export function TicketPayout({legs, book, stake, feeds, now}: {legs:Leg[];book:Book;stake:Stake;feeds:QuoteFeeds;now:number}) {
  const [entered,setEntered] = useState<Record<string,string>>({});
  const key = ticketKey(book,legs);
  const manual = entered[key] ?? '';
  if (!legs.length || legs.some(leg=>!(now<Date.parse(leg.kickoff ?? '')))) return null;
  const automatic = legs.length===1 ? quoteFor(legs[0],book,feeds,now) : null;
  const value = automatic?.odds ?? Number(manual.trim().replace(/^−/,'-'));
  const result = isPrice(value) ? payout(value,stake) : null;
  return <div className="book-payout">
    {!automatic && <label>{BOOKS[book]} {legs.length===1?'single':'full-ticket'} odds <input inputMode="text" value={manual} onChange={e=>setEntered({...entered,[key]:e.target.value})} placeholder="e.g. +240" /></label>}
    {result ? <small>{automatic?'Saved quote':'Entered quote'} · ${stake} stake returns <strong>${result.returned}</strong> (+${result.profit} profit)</small> :
      <small>{manual.trim()?'Enter American odds such as +240 or −110.':'Enter the exact sportsbook quote to see a payout.'}</small>}
  </div>;
}

const ticketKey = (book:Book, legs:Leg[]) => JSON.stringify([book,legs.map(l=>[l.game_id,l.team,l.name,l.target,l.direction,l.line,l.kickoff])]);
