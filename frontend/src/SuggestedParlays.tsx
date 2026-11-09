import { useMemo, useState } from 'react';
import { suggestedParlays } from './suggestedParlays';
import type { Offer } from './projectionMarkets';

export default function SuggestedParlays({ offers, now, onUse, onSave, onCustomize }: {
  offers: Offer[]; now: number; onUse: (legs: Offer[]) => void; onSave: (legs: Offer[]) => void; onCustomize: () => void;
}) {
  const [count, setCount] = useState<number | null>(null);
  const options = useMemo(() => suggestedParlays(offers, now, count), [offers, now, count]);
  return <section className="mb-panel mb-combinations" aria-label="Suggested parlays">
    <div className="mb-section-title"><div><span className="mb-eyebrow">SUGGESTED PARLAYS</span><h2>Explore combinations from the model.</h2></div><span className="mb-badge">One leg per game</span></div>
    <p className="mb-note">Upcoming games only. Suggestions use scored winner, player yardage, and touchdown estimates from the expanded player pool. Unscored projection guides and players reported out are excluded.</p>
    <div className="mb-controls mb-suggestion-controls"><label>Leg count<select value={count ?? 'variety'} onChange={e => setCount(e.target.value === 'variety' ? null : Number(e.target.value))}><option value="variety">Variety · 2–4 legs</option>{[2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} legs</option>)}</select></label><button type="button" onClick={onCustomize}>Customize</button></div>
    <p className="mb-note">These are individual model estimates, not sportsbook prices or a calibrated parlay hit rate. Player estimates are conditional on appearing; multiplying them would not establish an unconditional chance of winning.</p>
    <div className="lm-ideas">{options.map((idea, index) => <article className="lm-idea" key={idea.id}>
      <div className="mb-section-title"><h3>{idea.profile}</h3><span className="mb-badge">{idea.legs.length} legs</span></div><p className="mb-note">{idea.description}</p>
      <div className="mb-combo-legs">{idea.legs.map(leg => <div key={leg.id}><small>{leg.matchup}</small><strong>{leg.name} · {leg.market}</strong><span>{(leg.probability! * 100).toFixed(1)}% model likelihood{leg.player_id ? ' · if appearing' : ''}</span></div>)}</div>
      <p className="mb-note">Lowest individual estimate: {(Math.min(...idea.legs.map(o => o.probability!)) * 100).toFixed(1)}%</p>
      <button className="mb-primary" onClick={() => onUse(idea.legs)}>Use suggestion {index + 1}</button><button onClick={() => onSave(idea.legs)}>Save suggestion {index + 1}</button>
    </article>)}</div>
    {!options.length && <p className="mb-empty">No suggestions meet these profiles with the current upcoming games and filters. Choose fewer legs or customize the builder.</p>}
    {!!options.length && <p className="mb-note">Showing {options.length} distinct options. Profiles without enough eligible games are omitted.</p>}
  </section>;
}
