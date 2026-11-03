import { useEffect, useRef, useState } from 'react';

/** Display-only interpolation; callers keep the true value for decisions and labels. */
export function useAnimatedNumber(value: number | null, initial = 0) {
  const [display, setDisplay] = useState(initial);
  const current = useRef(initial);
  const loaded = useRef(false);
  useEffect(() => {
    if (value === null || !Number.isFinite(value)) {
      loaded.current = false;
      current.current = initial;
      return;
    }
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const from = loaded.current ? current.current : initial;
    const duration = loaded.current ? 450 : 800;
    loaded.current = true;
    let frame = 0;
    const started = performance.now();
    const finish = () => { cancelAnimationFrame(frame); current.current = value; setDisplay(value); };
    const tick = (now: number) => {
      const progress = motion.matches ? 1 : Math.min(1, (now - started) / duration);
      const next = from + (value - from) * (1 - (1 - progress) ** 3);
      current.current = next;
      setDisplay(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    const preference = () => { if (motion.matches) finish(); };
    const visibility = () => { if (document.hidden) finish(); };
    motion.addEventListener('change', preference);
    document.addEventListener('visibilitychange', visibility);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      motion.removeEventListener('change', preference);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [value, initial]);
  return value === null || !Number.isFinite(value) ? null : display;
}
