import { fetchSnapshot } from "./snapshotCache";
import { useEffect, useState } from 'react';
import draftKingsLogo from './assets/draftkings.png';

type Game = {game_id: string; home_team: string; away_team: string};
type GameOdds = {bookmaker: string; last_update: string | null; home_moneyline: number | null; away_moneyline: number | null; home_spread?: number | null; away_spread?: number | null; over_under?: number | null};
type OddsData = {exported_at: string; games: Record<string, GameOdds>};
const american = (value: number | null | undefined) => value == null ? '—' : value > 0 ? `+${value}` : String(value);
const spread = (value: number | null | undefined) => typeof value !== 'number' || !Number.isFinite(value) ? '—' : value === 0 ? 'PK' : value > 0 ? `+${value}` : String(value);
export default function DashboardMarkets({game}: {game: Game | null}) {
  const [data, setData] = useState<OddsData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetchSnapshot(`${import.meta.env.BASE_URL}odds.json`).then(response => {
      if (!response.ok) throw Error('Sportsbook data unavailable');
      return response.json();
    }).then((result: OddsData) => { if (active) setData(result); })
      .catch((reason: Error) => { if (active) setError(reason.message); });
    return () => {active=false;};
  }, []);
  const odds = game && data ? data.games[game.game_id] ?? null : null;
  const unavailable = error || (!data ? 'Loading sportsbook data...' : !game ? 'Select a matchup.' : 'No sportsbook odds saved for this matchup.');
  const lastUpdated = odds?.last_update && Number.isFinite(Date.parse(odds.last_update))
    ? new Date(odds.last_update).toLocaleString('en-US', {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})
    : null;
  return (
    <section className="ud-panel ud-market-panel" aria-label="Selected matchup market snapshot">
      <div className="ud-panel-heading">
        <div>
          <h3>Market Snapshot</h3>
          <p>{game ? `${game.away_team} at ${game.home_team}` : 'Selected matchup'} · {lastUpdated ? `Saved ${lastUpdated}` : 'Saved game lines'}</p>
        </div>
        <div className="ud-market-source">
          {(!odds || /draftkings/i.test(odds.bookmaker)) ? <img className="ud-draftkings-logo" src={draftKingsLogo} alt="DraftKings" /> : <span className="ud-tag">{odds.bookmaker}</span>}
          {odds && <a href="#markets" aria-label="Explore markets">Markets ↗</a>}
        </div>
      </div>
      <div className="ud-market-body">
        {game && odds ? <dl className="ud-market-lines" aria-label="Saved game lines">
          <div className="ud-market-moneyline">
            <dt>Moneyline</dt>
            <dd><span>{game.away_team}</span> <strong>{american(odds.away_moneyline)}</strong></dd>
            <dd><span>{game.home_team}</span> <strong>{american(odds.home_moneyline)}</strong></dd>
          </div>
          <div className="ud-market-spread">
            <dt>Spread</dt>
            <dd><span>{game.away_team}</span> <strong>{spread(odds.away_spread)}</strong></dd>
            <dd><span>{game.home_team}</span> <strong>{spread(odds.home_spread)}</strong></dd>
          </div>
          <div className="ud-market-total">
            <dt>Game total</dt>
            <dd><strong>{typeof odds.over_under === 'number' && Number.isFinite(odds.over_under) ? `O/U ${odds.over_under}` : '—'}</strong></dd>
          </div>
        </dl> : <p className="ud-empty" role="status">{unavailable}</p>}
      </div>
    </section>
  );
}
