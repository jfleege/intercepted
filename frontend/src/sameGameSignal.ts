export function sameGameSignal(lower?: number) {
  if (lower == null || !Number.isFinite(lower) || lower < 0 || lower > 1) {
    return {color: 'red', label: 'No qualifying same-game combo'};
  }
  if (lower >= .8) return {color: 'green', label: 'Higher two-leg model likelihood'};
  if (lower >= .7) return {color: 'amber', label: 'Moderate two-leg model likelihood'};
  return {color: 'red', label: 'Lower two-leg model likelihood'};
}
