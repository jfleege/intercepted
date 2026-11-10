export const PAST_BETS_PATH = 'markets/past-bets';
export const PAST_BETS_KEY = 'intercepted.past-bets.v1';
export const LEG_RESULTS = ['Pending', 'Won', 'Lost', 'Push', 'Void'] as const;
export const BET_RESULTS = [...LEG_RESULTS, 'Cash out'] as const;
export type LegResult = typeof LEG_RESULTS[number];
export type BetResult = typeof BET_RESULTS[number];

export type PastBet = {
  id: string;
  name: string;
  date: string;
  stake: number;
  returned: number | null;
  result: BetResult;
  notes: string;
  legs: {name: string; result: LegResult}[];
};

const MAX_CENTS = 100_000_000;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseBetAmount(value: string): number | null {
  const text = value.trim();
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= MAX_CENTS ? cents : null;
}

function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_CENTS;
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function betReturn(result: BetResult, stake: number, enteredReturn: number | null): number | null {
  if (result === 'Pending') return null;
  if (result === 'Lost') return 0;
  if (result === 'Push' || result === 'Void') return stake;
  return enteredReturn;
}

function validBet(value: unknown): value is PastBet {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id ||
    typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80 ||
    !isDate(value.date) || !isAmount(value.stake) || value.stake === 0 ||
    typeof value.notes !== 'string' || value.notes.length > 1200 ||
    !BET_RESULTS.some(result => result === value.result) ||
    !Array.isArray(value.legs) || !value.legs.length) return false;

  if (value.result === 'Pending' ? value.returned !== null : !isAmount(value.returned)) return false;
  if (value.returned !== betReturn(value.result as BetResult, value.stake, value.returned as number | null)) return false;

  return value.legs.every(leg => isRecord(leg) && typeof leg.name === 'string' &&
    leg.name.trim().length > 0 && leg.name.length <= 120 && LEG_RESULTS.some(result => result === leg.result));
}

export function readPastBets(raw: string | null): PastBet[] {
  if (raw === null) return [];
  const records: unknown = JSON.parse(raw);
  if (!Array.isArray(records) || !records.every(validBet) || new Set(records.map(bet => bet.id)).size !== records.length) {
    throw new Error('Past Bets storage is unreadable. The original records were preserved.');
  }
  return records;
}

export function savePastBet(records: PastBet[], bet: PastBet, original?: PastBet): PastBet[] {
  if (!validBet(bet)) throw new Error('Check the bet date, amounts and selections.');
  const saved = records.find(record => record.id === bet.id);
  if (JSON.stringify(saved) !== JSON.stringify(original)) {
    throw new Error('This bet changed in another tab. Reopen it to edit the latest version.');
  }
  return saved ? records.map(record => record.id === bet.id ? bet : record) : [...records, bet];
}

export function netBetProfit(bet: PastBet): number | null {
  return bet.returned === null ? null : bet.returned - bet.stake;
}

export function summarizePastBets(records: PastBet[]) {
  return records.reduce((totals, bet) => {
    totals.profit += netBetProfit(bet) ?? 0;
    totals.staked += bet.stake;
    totals.wins += Number(bet.result === 'Won');
    totals.losses += Number(bet.result === 'Lost');
    return totals;
  }, {profit: 0, staked: 0, wins: 0, losses: 0});
}

const currency = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'});
export const formatBetMoney = (cents: number) => currency.format(cents / 100);
export const formatBetProfit = (cents: number) => (cents > 0 ? '+' : '') + formatBetMoney(cents);
