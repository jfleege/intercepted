export type PossessionCompetition = {
  situation?: { possession?: string | number | null };
  competitors: { id?: string; homeAway: string; team: { id?: string; abbreviation: string } }[];
};
// Use the provider's explicit possession ID, never the last play or field position.
export function possessionSide(competition: PossessionCompetition | undefined, state: string | undefined, completed: boolean | undefined, failed: boolean): 'home' | 'away' | null {
  if (failed || completed || state !== 'in') return null;
  const id = competition?.situation?.possession;
  if (id == null || String(id).trim() === '') return null;
  const matches = competition!.competitors.filter(c => String(c.team.id ?? c.id ?? '') === String(id));
  if (matches.length !== 1) return null;
  const side = matches[0].homeAway;
  return side === 'home' || side === 'away' ? side : null;
}
