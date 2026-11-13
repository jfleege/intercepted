import { TEAM_COLORS } from './teams';

/** The wheel and team charts share the same lifted jersey colors. */
export function teamPalette(team: string) {
  const primary = TEAM_COLORS[team] ?? '#80d5ff';
  const [red, green, blue] = [1, 3, 5].map(start => parseInt(primary.slice(start, start + 2), 16));
  const brightness = red * .299 + green * .587 + blue * .114;
  const strength = brightness < 60 ? 55 : brightness < 100 ? 68 : 92;
  return { highlight: `color-mix(in oklab, ${primary} ${strength - 25}%, white)`, shade: `color-mix(in oklab, ${primary} ${strength}%, white)` };
}
export function teamStyle(team: string) {
  const p = teamPalette(team);
  return { '--team-highlight': p.highlight, '--team-shade': p.shade };
}
