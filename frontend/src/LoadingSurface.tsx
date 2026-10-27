export default function LoadingSurface({label,kind='cards'}: {label: string; kind?: 'cards'|'directory'|'matchups'}) {
  return <div className={`loading-surface loading-${kind}`} role="status" aria-label={label}>
    <span className="sr-only">{label}</span>
    <div className="loading-filter" aria-hidden="true"/>
    <div className="loading-grid" aria-hidden="true">{[0,1,2,3].map(i=><div className="loading-card" key={i}><i/><i/><i/><span/></div>)}</div>
  </div>;
}
