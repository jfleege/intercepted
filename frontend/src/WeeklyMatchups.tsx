import { availableModels, probability, MODEL_LABELS } from './predictionModels';
import type { Model } from './predictionModels';
import type { Game } from './forecastTypes';
import { TEAM_NAMES } from './teams';
import ProbabilityWheel from './ProbabilityWheel';

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
const logo = (team: string) => `${import.meta.env.BASE_URL}logos/${team}.png`;
const qbStatus = (status?: string) => status === 'reported_expected' ? 'Expected starter' : status === 'confirmed' ? 'Confirmed starter' : 'Unconfirmed projection';
function Result({ game, winner }: { game: Game; winner: string }) {
  const result = game.result;
  if (result?.status !== 'final' || result.home_score === null || result.away_score === null) return <span className="ud-result">{result?.status ?? 'Pending'}</span>;
  const tie = result.home_score === result.away_score;
  const correct = winner === (result.home_score > result.away_score ? game.home_team : game.away_team);
  return <span className={`ud-result ${tie ? '' : correct ? 'is-correct' : 'is-incorrect'}`}>{result.away_score}–{result.home_score} · {tie ? 'Tie' : correct ? 'Correct' : 'Incorrect'}</span>;
}
export default function WeeklyMatchups({ games, focusedGame, model, archived, onFocus, onAnalysis }: {
  games: Game[]; focusedGame: Game | null; model: Model; archived: boolean;
  onFocus: (id: string) => void; onAnalysis: (game: Game) => void;
}) {
  const focusedProbability = focusedGame ? probability(focusedGame, model) : .5;
  const focusedWinner = focusedGame && (focusedProbability >= .5 ? focusedGame.home_team : focusedGame.away_team);
  const savedModels = focusedGame ? availableModels([focusedGame], true) : [];
  const agreeing = focusedGame ? savedModels.filter(m => (probability(focusedGame, m) >= .5 ? focusedGame.home_team : focusedGame.away_team) === focusedWinner).length : 0;
  return <div className="ud-matchup-grid">
    <section className="ud-panel ud-slate" aria-label="Weekly matchup list">
      <div className="ud-panel-heading"><div><h3>The weekly slate</h3><p>{games.length} matchups · {archived ? 'Saved pregame forecasts' : MODEL_LABELS[model]}</p></div><span>WIN PROBABILITY</span></div>
      <div className="ud-game-list">
        {games.map(game => {
          const home = probability(game, model), winner = home >= .5 ? game.home_team : game.away_team;
          const chance = Math.max(home, 1 - home), active = game.game_id === focusedGame?.game_id;
          return <button type="button" key={game.game_id} className={`ud-game${active ? ' is-selected' : ''}`} aria-pressed={active}
            onClick={() => onFocus(game.game_id)} aria-label={`${game.away_team} at ${game.home_team}. ${winner} pick, ${pct(chance)}. Select matchup.`}>
            <span><span className="ud-game-teams"><img src={logo(game.away_team)} alt=""/><b>{game.away_team}</b><i>at</i><img src={logo(game.home_team)} alt=""/><b>{game.home_team}</b></span>
              <span className="ud-game-date">{new Date(`${game.game_date}T12:00:00`).toLocaleDateString('en-US', {weekday:'short',month:'short',day:'numeric'})}{archived ? <Result game={game} winner={winner}/> : ' · Pregame'}</span>
            </span>
            <span className="ud-game-probability"><span><small>{winner} PICK</small><b>{pct(chance)}</b></span><span className="ud-chance-track"><span className={active ? 'ud-selected-fill' : ''} style={{width:`${chance*100}%`}}/></span></span>
          </button>;
        })}
      </div>
    </section>
    {focusedGame && <section className="ud-panel ud-focus" aria-label="Selected matchup analysis">
      <div className="ud-panel-heading"><div><span className="ud-eyebrow">MATCHUP FOCUS</span><h3>{focusedGame.away_team} at {focusedGame.home_team}</h3><p>Week {focusedGame.week} · {MODEL_LABELS[model]}</p></div><span className="ud-tag">{agreeing} / {savedModels.length} models</span></div>
      <ProbabilityWheel awayTeam={focusedGame.away_team} homeTeam={focusedGame.home_team} homeProb={focusedProbability}/>
      <p className="ud-projected-winner">Projected winner <strong>{focusedWinner ? TEAM_NAMES[focusedWinner] ?? focusedWinner : '—'}</strong></p>
      <div className="ud-projected-qbs"><div><span>{focusedGame.away_team} projected QB</span><strong>{focusedGame.away_projected_qb_name ?? 'QB TBD'}</strong><small>{qbStatus(focusedGame.away_qb_selection?.status)}</small>{focusedGame.away_qb_selection?.ngs_coverage_note && <small className="qb-coverage-note">{focusedGame.away_qb_selection.ngs_coverage_note}</small>}</div><div><span>{focusedGame.home_team} projected QB</span><strong>{focusedGame.home_projected_qb_name ?? 'QB TBD'}</strong><small>{qbStatus(focusedGame.home_qb_selection?.status)}</small>{focusedGame.home_qb_selection?.ngs_coverage_note && <small className="qb-coverage-note">{focusedGame.home_qb_selection.ngs_coverage_note}</small>}</div></div>
      <button type="button" className="ud-details-button" onClick={() => onAnalysis(focusedGame)}>Full matchup analysis <span aria-hidden="true">→</span></button>
    </section>}
  </div>;
}
