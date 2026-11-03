import { useAnimatedNumber } from './useAnimatedNumber';

export default function AnimatedNumber({ value, decimals = 0, suffix = '' }: {
  value: number | null; decimals?: number; suffix?: string;
}) {
  const display = useAnimatedNumber(value);
  const format = (n: number | null) => n === null || !Number.isFinite(n) ? '—' : `${n.toFixed(decimals)}${suffix}`;
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>
    <span aria-hidden="true">{format(display)}</span><span className="sr-only">{format(value)}</span>
  </span>;
}
