import { useMemo, useSyncExternalStore } from 'react';
import { PAST_BETS_KEY, readPastBets } from './pastBets';

const CHANGE_EVENT = 'intercepted:past-bets-changed';

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === PAST_BETS_KEY || event.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function snapshot() {
  try {
    return localStorage.getItem(PAST_BETS_KEY);
  } catch {
    return undefined;
  }
}

export function notifyPastBetsChanged() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export default function usePastBets() {
  const raw = useSyncExternalStore(subscribe, snapshot);
  return useMemo(() => {
    try {
      if (raw === undefined) throw Error('Storage unavailable');
      return {records: readPastBets(raw), error: ''};
    } catch {
      return {records: [], error: 'Bet history is unavailable in this browser.'};
    }
  }, [raw]);
}
