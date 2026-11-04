type IconName = 'dashboard' | 'matchups' | 'performance' | 'players' | 'markets' | 'right' | 'external';

export default function InterfaceIcon({ name }: { name: IconName }) {
  const helmet = <><path d="M2 12a8 8 0 0 1 16 0l-6 2v5H8l-2-3H3z"/><path d="M12 14h8v6h-8m4-6v6m-4-3h8"/><circle cx="8" cy="12" r="1"/></>;
  return <svg viewBox={name === 'matchups' ? '0 0 48 24' : '0 0 24 24'} width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
    {name === 'dashboard' && <path d="m3 10 9-8 9 8v12h-7v-8h-4v8H3z"/>}
    {name === 'matchups' && <><g>{helmet}</g><g transform="translate(48 0) scale(-1 1)">{helmet}</g></>}
    {name === 'performance' && <><path d="M3 3v18h18M6 16l5-6 4 3 6-9m-5 0h5v5"/></>}
    {name === 'players' && <><path d="M7 10V7a5 5 0 0 1 10 0v3l-2 4H9zM7 7h10M8 10h8m-4-3v7M2 22v-5l6-2 4 4 4-4 6 2v5M5 18l1 4m13-4-1 4"/></>}
    {name === 'markets' && <><circle cx="12" cy="12" r="10"/><path d="M16 7c-1-2-8-2-8 2s8 2 8 6-7 4-9 1m5-13v18"/></>}
    {name === 'right' && <path d="M3 12h18m-7-7 7 7-7 7"/>}
    {name === 'external' && <path d="m4 20 16-16M9 4h11v11"/>}
  </svg>;
}
