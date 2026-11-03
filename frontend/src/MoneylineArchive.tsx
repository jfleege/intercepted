import { fetchSnapshot } from "./snapshotCache";
import { MODEL_LABELS, MODEL_ORDER } from "./predictionModels";
import { useEffect, useState } from "react";
import "./ReviewPages.css";
import "./MarketsPage.css";
import MatchupResearch from "./MatchupResearch";
import { PAPER_STORAGE_KEY, appendBrowserSelection, freshQuote, gradeBrowserSelection, makeBrowserSelection, parseBrowserLedger } from "./marketResearch";
import type { BrowserSelection, GameResult, Line, Model } from "./marketResearch";

type Selection = {selection_id:string;game_id:string;team:string;model:Model;kind:string;stake:number;price:number;bookmaker:string;recorded_at:string;grade:string;profit:number|null};
type Summary = {selections:number;settled:number;wins:number;losses:number;pushes:number;voids:number;profit:number;roi:number|null};
type Data = {active_game_ids?:string[];generated_at:string;snapshot_count:number;lines:Line[];selections:Selection[];summary:Record<Model,Summary>;results:Record<string,GameResult>};
const pct = (n:number) => `${(n*100).toFixed(1)}%`;
const price = (n:number) => n > 0 ? `+${n}` : `${n}`;
const units = (n:number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}u`;
const date = (s:string) => new Date(s).toLocaleString();

export default function MarketsPage() {
  const [data,setData] = useState<Data|null>(null);
  const [error,setError] = useState(false);
  const [model,setModel] = useState<Model>("v5_qb_plus");
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
      return "Saved in this browser. Find it under Saved paper records → Browser selections.";
    } catch(error) {return error instanceof Error ? error.message : "Could not save; browser storage may be unavailable.";}
  }
  function exportPaper() {
    const payload={schema_version:1,source:"unverified browser paper ledger",exported_at:new Date().toISOString(),records:browser.records};
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}));
    const link=document.createElement("a");link.href=url;link.download="intercepted-browser-paper.json";link.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  useEffect(() => {const controller = new AbortController();fetchSnapshot(`${import.meta.env.BASE_URL}markets.json`,{signal:controller.signal,cache:"no-cache"}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(setData).catch(e=>{if(e.name!=="AbortError")setError(true);});return ()=>controller.abort();},[]);
  const selections = data?.selections.filter(s=>s.model===model&&s.kind===kind) ?? [];
  const summary = data?.summary[model];
  const browserRows=browser.records.filter(r=>r.model===model).map(r=>({...r,...gradeBrowserSelection(r,data?.results?.[r.game_id])}));
  const displayed=kind==="browser" ? browserRows : selections;
  const localProfit=browserRows.reduce((sum,r)=>sum+(r.profit??0),0);
  const localRisk=browserRows.reduce((sum,r)=>sum+(["win","loss"].includes(r.grade)?r.stake:0),0);
  const lines=data?.lines.filter(l=>!data.active_game_ids||data.active_game_ids.includes(l.game_id))??[];
  const activeLine=data?.lines.find(l=>l.game_id===selected);
  return <div className="review-page markets-page">
    <header className="review-heading"><div><p className="eyebrow">GAME LINES</p><h1>Markets</h1><p>Moneylines for the current slate. Select a matchup to explore it.</p></div></header>
    <div className="review-controls"><p className="moneyline-feed-note">DraftKings · daily snapshots</p><label>Research model <select value={model} onChange={e=>setModel(e.target.value as Model)}>{MODEL_ORDER.map(m => <option key={m} value={m}>{MODEL_LABELS[m]}</option>)}</select></label></div>
    {error ? <div className="review-empty">Markets data is unavailable. Run the refresh workflow after merging this change.</div> : !data ? <div className="review-empty">Loading saved moneylines…</div> : <>
      <section className="review-panel"><div className="review-table-wrap"><table><thead><tr>{["Matchup","Kickoff","Away moneyline","Home moneyline","Status"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>
      {lines.map(line=><tr key={line.game_id}>
        <td><button type="button" className="market-matchup-button" onClick={()=>setSelected(line.game_id)} aria-haspopup="dialog">{line.away_team} @ {line.home_team}<span>View matchup ↗</span></button></td>
        <td>{date(line.kickoff)}</td><td><strong>{line.away_team}</strong> {price(line.away_price)}</td><td><strong>{line.home_team}</strong> {price(line.home_price)}</td>
        <td title={`Collected ${date(line.observed_at)}; book updated ${date(line.last_update)}`}>{freshQuote(line,now)?"Pregame":"Historical / stale"}</td>
      </tr>)}
      {!lines.length&&<tr><td colSpan={5}>Moneylines will appear after a fresh odds snapshot is available.</td></tr>}
      </tbody></table></div></section>
      <p className="moneyline-feed-note">Updated {date(data.generated_at)}. Prices are saved snapshots.</p>
      {activeLine&&<MatchupResearch key={`${activeLine.game_id}:${model}`} line={activeLine} model={model} now={now} records={browser.records} onClose={()=>setSelected(null)} onSave={savePaper}/>}
      <details className="review-method market-saved-records"><summary>Saved paper records</summary>
        <p>Research records only. Browser selections stay on this device; repository records are saved through the refresh workflow. These are separate from real wagers.</p>
        <label>Record <select value={kind} onChange={e=>setKind(e.target.value)}><option value="baseline">Model baseline</option><option value="manual">Repository custom selections</option><option value="browser">Browser selections</option></select></label>
        {kind==="baseline"&&summary&&<p>{summary.wins} wins · {summary.losses} losses · {summary.pushes} pushes · {summary.voids} voids · net {units(summary.profit)} · ROI {summary.roi==null?"—":pct(summary.roi)}</p>}
        {kind==="browser"&&<div className="browser-ledger-note"><div><strong>Unverified browser paper record</strong><p>{browserRows.length} selections · net {units(localProfit)} · ROI {localRisk?pct(localProfit/localRisk):"—"}. Grades use published final scores. Export all models before clearing browser data.</p></div><button type="button" onClick={exportPaper} disabled={!browser.records.length}>Export paper JSON</button></div>}
        {browser.error&&<p role="alert">{browser.error}</p>}
        <div className="review-table-wrap"><table><thead><tr>{["Game / recorded","Selection","Price","Stake","Grade","Profit"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{displayed.map(s=><tr key={s.selection_id}><td>{s.game_id}<small>{date(s.recorded_at)}</small></td><td>{s.team}</td><td>{price(s.price)}</td><td>{s.stake}u</td><td>{s.grade}</td><td>{s.profit==null?"—":units(s.profit)}</td></tr>)}{!displayed.length&&<tr><td colSpan={6}>No selections recorded for this model and record type.</td></tr>}</tbody></table></div>
      </details>
    </>}
  </div>;
}
