import { eligible, probabilitySummary } from './likelihoodMarkets.ts';
import type { Board } from './SameGamePicks.tsx';
import type { Offer } from './projectionMarkets.ts';

const targets: Record<string, string> = {
  attempts: 'attempts', passing_yards: 'passing', rushing_yards: 'rushing',
  receiving_yards: 'receiving', passing_tds: 'passing_td', scoring_tds: 'scoring_td',
};

export function sameGameSuggestions(boards: Record<string, Board> | undefined, offers: Offer[], now: number, count: number) {
  const byEvent = new Map<string, Offer>();
  for (const offer of offers) {
    if (!offer.player_id || !eligible(offer, now)) continue;
    const key = [offer.game_id, offer.team, offer.player_id, offer.target, offer.direction, offer.line].join(':');
    byEvent.set(key, offer);
  }

  const options = Object.entries(boards ?? {}).flatMap(([gameId, board]) => {
    const kickoff = Date.parse(board.kickoff), saved = Date.parse(board.saved_at), forecast = Date.parse(board.forecast_at ?? '');
    if (!(forecast <= saved && saved <= now && now < kickoff && now - forecast <= 72 * 3600000)) return [];
    return (board.options[count] ?? []).flatMap(option => {
      if (option.result !== 'pending' || option.legs.length !== count) return [];
      const legs = option.legs.map(leg => {
        const td = leg.stat === 'passing_tds' || leg.stat === 'scoring_tds';
        if (td && leg.threshold !== 1) return undefined;
        return byEvent.get([gameId, leg.team, leg.player_id, targets[leg.stat], td ? 'yes' : 'over', td ? null : leg.threshold - .5].join(':'));
      });
      if (!legs.every((leg): leg is Offer => !!leg && Date.parse(leg.kickoff ?? '') === kickoff)) return [];
      const bounds = probabilitySummary(legs);
      if (!bounds) return [];
      return [{gameId, legs, bounds, id:legs.map(leg => leg.id).sort().join('|')}];
    });
  }).sort((a,b) => b.bounds.lower-a.bounds.lower || b.bounds.upper-a.bounds.upper || a.id.localeCompare(b.id));

  const games = new Set<string>();
  return options.filter(option => {
    if (games.has(option.gameId)) return false;
    games.add(option.gameId);
    return true;
  }).slice(0,3);
}
