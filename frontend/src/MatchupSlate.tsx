import type { Game } from './forecastTypes';
import './MatchupsPage.css';

type CardStatus = { label: string; open: boolean };

export default function MatchupSlate({games, selected, onSelect, statuses, showAll = false}: {
  games: Game[];
  selected?: string;
  onSelect: (id: string) => void;
  statuses?: ReadonlyMap<string, CardStatus>;
  showAll?: boolean;
}) {
  return <div className="mx-slate" role="group" aria-label={showAll ? 'Market game' : 'Select matchup'}>
    {showAll && <button type="button" aria-pressed={selected === 'all'} onClick={() => onSelect('all')}>
      <span>All games</span><small>Cross-game research</small>
    </button>}
    {games.map(game => {
      const status = statuses?.get(game.game_id);
      return <button type="button" key={game.game_id} data-game-id={game.game_id}
        className={status && !status.open ? 'is-closed' : undefined}
        aria-pressed={game.game_id === selected} onClick={() => onSelect(game.game_id)}>
        <span>
          <img className="mx-logo" src={`${import.meta.env.BASE_URL}logos/${game.away_team}.png`} alt="" loading="lazy" />
          {game.away_team}<small>@</small>
          <img className="mx-logo" src={`${import.meta.env.BASE_URL}logos/${game.home_team}.png`} alt="" loading="lazy" />
          {game.home_team}
        </span>
        <small>{game.game_date}{status ? ` · ${status.label}` : ''}</small>
      </button>;
    })}
  </div>;
}
