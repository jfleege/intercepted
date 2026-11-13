/** Translate a paired spread and game total into scoring totals, not predictions. */
export function marketScoreShape(total: number | null, awaySpread: number | null, homeSpread: number | null) {
  if (total === null || awaySpread === null || homeSpread === null ||
      ![total, awaySpread, homeSpread].every(Number.isFinite) || total <= 0 ||
      Math.abs(awaySpread + homeSpread) > .001 || Math.abs(homeSpread) > total) return null;
  return { away: (total + homeSpread) / 2, home: (total - homeSpread) / 2 };
}
