export type WatchPlayer = {
  player_id: string; name: string; team: string; position: string;
  recent_average: number; season_average: number; trend_pct: number | null;
};
export type WatchProjection = {
  player_id: string; team: string; opponent: string; position: string; status: string;
  stat?: string; expected_yards?: number; range_80?: number[];
  anytime_td_probability?: number; passing_td_probability?: number;
};
export type WatchReport = {
  season: number; week: number;
  games: Record<string, { players: WatchProjection[] }>;
};
export type WatchMatchup<T> = { away_team: string; home_team: string; away_players: T[]; home_players: T[] };
export type RankedPlayer<T> = T & { opponent: string; isHome: boolean; projection?: WatchProjection; watchScore?: number };
const kinds: Record<string, string> = { QB: 'passing', RB: 'rushing', WR: 'receiving', TE: 'receiving' };
const floors: Record<string, number> = { QB: 100, RB: 25, WR: 20, TE: 15 };

// Midrank percentiles make different yardage scales comparable; ties share a rank.
function percentile(value: number, values: number[]) {
  if (values.length === 1) return .5;
  return (values.filter(v => v < value).length + (values.filter(v => v === value).length - 1) / 2) / (values.length - 1);
}
export function rankWatchPlayers<T extends WatchPlayer>(data: {season: number; week: number; games: Record<string, WatchMatchup<T>>}, report: WatchReport | null, mode: 'blend' | 'form') {
  const matches = report?.season === data.season && report.week === data.week;
  const all = Object.entries(data.games).flatMap(([id, game]) => {
    const projections = matches ? report.games[id]?.players ?? [] : [];
    return (['away', 'home'] as const).flatMap(side => game[`${side}_players`].map(player => {
      const opponent = game[side === 'away' ? 'home_team' : 'away_team'];
      const p = projections.find(p => p.player_id === player.player_id && p.team === player.team && p.opponent === opponent && p.position === player.position);
      const valid = p?.status === 'available' && p.stat === kinds[player.position] && Number.isFinite(p.expected_yards)
        && p.expected_yards! >= 0 && p.range_80?.length === 2 && p.range_80.every(Number.isFinite) && p.range_80[0] <= p.range_80[1];
      return { ...player, opponent, isHome: side === 'home', projection: valid ? p : undefined };
    }));
  });
  const unique: RankedPlayer<T>[] = Array.from(new Map(all.map(p => [p.player_id, p])).values());
  const eligible = unique.filter(p => p.projection && Number.isFinite(p.recent_average) && Number.isFinite(p.season_average));
  const blended = mode === 'blend' && eligible.length > 0;
  const lift = (p: T) => (p.recent_average - p.season_average) / Math.max(floors[p.position] ?? 20, p.season_average);
  const ranked = blended ? eligible.map(p => {
    const group = eligible.filter(other => other.position === p.position);
    return { ...p, watchScore: 50 * percentile(p.projection!.expected_yards!, group.map(o => o.projection!.expected_yards!)) + 50 * percentile(lift(p), group.map(lift)) };
  }).sort((a,b) => b.watchScore - a.watchScore || a.player_id.localeCompare(b.player_id))
    : unique.filter(p => p.trend_pct !== null && Number.isFinite(p.trend_pct) && p.trend_pct > 0)
      .sort((a,b) => b.trend_pct! - a.trend_pct! || a.player_id.localeCompare(b.player_id));
  return { players: ranked.slice(0,10), blended, eligible: eligible.length, total: unique.length };
}

export function watchTouchdown(position: string, projection?: WatchProjection) {
  const probability = position === 'QB' ? projection?.passing_td_probability : projection?.anytime_td_probability;
  return {label: position === 'QB' ? '1+ passing TD' : '1+ rush/receiving TD',
    probability: typeof probability === 'number' && Number.isFinite(probability) && probability >= 0 && probability <= 1 ? probability : null};
}
