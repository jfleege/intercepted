import { useEffect, useRef } from 'react';
import { createFumbleRenderer } from './fumbleAnimation';
import './FumbleEmptyState.css';

export default function FumbleEmptyState() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const draw = createFumbleRenderer(ctx);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let elapsed = motion.matches ? 4200 : 0;
    let last = 0, frame = 0, onscreen = true;
    let reducedMotion = motion.matches;
    const changeMotion = (event: MediaQueryListEvent) => { reducedMotion = event.matches; last = 0; };
    const resetClock = () => { last = 0; };
    const observer = new IntersectionObserver(entries => {
      onscreen = entries[0].isIntersecting;
      last = 0;
    });
    observer.observe(canvas);
    motion.addEventListener('change', changeMotion);
    document.addEventListener('visibilitychange', resetClock);
    const tick = (now: number) => {
      if (last && !reducedMotion && onscreen && !document.hidden) {
        elapsed += Math.min(80, now - last);
      }
      last = now;
      draw(elapsed);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      motion.removeEventListener('change', changeMotion);
      document.removeEventListener('visibilitychange', resetClock);
    };
  }, []);
  return <div className="market-fumble">
    <h4>Fumble!</h4>
    <canvas ref={canvasRef} width={580} height={275} role="img"
      aria-label="A light-blue pixel football player runs, fumbles, falls face-first, then looks up at the loose ball." />
    <p>No sportsbook odds are currently available for this matchup.</p>
  </div>;
}
