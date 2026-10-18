import { useEffect, useRef, useState } from "react";
import { candidates, freshQuote, DEFAULT_MIN_RETURN } from "./marketResearch";
import type { Line, Model, BrowserSelection } from "./marketResearch";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const signed = (n: number) => `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
const price = (n: number) => `${n > 0 ? "+" : ""}${n}`;

export default function MatchupResearch({ line, model, now, records, onClose, onSave }: {
  line: Line; model: Model; now: number; records: BrowserSelection[];
  onClose: () => void; onSave: (team: string, stake: number, threshold: number) => string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [threshold, setThreshold] = useState(String(DEFAULT_MIN_RETURN * 100));
  const [stake, setStake] = useState("1");
  const [message, setMessage] = useState("");
  useEffect(() => {const el=dialog.current; el?.showModal(); return () => el?.close();}, []);
  const minimum = Number(threshold) / 100;
  const validThreshold = threshold.trim() !== "" && Number.isFinite(minimum) && minimum >= 0 && minimum <= 1;
  const options = candidates(line, model, validThreshold ? minimum : DEFAULT_MIN_RETURN, now);
  const qualifying = validThreshold ? options.filter(c=>c.qualifies) : [];
  const fresh = freshQuote(line, now);
  return <dialog ref={dialog} className="moneyline-dialog" aria-labelledby="moneyline-title" onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="moneyline-dialog-content"><header><div><p className="eyebrow">MONEYLINE RESEARCH · {model === "v4_a" ? "V4-A" : "V4-QB+"}</p><h2 id="moneyline-title">{line.away_team} @ {line.home_team}</h2><p>Kickoff {new Date(line.kickoff).toLocaleString()} · {line.bookmaker}</p></div><button type="button" className="research-close" onClick={onClose} aria-label="Close matchup research">×</button></header>
    <div className={`research-verdict ${qualifying.length ? "research-positive" : ""}`}><strong>{!validThreshold ? "Enter a threshold from 0% to 100%" : !fresh ? "Historical quote — no qualifying selection" : qualifying.length ? `${qualifying[0].team} has the highest qualifying estimated return` : "No qualifying selection"}</strong><p>{fresh ? "Ranked by model-estimated net profit at the saved price, not by win probability alone." : "This quote is stale, unavailable for recording, or kickoff has passed. Values below are historical calculations."}</p></div>
    <div className="research-controls"><label>Minimum estimated return (%)<input type="number" min="0" max="100" step="0.5" value={threshold} onChange={e=>{setThreshold(e.target.value);setMessage("");}} /></label><label>Paper stake (units)<input type="number" min="0.01" step="0.25" value={stake} onChange={e=>setStake(e.target.value)} /></label></div>
    <div className="research-candidates">{options.map((c,index)=>{
      const saved=records.some(r=>r.game_id===line.game_id&&r.model===model&&r.team===c.team);
      return <article key={c.team}><div className="research-candidate-title"><h3>{c.team} <span>{price(c.price)}</span></h3><small>{index===0 ? "Higher estimated return" : "Other side"}</small></div><dl><div><dt>Model win probability</dt><dd>{pct(c.probability)}</dd></div><div><dt>Break-even at this price</dt><dd>{pct(c.breakEven)}</dd></div><div><dt>Market without margin</dt><dd>{pct(c.market)}</dd></div><div><dt>Estimated net return</dt><dd>{signed(c.expectedReturn)}</dd></div><div><dt>Expected profit per 1u</dt><dd>{c.expectedReturn>0?"+":""}{c.expectedReturn.toFixed(3)}u</dd></div></dl><p className="research-status">{saved ? "Saved at its original price" : !fresh ? "Not eligible: quote unavailable or historical" : c.qualifies&&validThreshold ? "Meets your research threshold" : "Below your research threshold"}</p><button type="button" disabled={saved||!c.qualifies||!validThreshold||!Number.isFinite(Number(stake))||Number(stake)<=0} onClick={()=>setMessage(onSave(c.team,Number(stake),minimum))}>{saved ? "Paper selection saved" : "Save browser paper selection"}</button></article>;
    })}</div>
    <p role="status" aria-live="polite" className="research-save-status">{message}</p>
    <details className="research-method"><summary>How to interpret this panel</summary><p>Estimated return = model probability × decimal odds − 1. Break-even probability includes the actual price you would pay; the margin-free market probability is a comparison, not the break-even threshold. The default 5% minimum is an adjustable research filter, not a validated profitability rule. Small errors in model probabilities can erase an apparent edge.</p><p>Selections save only in this browser, freeze the displayed quote and model probability, and can be exported from Saved paper records. The page does not place wagers or write to GitHub. Browser timestamps are unverified and remain separate from repository-backed performance. Use the existing Actions workflow to record a repository-backed custom selection at its then-available quote.</p><p>Collected {new Date(line.observed_at).toLocaleString()}; book updated {new Date(line.last_update).toLocaleString()}. {line.forecast_observed_at ? `Forecast updated ${new Date(line.forecast_observed_at).toLocaleString()}. ` : ""}One sportsbook is connected, so “higher return” compares these two moneylines, not all available bets. Player props and parlays are not modeled here.</p></details></div>
  </dialog>;
}
