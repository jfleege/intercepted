import { buildOffers, readDrafts } from './projectionMarkets.ts';
import type { Offer, Research, Model } from './projectionMarkets.ts';
import type { PredictionData } from './forecastTypes.ts';

export const PLAN_KEY = 'intercepted.likelihood-plans.v1';
export type Factor = 'higher' | 'even' | 'longer' | 'agreement';
export type Plan = { schema_version: 1; id: string; saved_at: string; kind: 'likelihood_research_plan'; legs: Offer[] };
export type Idea = { id: string; legs: Offer[]; score: number };
const validP = (p: unknown): p is number => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1;

/** No sportsbook input: means/ranges remain guides, never fabricated hit rates. */
export function likelihoodOffers(data: PredictionData, research: Research | null, model: Model, now: number): Offer[] {
  return buildOffers(data, research, null, [], model, now).map(o => withoutPrice(o.category === 'moneyline' ? { ...o, forecastAt: data.generated_at ?? null, modelVersion: `winner-snapshot:${data.generated_at ?? 'unknown'}` } : o));
}
export function withoutPrice(o: Offer): Offer {
  return { ...o, price: null, bookmaker: null, quoteFresh: false, quoteAt: null, quoteMarketAt: null, quoteEventId: null, quotePlayer: null };
}
export function eligible(o: Offer, now: number) {
  const kickoff = Date.parse(o.kickoff ?? ''), forecast = Date.parse(o.forecastAt ?? '');
  return validP(o.probability) && Number.isFinite(kickoff) && kickoff > now && Number.isFinite(forecast) && forecast <= now && forecast < kickoff;
}
export function support(o: Offer) {
  const values = o.modelRange?.filter(validP) ?? [];
  return values.length ? values.filter(p => p >= .5).length / values.length : null;
}
function factorScore(o: Offer, factor: Factor) {
  if (factor === 'agreement') return (support(o) ?? 0) * 2 + o.probability!;
  if (factor === 'even') return 1 - Math.abs(o.probability! - .5);
  return o.probability!;
}
const key = (legs: Offer[]) => legs.map(o => o.id).sort().join('|');

/** Bounded beam search; deterministic alternatives, exact count, one leg per game. */
export function crossGameIdeas(offers: Offer[], factor: Factor, count: number, limit: number, now: number): Idea[] {
  if (![2, 3, 4].includes(count) || ![3, 4, 5, 6].includes(limit)) return [];
  const available = offers.filter(o => eligible(o, now) && (factor === 'higher' ? o.probability! >= .65 : factor === 'even' ? o.probability! >= .45 && o.probability! <= .55 : factor === 'longer' ? o.probability! < .45 : o.category === 'moneyline' && o.probability! >= .5 && support(o) !== null));
  const grouped = new Map<string, Offer[]>();
  for (const o of available) { const group = grouped.get(o.game_id) ?? []; if (!group.some(other => other.id === o.id)) group.push(o); grouped.set(o.game_id, group); }
  const beams: Offer[][][] = Array.from({ length: count + 1 }, () => []); beams[0] = [[]];
  const score = (legs: Offer[]) => legs.reduce((sum, o) => sum + factorScore(o, factor), 0);
  for (const [, group] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const candidates = group.sort((a, b) => factorScore(b, factor) - factorScore(a, factor) || a.id.localeCompare(b.id)).slice(0, 6);
    for (let n = count; n >= 1; n--) {
      beams[n] = [...beams[n], ...beams[n - 1].flatMap(legs => candidates.map(o => [...legs, o]))]
        .sort((a, b) => score(b) - score(a) || key(a).localeCompare(key(b))).slice(0, 240);
    }
  }
  const pool = beams[count].map(legs => ({ id: key(legs), legs, score: score(legs) / count }));
  const chosen: Idea[] = [];
  while (pool.length && chosen.length < limit) {
    // Prefer useful alternatives: penalize overlap with the options already displayed.
    const adjusted = (idea: Idea) => idea.score - .12 * Math.max(0, ...chosen.map(other => idea.legs.filter(o => other.legs.some(l => l.id === o.id)).length / count));
    pool.sort((a, b) => adjusted(b) - adjusted(a) || a.id.localeCompare(b.id));
    chosen.push(pool.shift()!);
  }
  return chosen;
}

/** Fréchet bounds from marginals; not a confidence interval or fitted joint model. */
export function probabilitySummary(legs: Offer[], reductionPP = 0) {
  if (!legs.length || !Number.isFinite(reductionPP) || reductionPP < 0 || reductionPP > 100 || legs.some(o => !validP(o.probability))) return null;
  const probabilities = legs.map(o => Math.max(0, o.probability! - reductionPP / 100));
  return { lower: Math.max(0, probabilities.reduce((sum, p) => sum + p, 0) - (legs.length - 1)), upper: Math.min(...probabilities), independent: probabilities.reduce((product, p) => product * p, 1), weakest: Math.min(...probabilities), average: probabilities.reduce((sum, p) => sum + p, 0) / probabilities.length };
}
export function decision(o: Offer, threshold: number, reductionPP: number) {
  if (!validP(o.probability)) return { label: 'Projection guide', stressed: null };
  const stressed = Math.max(0, o.probability - reductionPP / 100);
  return { label: o.probability < threshold ? 'Below your threshold' : stressed < threshold ? 'Sensitive to assumptions' : 'Meets your threshold', stressed };
}
export function makePlan(legs: Offer[], now: number): Plan {
  // Reuse the strict legacy contract validator without writing/migrating that storage.
  const clean = legs.map(withoutPrice);
  readDrafts(JSON.stringify([{ schema_version: 1, id: 'validate', saved_at: new Date(now).toISOString(), kind: 'unverified_research_draft', stake: 1, legs: clean, combined_price: null, quote_source: 'unavailable', joint_probability: null }]));
  return { schema_version: 1, id: `plan:${now}:${key(clean)}`, saved_at: new Date(now).toISOString(), kind: 'likelihood_research_plan', legs: structuredClone(clean) };
}
export function readPlans(raw: string | null): Plan[] {
  if (raw === null) return [];
  const value = JSON.parse(raw);
  if (!Array.isArray(value)) throw Error('Saved plans are unreadable; existing storage is preserved.');
  for (const plan of value) {
    if (plan?.schema_version !== 1 || plan.kind !== 'likelihood_research_plan' || typeof plan.id !== 'string' || !Number.isFinite(Date.parse(plan.saved_at))) throw Error('Saved plans are unreadable; existing storage is preserved.');
    makePlan(plan.legs, Date.parse(plan.saved_at));
    if (plan.legs.some((o: Offer) => o.price !== null || o.bookmaker !== null || o.quoteFresh !== false || o.quoteAt !== null)) throw Error('Saved plans contain unexpected quote data; existing storage is preserved.');
  }
  return value;
}
