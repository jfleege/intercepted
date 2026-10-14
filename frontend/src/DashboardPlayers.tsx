
import { useEffect, useMemo, useState } from "react";

type Player = {
  player_id: string;
  name: string;
  team: string;
  position: string;
  headshot: string | null;
  stat_label: string;
  recent_average: number;
  season_average: number;
  trend_pct: number | null;
  games_sampled: number;
};

type MatchupPlayers = {
  away_team: string;
  home_team: string;
  away_players: Player[];
  home_players: Player[];
};

type PlayerData = {
  season: number;
  week: number;
  as_of: string;
  games: Record<string, MatchupPlayers>;
};

// player image with initials fallback
function PlayerHeadshot({ player }: { player: Player }) {
  const [failed, setFailed] = useState(false);

  const initials = player.name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (!player.headshot || failed) {
    return (
      <div className="dp-headshot dp-headshot-fallback">
        {initials}
      </div>
    );
  }

  return (
    <img
      className="dp-headshot"
      src={player.headshot}
      alt={`${player.name} headshot`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

// compact player card
function PlayerCard({ player }: { player: Player }) {
  const trend = player.trend_pct;

  const trendText =
    trend === null
      ? "—"
      : `${trend > 0 ? "+" : ""}${trend.toFixed(1)}%`;

  const trendClass =
    trend === null
      ? "neutral"
      : trend > 0
        ? "positive"
        : trend < 0
          ? "negative"
          : "neutral";

  return (
    <article className="dp-player-card">
      <div className="dp-player-top">
        <PlayerHeadshot player={player} />

        <div className="dp-player-identity">
          <span className="dp-position">{player.position}</span>
          <strong title={player.name}>{player.name}</strong>
          <small>{player.team}</small>
        </div>
      </div>

      <div className="dp-player-stat">
        <strong>{player.recent_average.toFixed(1)}</strong>
        <span>
          Last {player.games_sampled} · {player.stat_label}/game
        </span>
      </div>

      <div className="dp-player-footer">
        <div>
          <span>Season avg.</span>
          <strong>{player.season_average.toFixed(1)}</strong>
        </div>

        <div>
          <span>Trend</span>
          <strong className={`dp-trend ${trendClass}`}>
            {trendText}
          </strong>
        </div>
      </div>
    </article>
  );
}

// weekly player trend leaderboard
export default function DashboardPlayers() {
  const [data, setData] = useState<PlayerData | null>(null);
  const [error, setError] = useState("");

  // load player data
  useEffect(() => {
    let active = true;

    fetch(`${import.meta.env.BASE_URL}players_watch.json`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Player data unavailable");
        }

        return response.json();
      })
      .then((result: PlayerData) => {
        if (active) {
          setData(result);
        }
      })
      .catch((err: Error) => {
        if (active) {
          setError(err.message);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  // rank players across all weekly matchups
  const players = useMemo(() => {
    if (!data) return [];

    // collect players from every matchup
    const allPlayers = Object.values(data.games).flatMap(
      (matchup) => [
        ...matchup.away_players,
        ...matchup.home_players,
      ]
    );

    // remove duplicate players
    const uniquePlayers = Array.from(
      new Map(
        allPlayers.map((player) => [
          player.player_id,
          player,
        ])
      ).values()
    );

    // select the three highest positive yardage trends
    return uniquePlayers
      .filter(
        (player) =>
          player.trend_pct !== null &&
          Number.isFinite(player.trend_pct) &&
          player.trend_pct > 0
      )
      .sort(
        (a, b) =>
          (b.trend_pct ?? 0) - (a.trend_pct ?? 0)
      )
      .slice(0, 3);
  }, [data]);

  return (
    <section className="dash-bottom-panel dp-panel">
      <div className="dash-bottom-heading">
        <div>
          <h3>Players to Watch</h3>
          <p>
            Top 3 positive yardage trends · Week{" "}
            {data?.week ?? "—"}
          </p>
        </div>

        <span className="dp-week-label">
          WEEKLY LEADERS
        </span>
      </div>

      {!data && !error && (
        <div className="dp-empty">
          Loading player statistics...
        </div>
      )}

      {error && (
        <div className="dp-empty">
          {error}. Refresh your player data export.
        </div>
      )}

      {data && players.length === 0 && (
        <div className="dp-empty">
          No positive player trends available for this week.
        </div>
      )}

      {players.length > 0 && (
        <>
          <div className="dp-grid">
            {players.map((player) => (
              <PlayerCard
                key={player.player_id}
                player={player}
              />
            ))}
          </div>

          <p className="dp-footnote">
            Statistics through {data?.as_of}. Trends compare
            recent yardage with season averages.
          </p>
        </>
      )}
    </section>
  );
}
