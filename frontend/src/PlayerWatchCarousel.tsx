import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import './PlayerWatchCarousel.css';

type Slide = { id: string; name: string; content: ReactNode };
type Drag = { pointerId: number; x: number; y: number; lastX: number; spacing: number; moving: boolean; reducedMotion: boolean };

export default function PlayerWatchCarousel({ slides }: { slides: Slide[] }) {
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClickUntil = useRef(0);
  const wheel = useRef({ total: 0, lastEvent: 0, lastStep: -Infinity });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const descriptionId = useId();
  const activeIndex = Math.max(0, slides.findIndex(slide => slide.id === selectedId));
  const count = slides.length;

  const move = useCallback((direction: number) => {
    if (count < 2) return;
    const index = (activeIndex + direction + count) % count;
    setSelectedId(slides[index].id);
    setDragOffset(0);
  }, [activeIndex, count, slides]);

  useEffect(() => {
    const element = stage.current;
    if (!element || count < 2) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      // Vertical scrolling continues down the page until the carousel has keyboard focus.
      if (!horizontal && !event.shiftKey && !element.contains(document.activeElement)) return;
      const delta = horizontal ? event.deltaX : event.deltaY;
      if (!delta) return;
      event.preventDefault();
      const now = performance.now();
      const state = wheel.current;
      if (now - state.lastEvent > 180) state.total = 0;
      state.lastEvent = now;
      if (now - state.lastStep < 340) return;
      state.total += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1);
      if (Math.abs(state.total) >= 35) {
        move(Math.sign(state.total));
        state.total = 0;
        state.lastStep = now;
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [count, move]);

  const finishDrag = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (current.moving) suppressClickUntil.current = performance.now() + 250;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const delta = current.lastX - current.x;
    if (!cancelled && current.moving && Math.abs(delta) >= 35) move(delta < 0 ? 1 : -1);
    setDragOffset(0);
  };

  if (!count) return null;

  return <div className="dp-player-wheel">
    <div ref={stage} className={`dp-carousel-stage${dragOffset ? ' is-dragging' : ''}`}
      role="region" aria-roledescription="carousel" aria-label="Players to Watch" aria-describedby={descriptionId} tabIndex={0}
      onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        if (event.key === 'Home' || event.key === 'End') {
          setSelectedId(slides[event.key === 'Home' ? 0 : count - 1].id);
          setDragOffset(0);
        } else move(event.key === 'ArrowRight' ? 1 : -1);
      }}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary || count < 2) return;
        drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX,
          spacing: Math.min(230, event.currentTarget.clientWidth * .23), moving: false,
          reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches };
      }}
      onPointerMove={event => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        if (event.pointerType === 'mouse' && !event.buttons) { finishDrag(event, true); return; }
        const delta = event.clientX - current.x;
        if (!current.moving) {
          if (Math.abs(delta) < 6) return;
          if (Math.abs(event.clientY - current.y) > Math.abs(delta)) { drag.current = null; return; }
          current.moving = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.focus({ preventScroll: true });
        }
        current.lastX = event.clientX;
        if (!current.reducedMotion) setDragOffset(Math.max(-1, Math.min(1, delta / current.spacing)));
      }}
      onPointerUp={event => finishDrag(event)} onPointerCancel={event => finishDrag(event, true)}
      onLostPointerCapture={event => finishDrag(event, true)}>
      {slides.map((slide, index) => {
        const distance = ((index - activeIndex + count + Math.floor(count / 2)) % count) - Math.floor(count / 2);
        const position = distance + dragOffset;
        const depth = Math.abs(position);
        const active = index === activeIndex;
        const hidden = Math.abs(distance) > 2;
        const style = {
          '--dp-wheel-position': position,
          transform: `translateX(calc(var(--dp-wheel-position) * var(--dp-wheel-spacing))) translateY(${depth * 10}px) translateZ(${-depth * 55}px) rotateY(${-position * 10}deg) scale(${Math.max(.45, 1 - depth * .13)})`,
          opacity: Math.max(0, depth <= 1 ? 1 - depth * .38 : .62 - (depth - 1) * .32),
          zIndex: Math.round(100 - depth * 20),
        } as CSSProperties;
        return <div key={slide.id} className={`dp-carousel-slide${active ? ' is-active' : ''}`} style={style}
          data-carousel-index={index} data-active={active} role="group" aria-roledescription="slide"
          aria-label={`${index + 1} of ${count}: ${slide.name}`} aria-hidden={hidden} inert={hidden}>
          <div className="dp-carousel-card" aria-hidden={!active}>{slide.content}</div>
          {!active && !hidden && <button type="button" className="dp-carousel-select" aria-label={`Show ${slide.name}`}
            onClick={() => {
              if (performance.now() < suppressClickUntil.current) return;
              stage.current?.focus({ preventScroll: true });
              setSelectedId(slide.id);
              setDragOffset(0);
            }} />}
        </div>;
      })}
    </div>
    <div className="dp-carousel-navigation" role="group" aria-label="Player carousel controls">
      <button type="button" className="dp-scroll-button" onClick={() => move(-1)} disabled={count < 2} aria-label="Scroll players left">‹</button>
      <div className="dp-carousel-dots">{slides.map((slide, index) => <button type="button" key={slide.id}
        className="dp-carousel-dot" aria-label={`Show player ${index + 1}, ${slide.name}`} aria-pressed={index === activeIndex}
        onClick={() => { setSelectedId(slide.id); setDragOffset(0); }} />)}</div>
      <button type="button" className="dp-scroll-button" onClick={() => move(1)} disabled={count < 2} aria-label="Scroll players right">›</button>
    </div>
    <p className="dp-carousel-position" role="status" aria-live="polite" aria-atomic="true">{activeIndex + 1} / {count} · {slides[activeIndex].name}</p>
    <p id={descriptionId} className="sr-only">Drag or swipe left and right, scroll horizontally, or use the arrow buttons. When focused, use the arrow keys or mouse wheel. Home and End select the first and last players.</p>
  </div>;
}
