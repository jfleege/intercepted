import { availableModels, probability, MODEL_LABELS } from './predictionModels';
import type { Model, PredictionFields } from './predictionModels';
import { useEffect, useState } from 'react';
import draftKingsLogo from './assets/draftkings.png';

type Game = PredictionFields & {game_id: string; home_team: string; away_team: string};
type GameOdds = {bookmaker: string; last_update: string | null; home_moneyline: number | null; away_moneyline: number | null; home_spread?: number | null; away_spread?: number | null; over_under?: number | null};
type OddsData = {exported_at: string; games: Record<string, GameOdds>};
const american = (value: number | null | undefined) => value == null ? '—' : value > 0 ? `+${value}` : String(value);
const spread = (value: number | null | undefined) => typeof value !== 'number' || !Number.isFinite(value) ? '—' : value === 0 ? 'PK' : value > 0 ? `+${value}` : String(value);
export default function DashboardMarkets({game, model}: {game: Game | null; model: Model}) {
  const [data, setData] = useState<OddsData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetch(`${import.meta.env.BASE_URL}odds.json`).then(response => {
      if (!response.ok) throw Error('Sportsbook data unavailable');
      return response.json();
    }).then((result: OddsData) => { if (active) setData(result); })
      .catch((reason: Error) => { if (active) setError(reason.message); });
    return () => {active=false;};
  }, []);
  const odds = game && data ? data.games[game.game_id] ?? null : null;
  const unavailable = error || (!data ? 'Loading sportsbook data...' : !game ? 'Select a matchup.' : !odds ? 'No sportsbook odds saved for this matchup.' : null);
  const models = game ? availableModels([game], true) : [];
  const selectedPick = game ? probability(game, model) >= .5 ? game.home_team : game.away_team : null;
  const agree = game ? models.filter(m => (probability(game,m)>=.5 ? game.home_team : game.away_team) === selectedPick).length : 0;
  const lastUpdated = odds?.last_update ? new Date(odds.last_update).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : 'Update unavailable';
  return <>
    <section className="ud-panel ud-market-panel" aria-label="Selected matchup market snapshot">
      <div className="ud-panel-heading"><div><h3>Market snapshot</h3><p>{game ? `${game.away_team} at ${game.home_team}` : 'Selected matchup'} · Saved game lines</p></div>
        {(!odds || /draftkings/i.test(odds.bookmaker)) ? <img className="ud-draftkings-logo" src={draftKingsLogo} alt="DraftKings"/> : <span className="ud-tag">{odds.bookmaker}</span>}
      </div>
      <div className="ud-market-body">{unavailable ? <p className="ud-empty">{unavailable}</p> : <>
        <div className="ud-moneylines">{[['away',game!.away_team,odds?.away_moneyline],['home',game!.home_team,odds?.home_moneyline]].map(([side,team,value]) => <div className="ud-moneyline" key={String(side)}><span><img src={`${import.meta.env.BASE_URL}logos/${team}.png`} alt=""/>{team}</span><strong>{american(value as number | null | undefined)}</strong></div>)}</div>
        <div className="ud-market-lines" aria-label="Additional saved game lines">
          <div className="ud-market-line"><span>Spread</span><strong>{game!.away_team} <b>{spread(odds?.away_spread)}</b></strong><strong>{game!.home_team} <b>{spread(odds?.home_spread)}</b></strong></div>
          <div className="ud-market-line ud-market-total"><span>Game total</span><strong>{typeof odds?.over_under === 'number' && Number.isFinite(odds.over_under) ? `O/U ${odds.over_under}` : '—'}</strong></div>
        </div>
        <div className="ud-market-footer"><span>Saved odds · {lastUpdated}</span><a href="#markets">Explore markets ↗</a></div>
      </>}</div>
    </section>
    <section className="ud-panel ud-model-panel" aria-label="Selected matchup model picks">
      <div className="ud-panel-heading"><div><h3>Where the models stand</h3><p>Saved forecasts · agreement is not confidence</p></div><span className="ud-tag">{agree} / {models.length} pick {selectedPick ?? '—'}</span></div>
      <div className="ud-model-votes">{game ? models.map(m => {
        const home=probability(game,m), pick=home>=.5?game.home_team:game.away_team;
        return <div className={`ud-model-vote${m===model?' is-active':''}`} key={m}><span>{MODEL_LABELS[m]}</span><strong><img src={`${import.meta.env.BASE_URL}logos/${pick}.png`} alt=""/>{pick}</strong><span>{(Math.max(home,1-home)*100).toFixed(1)}%</span></div>;
      }) : <p className="ud-empty">Select a matchup.</p>}</div>
    </section>
  </>;
}
