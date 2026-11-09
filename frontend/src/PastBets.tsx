import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { BET_RESULTS, LEG_RESULTS, PAST_BETS_KEY, betReturn, netBetProfit, parseBetAmount, readPastBets, savePastBet, summarizePastBets } from './pastBets';
import type { BetResult, LegResult, PastBet } from './pastBets';
import './PastBets.css';

const currency = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'});
const money = (cents: number) => currency.format(cents / 100);
const signedMoney = (cents: number) => (cents > 0 ? '+' : '') + money(cents);
const dateLabel = new Intl.DateTimeFormat('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'});
const kind = (bet: PastBet) => bet.legs.length === 1 ? 'Single' : `${bet.legs.length}-leg parlay`;
const tone = (result: string) => result === 'Won' ? 'pb-positive' : result === 'Lost' ? 'pb-negative' : '';
const localDate = () => new Date().toLocaleDateString('sv-SE');

function loadBets() {
  try {
    return {records: readPastBets(localStorage.getItem(PAST_BETS_KEY)), error: ''};
  } catch {
    return {records: [], error: 'Bet history is unavailable in this browser. Existing records were preserved.'};
  }
}

function BetEditor({original, onSave, onCancel}: {original?: PastBet; onSave: (bet: PastBet) => Promise<void>; onCancel: () => void}) {
  const nextLeg = useRef(original?.legs.length ?? 1);
  const [legs, setLegs] = useState(() => (original?.legs ?? [{name: '', result: 'Pending' as LegResult}])
    .map((leg, key) => ({...leg, key})));
  const [result, setResult] = useState<BetResult>(original?.result ?? 'Pending');
  const [stake, setStake] = useState(original ? (original.stake / 100).toFixed(2) : '');
  const [enteredReturn, setEnteredReturn] = useState(
    original && (original.result === 'Won' || original.result === 'Cash out') && original.returned !== null
      ? (original.returned / 100).toFixed(2) : ''
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const stakeCents = parseBetAmount(stake);
  const manualReturn = result === 'Won' || result === 'Cash out';
  const returned = betReturn(result, stakeCents ?? 0, parseBetAmount(enteredReturn));
  const returnField = manualReturn ? enteredReturn : returned === null ? '' : (returned / 100).toFixed(2);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const fields = new FormData(event.currentTarget);
    const name = String(fields.get('name') ?? '').trim();
    if (!name || legs.some(leg => !leg.name.trim()) || !stakeCents || (result !== 'Pending' && returned === null)) {
      setError('Enter a bet name, each selection, and valid dollar amounts with up to two decimal places.');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        id: original?.id ?? crypto.randomUUID(),
        name, date: String(fields.get('date') ?? ''), stake: stakeCents, returned, result,
        notes: String(fields.get('notes') ?? '').trim(),
        legs: legs.map(leg => ({name: leg.name.trim(), result: leg.result})),
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save this bet.');
    } finally {
      setSaving(false);
    }
  }

  return <section className="mb-panel pb-detail" aria-labelledby="pb-editor-title">
    <h3 id="pb-editor-title">{original ? 'Edit bet' : 'Log bet'}</h3>
    <form className="pb-form" onSubmit={submit}>
      <label>Bet name<input name="name" required autoFocus maxLength={80} defaultValue={original?.name} placeholder="e.g. Sunday two-leg parlay" /></label>
      <div className="pb-fields">
        <label>Placed on<input name="date" type="date" required defaultValue={original?.date ?? localDate()} /></label>
        <label>Bet result<select value={result} onChange={event => setResult(event.target.value as BetResult)}>
          {BET_RESULTS.map(value => <option key={value}>{value}</option>)}
        </select></label>
        <label>Stake ($)<input inputMode="decimal" value={stake} onChange={event => setStake(event.target.value)} required /></label>
        <label>Total returned ($)<input inputMode="decimal" value={returnField} onChange={event => setEnteredReturn(event.target.value)}
          disabled={!manualReturn} required={manualReturn} aria-describedby="pb-payout-note" /></label>
      </div>
      <p className="mb-note" id="pb-payout-note">Enter the full payout, including any stake returned.</p>
      <fieldset className="pb-legs">
        <legend>Legs</legend>
        <ol className="pb-leg-timeline pb-editor-legs">
          {legs.map((leg, index) => <li className="pb-leg-fields" key={leg.key}>
            <label>Leg {index + 1}<input value={leg.name} maxLength={120} required placeholder="e.g. Buffalo moneyline"
              onChange={event => setLegs(rows => rows.map(row => row.key === leg.key ? {...row, name: event.target.value} : row))} /></label>
            <label>Leg result<select aria-label={`Leg ${index + 1} result`} value={leg.result}
              onChange={event => setLegs(rows => rows.map(row => row.key === leg.key ? {...row, result: event.target.value as LegResult} : row))}>
              {LEG_RESULTS.map(value => <option key={value}>{value}</option>)}
            </select></label>
            <button type="button" aria-label={`Remove leg ${index + 1}`} disabled={legs.length === 1}
              onClick={() => setLegs(rows => rows.filter(row => row.key !== leg.key))}>Remove</button>
          </li>)}
        </ol>
        <button type="button" onClick={() => {
          const key = nextLeg.current++;
          setLegs(rows => [...rows, {key, name: '', result: 'Pending'}]);
        }}>+ Add leg</button>
      </fieldset>
      <label>Notes<textarea name="notes" rows={3} maxLength={1200} defaultValue={original?.notes} placeholder="What went into this bet?" /></label>
      {error && <p className="mb-input-error" role="alert">{error}</p>}
      <div className="pb-actions"><button type="submit" className="mb-primary" disabled={saving}>Save bet</button><button type="button" disabled={saving} onClick={onCancel}>Cancel</button></div>
    </form>
  </section>;
}

