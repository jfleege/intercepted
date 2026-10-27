import { Suspense, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import LoadingSurface from './LoadingSurface';
import SectionBoundary from './SectionBoundary';
import { PageActivity } from './pageActivity';

export default function PagePanel({active, name, children}: {active: boolean; name: string; children: ReactNode}) {
  const scroll = useRef(0);
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!active) return;
    const restore = () => window.scrollTo({top: scroll.current, behavior: 'instant'});
    restore();
    // Preserve position while images/data settle after a first visit.
    const frame = requestAnimationFrame(restore);
    const remember = () => {scroll.current = window.scrollY;};
    window.addEventListener('scroll', remember, {passive: true});
    return () => {cancelAnimationFrame(frame); window.removeEventListener('scroll', remember);};
  }, [active]);
  return <PageActivity value={active}><div ref={panel} className="page-panel" hidden={!active} data-page={name}><SectionBoundary><Suspense fallback={<LoadingSurface label={`Loading ${name}`}/>}>{children}</Suspense></SectionBoundary></div></PageActivity>;
}
