export default function LoadingSurface({label,kind='cards'}: {label: string; kind?: 'cards'|'directory'|'matchups'}) {
  return <div className={`loading-surface loading-${kind}`} role="status" aria-label={label} aria-busy="true">
    <span className="sr-only">{label}</span>
    {kind === 'matchups' ? <div className="loading-matchup-grid" aria-hidden="true">
      <div className="loading-slate"><div className="loading-slate-heading"><i/><i/></div>
        {[0,1,2,3,4].map(i=><div className="loading-game" key={i}><span/><div><i/><i/></div><b/></div>)}
      </div>
      <div className="loading-focus"><i/><i/><span className="loading-wheel"/><div className="loading-qbs"><i/><i/></div><b/></div>
    </div> : <>
      <div className="loading-filter" aria-hidden="true"/>
      <div className="loading-grid" aria-hidden="true">{[0,1,2,3].map(i=><div className="loading-card" key={i}><i/><i/><i/><span/></div>)}</div>
    </>}
  </div>;
}
