import { useEffect, useState } from "react";
import "./ReviewPages.css";
import "./MarketsPage.css";
import MatchupResearch from "./MatchupResearch";
import { PAPER_STORAGE_KEY, appendBrowserSelection, expectedReturn, freshQuote, gradeBrowserSelection, makeBrowserSelection, parseBrowserLedger } from "./marketResearch";
import type { BrowserSelection, GameResult, Line, Model } from "./marketResearch";

type Selection = {selection_id:string;game_id:string;team:string;model:Model;kind:string;stake:number;price:number;bookmaker:string;recorded_at:string;grade:string;profit:number|null};
type Summary = {selections:number;settled:number;wins:number;losses:number;pushes:number;voids:number;profit:number;roi:number|null};
type Data = {generated_at:string;snapshot_count:number;lines:Line[];selections:Selection[];summary:Record<Model,Summary>;results:Record<string,GameResult>};
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
  const [selected,setSelected] = useState<string|null>(null);
  const [now,setNow] = useState(()=>Date.now());
  const [browser,setBrowser] = useState<{records:BrowserSelection[];error:string}>(()=>{
    try {return {records:parseBrowserLedger(localStorage.getItem(PAPER_STORAGE_KEY)),error:""};}
    catch {return {records:[],error:"Browser storage is unavailable or unreadable. Existing storage has not been changed."};}
  });
  useEffect(()=>{
    const clock=window.setInterval(()=>setNow(Date.now()),10000);
    function sync(e:StorageEvent) {
      if(e.key!==PAPER_STORAGE_KEY&&e.key!==null)return;
      try {setBrowser({records:parseBrowserLedger(localStorage.getItem(PAPER_STORAGE_KEY)),error:""});}
      catch {setBrowser(previous=>({...previous,error:"Could not read updated browser paper storage."}));}
    }
    window.addEventListener("storage",sync);
    return ()=>{clearInterval(clock);window.removeEventListener("storage",sync);};
  },[]);
  function savePaper(team:string,stake:number,threshold:number) {
    const line=data?.lines.find(l=>l.game_id===selected);
    if(!line)return "The quote is no longer available.";
    try {
      const record=makeBrowserSelection(line,model,team,stake,threshold,Date.now());
      const updated=appendBrowserSelection(parseBrowserLedger(localStorage.getItem(PAPER_STORAGE_KEY)),record);
      localStorage.setItem(PAPER_STORAGE_KEY,JSON.stringify(updated));
      setBrowser({records:updated,error:""});
      return "Saved in this browser. Find it under Paper ledger → Browser selections.";
    } catch(error) {return error instanceof Error ? error.message : "Could not save; browser storage may be unavailable.";}
  }
  function exportPaper() {
    const payload={schema_version:1,source:"unverified browser paper ledger",exported_at:new Date().toISOString(),records:browser.records};
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}));
    const link=document.createElement("a");link.href=url;link.download="intercepted-browser-paper.json";link.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  useEffect(() => {const controller = new AbortController();fetch(`${import.meta.env.BASE_URL}markets.json`,{signal:controller.signal,cache:"no-cache"}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(setData).catch(e=>{if(e.name!=="AbortError")setError(true);});return ()=>controller.abort();},[]);
  const selections = data?.selections.filter(s=>s.model===model&&s.kind===kind) ?? [];
  const summary = data?.summary[model];
  const browserRows=browser.records.filter(r=>r.model===model).map(r=>({...r,...gradeBrowserSelection(r,data?.results?.[r.game_id])}));
  const displayed=kind==="browser" ? browserRows : selections;
  const localProfit=browserRows.reduce((sum,r)=>sum+(r.profit??0),0);
  const localRisk=browserRows.reduce((sum,r)=>sum+(["win","loss"].includes(r.grade)?r.stake:0),0);
  const activeLine=data?.lines.find(l=>l.game_id===selected);
  return <div className="review-page markets-page">
    <header className="review-heading"><div><p className="eyebrow">THE MARKET VIEW</p><h1>Markets</h1><p>Saved moneylines, model comparisons, and a paper record.</p></div><span className="review-draft">PAPER ONLY</span></header>
    <div className="review-notice">One sportsbook: DraftKings. Market probability removes the two-way margin. Baseline: one paper unit on each model’s predicted winner at the first eligible fresh quote. No wagers are placed.</div>
    <div className="review-controls"><div className="review-tabs">{["Moneylines","Paper ledger"].map(v=><button type="button" key={v} aria-pressed={view===v} onClick={()=>setView(v)}>{v}</button>)}</div><label>Model <select value={model} onChange={e=>setModel(e.target.value as Model)}><option value="v4_qb_plus">V4-QB+</option><option value="v4_a">V4-A</option></select></label></div>
    <div className="review-metrics">{[["Odds snapshots",data?.snapshot_count ?? "—","Timestamped and retained"],["Baseline settled",summary?.settled ?? "—",summary ? `${summary.wins} wins · ${summary.losses} losses · ${summary.pushes} pushes · ${summary.voids} voids` : "Awaiting data"],["Baseline profit",summary ? units(summary.profit) : "—","One unit per selection"],["Baseline ROI",summary?.roi!=null ? pct(summary.roi) : "—","Profit / settled win-loss stakes"]].map(([title,value,note])=><div className="review-metric" key={title}><span>{title}</span><strong>{value}</strong><small>{note}</small></div>)}</div>
    {error ? <div className="review-empty">Markets data is unavailable. Run the refresh workflow after merging this change.</div> : !data ? <div className="review-empty">Loading saved markets…</div> : <>
    <section className="review-panel"><div className="review-panel-heading"><div><h2>{view}</h2><p>Updated {date(data.generated_at)}. Prices are snapshots, not a live execution feed.</p></div>{view==="Paper ledger"&&<label>Record <select value={kind} onChange={e=>setKind(e.target.value)}><option value="baseline">Model baseline</option><option value="manual">Repository custom selections</option><option value="browser">Browser selections</option></select></label>}</div>
    {view==="Paper ledger"&&kind==="browser"&&<div className="browser-ledger-note"><div><strong>Unverified browser paper record</strong><p>Stored on this device only. {browserRows.length} selections · net {units(localProfit)} · ROI {localRisk?pct(localProfit/localRisk):"—"}. Grades use the latest published results. Export all models for a backup before clearing browser data.</p></div><button type="button" onClick={exportPaper} disabled={!browser.records.length}>Export paper JSON</button></div>}
    {browser.error&&<p role="alert">{browser.error}</p>}
    <div className="review-table-wrap"><table>{view==="Moneylines" ? <><thead><tr>{["Matchup / collection time","Team","Price / book","Model","Market","Difference","Est. return","Quote status"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{data.lines.flatMap(line=>["home","away"].map(side=>{
      const home=side==="home", p=home?line.probabilities[model]:1-line.probabilities[model], market=home?line.home_market_probability:line.away_market_probability;
      const fresh=freshQuote(line,now);
      return <tr key={`${line.game_id}-${side}`}><td><button type="button" className="market-matchup-button" onClick={()=>setSelected(line.game_id)} aria-haspopup="dialog">{line.away_team} @ {line.home_team}<span>View research ↗</span></button><small>{date(line.observed_at)}</small></td><td>{home?line.home_team:line.away_team}</td><td>{price(home?line.home_price:line.away_price)}<small>{line.bookmaker}</small></td><td>{pct(p)}</td><td>{pct(market)}</td><td>{((p-market)*100).toFixed(1)} pp</td><td>{pct(expectedReturn(p,home?line.home_price:line.away_price))}</td><td>{fresh?"Pregame snapshot":"Historical / stale"}<small>Kickoff {date(line.kickoff)}</small></td></tr>;
    }))}{!data.lines.length&&<tr><td colSpan={8}>No eligible moneyline comparisons yet. The next fresh daily quote will populate this table. Old prices do not create retrospective selections.</td></tr>}</tbody></> : <><thead><tr>{["Game / recorded","Selection","Price / book","Stake","Grade","Profit"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{displayed.map(s=><tr key={s.selection_id}><td>{s.game_id}<small>{date(s.recorded_at)}</small></td><td>{s.team}</td><td>{price(s.price)}<small>{s.bookmaker}</small></td><td>{s.stake}u</td><td>{s.grade}</td><td>{s.profit==null?"—":units(s.profit)}</td></tr>)}{!displayed.length&&<tr><td colSpan={6}>No {kind==="baseline"?"baseline":kind==="browser"?"browser":"repository custom"} selections recorded for this model.</td></tr>}</tbody></>}</table></div></section>
    {activeLine&&<MatchupResearch key={`${activeLine.game_id}:${model}`} line={activeLine} model={model} now={now} records={browser.records} onClose={()=>setSelected(null)} onSave={savePaper}/>}
    <details className="review-method"><summary>Record a custom selection and understand grading</summary><p>Click a matchup for price-based research and the browser paper-selection button. Browser selections are kept separately, with unverified local timestamps; they do not alter the repository baseline or custom ledger. The default 5% expected-return threshold is an adjustable research filter, not an empirically validated betting rule.</p><p>In GitHub Actions → Refresh data and deploy Pages → Run workflow, enter the game ID, team abbreviation, model, and paper stake. Leave “Refresh odds” unchecked to use the existing quote. A quote must be under 24 hours old, collected before kickoff, and matched to a saved pregame forecast. Custom selections are stored in the repository and remain separate from the model baseline.</p><p>Prices and probabilities are frozen at selection time. Final scores settle a selection as a win or loss; a tied game is a push under this two-way moneyline convention, and a cancelled game is void. Pushes and voids return the stake and contribute zero profit. ROI excludes their stakes. This is a research convention, not a reproduction of every sportsbook’s settlement rules. Corrections to final scores update grades without changing the original selection.</p><p>Player props, spreads, totals, and parlays need dedicated probability and settlement models. Probability differences alone are not a guarantee of profit.</p></details>
    </>}
  </div>;
}
