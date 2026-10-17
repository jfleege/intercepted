import { useState } from "react";
import "./ReviewPages.css";

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="review-empty"><span aria-hidden="true">◈</span><h3>{title}</h3><p>{children}</p></div>;
}

export { default as PerformancePage } from "./PerformancePage";

export function MarketsPage() {
  const [category, setCategory] = useState("Game lines");
  const [view, setView] = useState("Upcoming");
  return <div className="review-page">
    <header className="review-heading"><div><p className="eyebrow">THE MARKET VIEW</p><h1>Markets</h1><p>Compare prices. Track outcomes. Investigate the difference.</p></div><span className="review-draft">LAYOUT PREVIEW</span></header>
    <div className="review-notice">Draft only: no new odds requests, prop predictions, betting recommendations, or real wagers. Existing API usage is unchanged.</div>
    <div className="review-controls"><div className="review-tabs" aria-label="Market category">{["Game lines", "Player props", "Touchdowns", "Defense"].map(value => <button type="button" key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</button>)}</div><label>Show <select value={view} onChange={e => setView(e.target.value)}><option>Upcoming</option><option>Settled</option></select></label></div>
    <div className="review-metrics">{[["Lines tracked", "Saved sportsbook snapshots"], ["Books compared", "Same market, line, and timestamp"], ["Selections graded", "Win · loss · push · void"], ["Paper return", "Requires recorded prices and stakes"]].map(([title, note]) => <div className="review-metric" key={title}><span>{title}</span><strong>—</strong><small>{note}</small></div>)}</div>
    <div className="review-market-layout"><section className="review-panel"><div className="review-panel-heading"><div><h2>{category}</h2><p>{view === "Upcoming" ? "Compare available lines and prices before kickoff." : "Grade recorded selections using actual player and team results."}</p></div><span className="review-pill">{view.toUpperCase()}</span></div><div className="review-table-wrap"><table><thead><tr>{["Selection / market", "Line", "Book / price", "Model probability", "Actual / grade", "Watchlist"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody><tr><td colSpan={6}><Empty title={view === "Settled" ? "No settled selections yet" : "Market comparison goes here"}>{category === "Game lines" ? "Start with moneylines, where the current model estimates win probability. Spreads and totals need their own probabilities." : `${category} need saved market lines, actual statistics, and a dedicated probability model before value can be estimated.`}</Empty></td></tr></tbody></table></div><p className="review-panel-note">A winning result in hindsight does not establish positive expected value. Preserve prices and lines as they were available at the forecast time.</p></section>
    <aside className="review-panel"><div className="review-panel-heading"><h2>Research watchlist</h2><span>Paper only</span></div><Empty title="Build a shortlist">Save selections from the comparison table once the market feed is connected.</Empty><div className="review-slip"><h3>Parlay workspace</h3><p>Explore combinations later, with explicit treatment of correlated outcomes. Combined probability and expected value remain unavailable until supported.</p><button type="button" disabled>Add selections to begin</button></div></aside></div>
    <details className="review-method"><summary>Planned grading and comparison rules</summary><p>Store sportsbook, line, price, timestamp, and market identifier. Grade exact over/under lines, pushes, voids, participation rules, and stat corrections according to the book's settlement rules. Compare identical selections across books. Rank potential value only when a validated market-specific model exists; keep paper performance separate from actual betting.</p></details>
  </div>;
}
