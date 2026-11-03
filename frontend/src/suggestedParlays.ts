import { crossGameIdeas, eligible } from './likelihoodMarkets.ts';
import type { Idea } from './likelihoodMarkets.ts';
import type { Offer } from './projectionMarkets.ts';
export type Suggestion = Idea & { profile: string; description: string };
export function suggestedParlays(offers: Offer[], now: number, count: number | null = null): Suggestion[] {
  const presets = [
    { name: 'Higher probability', description: 'Each leg has at least 65% model likelihood.', count: 2, minimum: .65, category: 'all' },
    { name: 'Player yardage', description: 'Scored yardage thresholds, each at least 55%.', count: 3, minimum: .55, category: 'yardage' },
    { name: 'Mixed markets', description: 'Different market types, each at least 50%.', count: 4, minimum: .5, category: 'all' },
    { name: 'Touchdown options', description: 'Touchdown estimates, each at least 25%.', count: 3, minimum: .25, category: 'touchdown' },
  ];
  const seen = new Set<string>();
  const upcoming = offers.filter(o => eligible(o, now));
  return presets.flatMap(preset => {
    const pool = upcoming.filter(o => preset.category === 'all' || o.category === preset.category);
    const size = count ?? preset.count;
    const ranked = pool.filter(o => o.probability! >= preset.minimum).sort((a,b) => b.probability! - a.probability! || a.id.localeCompare(b.id));
    const first = ranked[0];
    const second = first && ranked.find(o => o.category !== first.category && o.game_id !== first.game_id);
    const pinned = preset.name === 'Mixed markets' && first && second ? [first.id, second.id] : [];
    const candidates = crossGameIdeas(pool, 'custom', size, 6, now, { pinned, minimum: preset.minimum, diversity: .5, maxShared: Math.max(0, size - 2) });
    return candidates.filter(idea => {
      if (seen.has(idea.id)) return false;
      if (preset.name === 'Mixed markets' && new Set(idea.legs.map(o => o.category)).size < 2) return false;
      return true;
    }).slice(0, 2).map(idea => { seen.add(idea.id); return { ...idea, profile: preset.name, description: preset.description }; });
  });
}
