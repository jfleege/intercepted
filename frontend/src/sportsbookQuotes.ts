import type { Odds, Offer, PropQuotes } from './projectionMarkets.ts';

export const BOOKS = {draftkings:'DraftKings', fanduel:'FanDuel', betmgm:'BetMGM', williamhill_us:'Caesars'} as const;
export type Book = keyof typeof BOOKS;
export type QuoteFeeds = {props:PropQuotes|null; games:Odds|null};
export type Leg = Pick<Offer,'game_id'|'team'|'name'|'target'|'direction'|'line'> & {kickoff:string|null};
export type Price = {odds:number; updated:string; saved:string};
export const american = (price:number) => price > 0 ? `+${price}` : String(price);

const propMarkets: Record<string,string[]> = {
  passing:['player_pass_yds','player_pass_yds_alternate'],
  rushing:['player_rush_yds','player_rush_yds_alternate'],
  receiving:['player_reception_yds','player_reception_yds_alternate'],
  attempts:['player_pass_attempts','player_pass_attempts_alternate'],
  scoring_td:['player_anytime_td'],
  passing_td:['player_pass_tds','player_pass_tds_alternate'],
};
const identity = (name:string) => name.normalize('NFKC').trim().toLowerCase().replace(/[.'’]/g,'').replace(/\s+/g,' ');
export const isPrice = (price:unknown): price is number => typeof price==='number' && Number.isInteger(price) && Math.abs(price)>=100;

export function quoteFor(leg:Leg, book:Book, feeds:QuoteFeeds, now:number):Price|null {
  const kickoff = Date.parse(leg.kickoff ?? '');
  if (!(now < kickoff)) return null;
  const price = (odds:unknown, updated:string|null|undefined, saved:string|null|undefined) => {
    const a = Date.parse(updated ?? ''), b = Date.parse(saved ?? '');
    return isPrice(odds) && updated && saved && a<=b && b<=now && b<kickoff ? {odds,updated,saved} : null;
  };
  const cached = feeds.props?.games[leg.game_id];
  const markets = propMarkets[leg.target];
  if (markets && cached && Date.parse(cached.kickoff)===kickoff && [cached.home_team,cached.away_team].includes(leg.team)) {
    const quoted = cached.by_book?.[book] ?? (book==='draftkings' && cached.bookmaker==='DraftKings' ? cached.markets : []);
    const side = leg.direction==='yes' && leg.target==='scoring_td' ? 'Yes' : leg.direction==='under' ? 'Under' : 'Over';
    const point = leg.target==='passing_td' ? leg.line??.5 : leg.line;
    const matches = quoted.filter(m=>markets.includes(m.key)).flatMap(m=>m.outcomes
      .filter(o=>identity(o.description)===identity(leg.name) && o.name===side && (side==='Yes' || o.point===point))
      .map(o=>price(o.price,m.last_update,cached.observed_at)).filter((q):q is Price=>q!==null));
    // Main/alternate feeds can duplicate the same quote. Conflicting prices are ambiguous.
    return matches.length && matches.every(q=>q.odds===matches[0].odds) ? matches[0] : null;
  }
  const base = feeds.games?.games[leg.game_id];
  const game = base?.by_book?.[book] ?? (book==='draftkings' && base?.bookmaker==='DraftKings' ? base : undefined);
  if (!game || Date.parse(game.commence_time)!==kickoff) return null;
  const teams = leg.game_id.split('_').slice(-2);
  const side = teams[1]===leg.team ? 'home' : teams[0]===leg.team ? 'away' : null;
  const saved = feeds.games?.exported_at;
  if (side && leg.target==='winner' && leg.direction==='win') return price(game[`${side}_moneyline`],game.moneyline_last_update??game.last_update,saved);
  if (side && leg.target==='margin' && game[`${side}_spread`]===leg.line) return price(game[`${side}_spread_price`],game.spreads_last_update??game.last_update,saved);
  if (leg.target==='total') {
    const points = leg.direction==='under' ? game.under_line : game.over_line;
    if (leg.line!==null && (points===undefined ? game.over_under : points)===leg.line) return price(leg.direction==='under'?game.under_price:game.over_price,game.totals_last_update??game.last_update,saved);
  }
  return null;
}

export function payout(odds:number, stake:number) {
  const profit = stake*(odds>0 ? odds/100 : 100/-odds);
  return {profit:profit.toFixed(2), returned:(profit+stake).toFixed(2)};
}
