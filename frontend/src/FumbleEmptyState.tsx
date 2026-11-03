import { useEffect, useRef, useState } from 'react';
import { createFumbleRenderer } from './fumbleAnimation';
import './FumbleEmptyState.css';

export default function FumbleEmptyState() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [paused, setPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const draw = createFumbleRenderer(ctx);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let elapsed = motion.matches ? 4200 : 0;
    let last = 0, frame = 0, onscreen = true;
    const changeMotion = (event: MediaQueryListEvent) => setPaused(event.matches);
    const resetClock = () => { last = 0; };
    const observer = new IntersectionObserver(entries => {
      onscreen = entries[0].isIntersecting;
      last = 0;
    });
    observer.observe(canvas);
    motion.addEventListener('change', changeMotion);
    document.addEventListener('visibilitychange', resetClock);
    const tick = (now: number) => {
      if (last && !pausedRef.current && onscreen && !document.hidden) {
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
    <canvas ref={canvasRef} width={580} height={275} role="img"
      aria-label="A light-blue pixel football player runs, fumbles, falls face-first, then looks up at the loose ball." />
    <h4>Fumble!</h4>
    <p>No sportsbook odds are currently available for this matchup.</p>
    <button type="button" aria-pressed={paused} onClick={() => setPaused(value => !value)}>
      {paused ? 'Play animation' : 'Pause animation'}
    </button>
  </div>;
}
