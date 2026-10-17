import { useEffect, useState } from "react";
import "./ReviewPages.css";
import "./MarketsPage.css";

type Model = "v4_a" | "v4_qb_plus";
type Line = {game_id:string;home_team:string;away_team:string;kickoff:string;bookmaker:string;home_price:number;away_price:number;home_market_probability:number;away_market_probability:number;probabilities:Record<Model,number>;observed_at:string;last_update:string;can_record:boolean};
type Selection = {selection_id:string;game_id:string;team:string;model:Model;kind:string;stake:number;price:number;bookmaker:string;recorded_at:string;grade:string;profit:number|null};
type Summary = {selections:number;settled:number;wins:number;losses:number;pushes:number;voids:number;profit:number;roi:number|null};
type Data = {generated_at:string;snapshot_count:number;lines:Line[];selections:Selection[];summary:Record<Model,Summary>};
const pct = (n:number) => `${(n*100).toFixed(1)}%`;
const price = (n:number) => n > 0 ? `+${n}` : `${n}`;
const units = (n:number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}u`;
const date = (s:string) => new Date(s).toLocaleString();

export default function MarketsPage() {
  const [data,setData] = useState<Data|null>(null);
  const [error,setError] = useState(false);
  const [model,setModel] = useState<Model>("v4_qb_plus");
  const [view,setView] = useState("Moneylines");
  const [kind,setKind] = useState("baseline");
  useEffect(() => {const controller = new AbortController();fetch(`${import.meta.env.BASE_URL}markets.json`,{signal:controller.signal,cache:"no-cache"}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(setData).catch(e=>{if(e.name!=="AbortError")setError(true);});return ()=>controller.abort();},[]);
  const selections = data?.selections.filter(s=>s.model===model&&s.kind===kind) ?? [];
  const summary = data?.summary[model];
  return <div className="review-page markets-page">
    <header className="review-heading"><div><p className="eyebrow">THE MARKET VIEW</p><h1>Markets</h1><p>Saved moneylines, model comparisons, and a paper record.</p></div><span className="review-draft">PAPER ONLY</span></header>
    <div className="review-notice">One sportsbook: DraftKings. Market probability removes the two-way margin. Baseline: one paper unit on each model’s predicted winner at the first eligible fresh quote. No wagers are placed.</div>
    <div className="review-controls"><div className="review-tabs">{["Moneylines","Paper ledger"].map(v=><button type="button" key={v} aria-pressed={view===v} onClick={()=>setView(v)}>{v}</button>)}</div><label>Model <select value={model} onChange={e=>setModel(e.target.value as Model)}><option value="v4_qb_plus">V4-QB+</option><option value="v4_a">V4-A</option></select></label></div>
    <div className="review-metrics">{[["Odds snapshots",data?.snapshot_count ?? "—","Timestamped and retained"],["Baseline settled",summary?.settled ?? "—",summary ? `${summary.wins} wins · ${summary.losses} losses · ${summary.pushes} pushes · ${summary.voids} voids` : "Awaiting data"],["Baseline profit",summary ? units(summary.profit) : "—","One unit per selection"],["Baseline ROI",summary?.roi!=null ? pct(summary.roi) : "—","Profit / settled win-loss stakes"]].map(([title,value,note])=><div className="review-metric" key={title}><span>{title}</span><strong>{value}</strong><small>{note}</small></div>)}</div>
    {error ? <div className="review-empty">Markets data is unavailable. Run the refresh workflow after merging this change.</div> : !data ? <div className="review-empty">Loading saved markets…</div> : <>
    <section className="review-panel"><div className="review-panel-heading"><div><h2>{view}</h2><p>Updated {date(data.generated_at)}. Prices are snapshots, not a live execution feed.</p></div>{view==="Paper ledger"&&<label>Record <select value={kind} onChange={e=>setKind(e.target.value)}><option value="baseline">Model baseline</option><option value="manual">Custom selections</option></select></label>}</div>
    <div className="review-table-wrap"><table>{view==="Moneylines" ? <><thead><tr>{["Matchup / collection time","Team","Price / book","Model","Market","Difference","Quote status"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{data.lines.flatMap(line=>["home","away"].map(side=>{
      const home=side==="home", p=home?line.probabilities[model]:1-line.probabilities[model], market=home?line.home_market_probability:line.away_market_probability;
      const fresh=line.can_record&&Date.now()<new Date(line.kickoff).getTime()&&Date.now()-new Date(line.last_update).getTime()<=86400000&&Date.now()-new Date(line.observed_at).getTime()<=86400000;
      return <tr key={`${line.game_id}-${side}`}><td><strong>{line.away_team} @ {line.home_team}</strong><small>{date(line.observed_at)}</small></td><td>{home?line.home_team:line.away_team}</td><td>{price(home?line.home_price:line.away_price)}<small>{line.bookmaker}</small></td><td>{pct(p)}</td><td>{pct(market)}</td><td>{((p-market)*100).toFixed(1)} pp</td><td>{fresh?"Pregame snapshot":"Historical / stale"}<small>Kickoff {date(line.kickoff)}</small></td></tr>;
    }))}{!data.lines.length&&<tr><td colSpan={7}>No eligible moneyline comparisons yet. The next fresh daily quote will populate this table. Old prices do not create retrospective selections.</td></tr>}</tbody></> : <><thead><tr>{["Game / recorded","Selection","Price / book","Stake","Grade","Profit"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{selections.map(s=><tr key={s.selection_id}><td>{s.game_id}<small>{date(s.recorded_at)}</small></td><td>{s.team}</td><td>{price(s.price)}<small>{s.bookmaker}</small></td><td>{s.stake}u</td><td>{s.grade}</td><td>{s.profit==null?"—":units(s.profit)}</td></tr>)}{!selections.length&&<tr><td colSpan={6}>No {kind==="baseline"?"baseline":"custom"} selections recorded for this model.</td></tr>}</tbody></>}</table></div></section>
    <details className="review-method"><summary>Record a custom selection and understand grading</summary><p>In GitHub Actions → Refresh data and deploy Pages → Run workflow, enter the game ID, team abbreviation, model, and paper stake. Leave “Refresh odds” unchecked to use the existing quote. A quote must be under 24 hours old, collected before kickoff, and matched to a saved pregame forecast. Custom selections are stored in the repository and remain separate from the model baseline.</p><p>Prices and probabilities are frozen at selection time. Final scores settle a selection as a win or loss; a tied game is a push under this two-way moneyline convention, and a cancelled game is void. Pushes and voids return the stake and contribute zero profit. ROI excludes their stakes. This is a research convention, not a reproduction of every sportsbook’s settlement rules. Corrections to final scores update grades without changing the original selection.</p><p>Player props, spreads, totals, and parlays need dedicated probability and settlement models. Probability differences alone are not a guarantee of profit.</p></details>
    </>}
  </div>;
}
