export type Model = "v4_a" | "v4_qb_plus";
export type Line = {
  game_id: string; home_team: string; away_team: string; kickoff: string;
  bookmaker: string; home_price: number; away_price: number;
  home_market_probability: number; away_market_probability: number;
  probabilities: Record<Model, number>; observed_at: string; last_update: string;
  forecast_observed_at?: string; can_record: boolean; odds_snapshot_id: string; forecast_snapshot_id: string;
};
export type GameResult = {
  home_team: string; away_team: string; status: string;
  home_score: number | null; away_score: number | null;
};
export type Grade = "pending" | "win" | "loss" | "push" | "void";
export type BrowserSelection = {
  selection_id: string; kind: "browser"; game_id: string; team: string;
  home_team: string; away_team: string; model: Model; stake: number; price: number;
  bookmaker: string; recorded_at: string; kickoff: string;
  model_probability: number; market_probability: number; expected_return: number;
  qualification_threshold: number; odds_snapshot_id: string; forecast_snapshot_id: string;
};
export type Candidate = {
  team: string; price: number; probability: number; market: number;
  breakEven: number; expectedReturn: number; qualifies: boolean;
};
export const PAPER_STORAGE_KEY = "intercepted.moneyline-paper.v1";
export const DEFAULT_MIN_RETURN = 0.05;
const DAY = 86_400_000;

export function decimalOdds(price: number): number {
  if (!Number.isFinite(price) || Math.abs(price) < 100) throw Error("Invalid American price");
  return 1 + (price > 0 ? price / 100 : 100 / Math.abs(price));
}

export function expectedReturn(probability: number, price: number): number {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw Error("Invalid probability");
  return probability * decimalOdds(price) - 1;
}

export function freshQuote(line: Line, now: number): boolean {
  const observed = Date.parse(line.observed_at), updated = Date.parse(line.last_update), kickoff = Date.parse(line.kickoff);
  return line.can_record && [now, observed, updated, kickoff].every(Number.isFinite)
    && updated <= observed && observed <= now && now < kickoff
    && now - observed <= DAY && now - updated <= DAY;
}

export function candidates(line: Line, model: Model, threshold: number, now: number): Candidate[] {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw Error("Invalid qualification threshold");
  return [true, false].map(home => {
    const probability = home ? line.probabilities[model] : 1 - line.probabilities[model];
    const price = home ? line.home_price : line.away_price;
    const ev = expectedReturn(probability, price);
    return {team: home ? line.home_team : line.away_team, price, probability,
      market: home ? line.home_market_probability : line.away_market_probability,
      breakEven: 1 / decimalOdds(price), expectedReturn: ev,
      qualifies: freshQuote(line, now) && ev > 0 && ev + 1e-12 >= threshold};
  }).sort((a, b) => b.expectedReturn - a.expectedReturn);
}

export function makeBrowserSelection(line: Line, model: Model, team: string, stake: number, threshold: number, now: number): BrowserSelection {
  if (!Number.isFinite(stake) || stake <= 0) throw Error("Enter a positive stake in paper units.");
  if (!line.odds_snapshot_id || !line.forecast_snapshot_id) throw Error("Snapshot evidence is missing.");
  const candidate = candidates(line, model, threshold, now).find(c => c.team === team);
  if (!candidate?.qualifies) throw Error("This quote is stale, kickoff has passed, or the selection does not meet your threshold.");
  return {
    selection_id: ["browser", line.game_id, model, team].join(":"), kind: "browser", game_id: line.game_id,
    team, home_team: line.home_team, away_team: line.away_team, model, stake, price: candidate.price,
    bookmaker: line.bookmaker, recorded_at: new Date(now).toISOString(), kickoff: line.kickoff,
    model_probability: candidate.probability, market_probability: candidate.market,
    expected_return: candidate.expectedReturn, qualification_threshold: threshold,
    odds_snapshot_id: line.odds_snapshot_id, forecast_snapshot_id: line.forecast_snapshot_id,
  };
}

export function gradeBrowserSelection(record: BrowserSelection, result?: GameResult): {grade: Grade; profit: number | null} {
  if (!result || result.home_team !== record.home_team || result.away_team !== record.away_team) return {grade: "pending", profit: null};
  if (result.status === "cancelled") return {grade: "void", profit: 0};
  if (result.status !== "final" || result.home_score === null || result.away_score === null
    || !Number.isFinite(result.home_score) || !Number.isFinite(result.away_score)) return {grade: "pending", profit: null};
  if (result.home_score === result.away_score) return {grade: "push", profit: 0};
  const won = record.team === (result.home_score > result.away_score ? result.home_team : result.away_team);
  return {grade: won ? "win" : "loss", profit: won ? record.stake * (decimalOdds(record.price) - 1) : -record.stake};
}

export function parseBrowserLedger(raw: string | null): BrowserSelection[] {
  if (raw === null) return [];
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows)) throw Error("Browser paper ledger is unreadable; existing storage was preserved.");
  const records = rows as BrowserSelection[];
  const valid = records.every(r => {
    if (!r || typeof r !== "object") return false;
    const textFields: (keyof BrowserSelection)[] = ["selection_id", "game_id", "home_team", "away_team", "team", "bookmaker", "odds_snapshot_id", "forecast_snapshot_id"];
    if (!textFields.every(k => typeof r[k] === "string" && Boolean(r[k]))) return false;
    if (r.kind !== "browser" || !["v4_a", "v4_qb_plus"].includes(r.model) || ![r.home_team,r.away_team].includes(r.team)) return false;
    const nums = [r.stake, r.price, r.model_probability, r.market_probability, r.expected_return, r.qualification_threshold];
    if (!nums.every(n => typeof n === "number" && Number.isFinite(n)) || r.stake <= 0 || Math.abs(r.price) < 100) return false;
    if (![r.model_probability,r.market_probability,r.qualification_threshold].every(p => p >= 0 && p <= 1)) return false;
    return Number.isFinite(Date.parse(r.recorded_at)) && Date.parse(r.recorded_at) < Date.parse(r.kickoff)
      && Math.abs(expectedReturn(r.model_probability,r.price)-r.expected_return) < 1e-10;
  });
  if (!valid || new Set(records.map(r=>r.selection_id)).size !== records.length) throw Error("Browser paper ledger is unreadable; existing storage was preserved.");
  return records;
}

export function appendBrowserSelection(records: BrowserSelection[], record: BrowserSelection): BrowserSelection[] {
  if (records.some(r=>r.selection_id === record.selection_id)) throw Error("This team/model already has a browser paper selection for this game. Its original price is retained.");
  return [...records,record];
}