export default function PastBets() {
  const [storage, setStorage] = useState(loadBets);
  const [selectedId, setSelectedId] = useState<string>();
  const [editor, setEditor] = useState<{original?: PastBet} | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === PAST_BETS_KEY || event.key === null) setStorage(loadBets());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const records = [...storage.records].reverse().sort((a, b) => b.date.localeCompare(a.date));
  const active = records.find(bet => bet.id === selectedId) ?? records[0];
  const totals = summarizePastBets(records);

  async function save(bet: PastBet) {
    const persist = () => {
      const records = readPastBets(localStorage.getItem(PAST_BETS_KEY));
      const updated = savePastBet(records, bet, editor?.original);
      try {
        localStorage.setItem(PAST_BETS_KEY, JSON.stringify(updated));
      } catch {
        throw new Error('Could not save this bet. Browser storage may be full or unavailable.');
      }
      return updated;
    };
    const updated = navigator.locks ? await navigator.locks.request(PAST_BETS_KEY, persist) : persist();
    setStorage({records: updated, error: ''});
    setSelectedId(bet.id);
    setEditor(null);
    setNotice('Bet saved.');
  }

  const profit = active ? netBetProfit(active) : null;
  return <section className="pb-page" aria-labelledby="pb-title">
    <header className="pb-toolbar">
      <div><h2 id="pb-title">Past Bets</h2><p className="mb-note">Bet history saved in this browser.</p></div>
      <button className="mb-primary" type="button" disabled={!!storage.error || (editor !== null && !editor.original)}
        onClick={() => {setNotice(''); setEditor({});}}>+ Log bet</button>
    </header>
    {storage.error && <p className="mb-warning" role="alert">{storage.error}</p>}
    <dl className="pb-stats">
      <div><dt>Net profit</dt><dd className={totals.profit > 0 ? 'pb-positive' : totals.profit < 0 ? 'pb-negative' : ''}>{signedMoney(totals.profit)}</dd></div>
      <div><dt>Win–loss</dt><dd>{totals.wins}–{totals.losses}</dd></div>
      <div><dt>Total staked</dt><dd>{money(totals.staked)}</dd></div>
    </dl>
    <p role="status" className="sr-only">{notice}</p>
    <div className="pb-workspace">
      <section className="mb-panel pb-history" aria-labelledby="pb-history-title">
        <h3 id="pb-history-title">Bet history</h3>
        {!records.length && <p className="mb-note">Log a single or parlay to start your history.</p>}
        <ul className="pb-list">
          {records.map(bet => <li key={bet.id}>
            <button type="button" aria-pressed={bet.id === active?.id}
              onClick={() => {setSelectedId(bet.id); setEditor(null); setNotice('');}}>
              <span><strong>{bet.name}</strong><small>{dateLabel.format(new Date(bet.date + 'T00:00:00Z'))} · {kind(bet)}</small></span>
              <span className={tone(bet.result)}>{bet.result}</span>
            </button>
          </li>)}
        </ul>
      </section>
      {editor ? <BetEditor key={editor.original?.id ?? 'new'} original={editor.original} onSave={save} onCancel={() => setEditor(null)} /> : active &&
        <section className="mb-panel pb-detail" aria-labelledby="pb-detail-title">
          <header className="pb-toolbar">
            <div><span className="mb-eyebrow">{kind(active)}</span><h3 id="pb-detail-title">{active.name}</h3></div>
            <button type="button" onClick={() => {setNotice(''); setEditor({original: active});}}>Edit bet</button>
          </header>
          <dl className="pb-totals">
            <div><dt>Stake</dt><dd>{money(active.stake)}</dd></div>
            <div><dt>Returned</dt><dd>{active.returned === null ? 'Pending' : money(active.returned)}</dd></div>
            <div><dt>Net</dt><dd>{profit === null ? 'Pending' : signedMoney(profit)}</dd></div>
          </dl>
          <h4>Legs</h4>
          <ol className="pb-leg-timeline pb-detail-legs">{active.legs.map((leg, index) =>
            <li key={index}><span>{leg.name}</span><span className={tone(leg.result)}>{leg.result}</span></li>
          )}</ol>
          <h4>Notes</h4>
          <p className="mb-note pb-notes">{active.notes || 'No notes recorded.'}</p>
        </section>
      }
    </div>
  </section>;
}
