import { formatBetMoney, formatBetProfit, PAST_BETS_PATH, summarizePastBets } from './pastBets';
import usePastBets from './usePastBets';

export default function DashboardPastBets() {
  const {records, error} = usePastBets();
  const {profit, wins, losses, staked} = summarizePastBets(records);

  return <section className="ud-panel ud-past-bets" aria-labelledby="ud-past-bets-title">
    <div className="ud-panel-heading">
      <div><h3 id="ud-past-bets-title">Past Bets</h3><p>All bets logged in this browser</p></div>
      <a href={`#${PAST_BETS_PATH}`}>View Past Bets</a>
    </div>
    <div className="ud-past-bets-body">
      {error || !records.length ? <p className="ud-empty">{error || 'Log a bet in Markets to see your record here.'}</p> :
        <dl className="ud-bet-totals">
          <div><dt>Net profit</dt><dd className={profit > 0 ? 'is-positive' : profit < 0 ? 'is-negative' : undefined}>{formatBetProfit(profit)}</dd></div>
          <div><dt>Win–loss</dt><dd>{wins}–{losses}</dd></div>
          <div><dt>Total staked</dt><dd>{formatBetMoney(staked)}</dd></div>
        </dl>}
    </div>
  </section>;
}
