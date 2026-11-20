import { useState } from 'react';
import { suggestedParlays } from './suggestedParlays';
import { sameGameSuggestions } from './sameGameSuggestions';
import { useSameGame } from './SameGamePicks';
import ParlayLegs from './ParlayLegs';
import type { Offer } from './projectionMarkets';

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;

export default function SuggestedParlays({ offers, season, week, now, onUse, onSave, onCustomize }: {
  offers: Offer[]; season: number; week: number; now: number;
  onUse: (legs: Offer[]) => void; onSave: (legs: Offer[]) => void; onCustomize: () => void;
}) {
  const [count, setCount] = useState<number | null>(null);
  const boards = useSameGame(season, week);
  const sameGame = sameGameSuggestions(boards, offers, now, count ?? 2);
  const crossGame = suggestedParlays(offers, now, count).slice(0, sameGame.length ? 2 : 3);
  const cards = [
    ...sameGame.map(o => ({id:o.id, title:o.legs[0].matchup, kind:'Same game', legs:o.legs,
      summary:`All-hit model bounds · ${pct(o.bounds.lower)}–${pct(o.bounds.upper)}`})),
    ...crossGame.map(o => ({id:o.id, title:o.profile, kind:'Cross-game', legs:o.legs,
      summary:`Lowest individual estimate · ${pct(Math.min(...o.legs.map(leg=>leg.probability!)))}`})),
  ];
  return <section className="mb-panel mb-combinations" aria-label="Suggested parlays">
    <div className="mb-section-title"><div><span className="mb-eyebrow">SUGGESTED PARLAYS</span><h2>Explore combinations from the model.</h2></div></div>
    <p className="mb-note">Upcoming same-game picks first, followed by cross-game options. Player estimates assume the player appears.</p>
    <div className="mb-controls mb-suggestion-controls"><label>Leg count<select value={count ?? 'variety'} onChange={e => setCount(e.target.value === 'variety' ? null : Number(e.target.value))}><option value="variety">Variety · 2–4 legs</option>{[2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n} legs</option>)}</select></label><button type="button" onClick={onCustomize}>Customize</button></div>
    <div className="lm-ideas">{cards.map((card, index) => <article className="lm-idea" key={card.id}>
      <div className="mb-section-title"><h3>{card.title}</h3><span className="mb-badge">{card.kind} · {card.legs.length} legs</span></div>
      <ParlayLegs legs={card.legs.map(leg => ({...leg,context:card.kind==='Same game' ? leg.team : leg.matchup,conditional:!!leg.player_id}))}/>
      <p className="mb-note">{card.summary}</p>
      <div className="lm-suggestion-actions"><button className="mb-primary" onClick={() => onUse(card.legs)}>Use suggestion {index + 1}</button><button onClick={() => onSave(card.legs)}>Save suggestion {index + 1}</button></div>
    </article>)}</div>
    {!cards.length && <p className="mb-empty">No suggestions match the current slate and filters. Choose fewer legs or customize the builder.</p>}
  </section>;
}
