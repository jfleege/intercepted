import TeamMark from './TeamMark';
import { teamStyle } from './teamPalette';
import type { CSSProperties } from 'react';
import { fetchSnapshot } from "./snapshotCache";

import { useEffect, useState } from "react";

type Player = {
  player_id: string;
  name: string;
  team: string;
  position: string;
  qb_status?: string;
  headshot: string | null;
  stat_label: string;
  recent_average: number;
  season_average: number;
  recent_td_average: number;
  trend_pct: number | null;
  games_sampled: number;
  season_games: number;
};

type MatchupPlayers = {
  home_team: string;
  away_team: string;
  home_players: Player[];
  away_players: Player[];
};

type PlayerData = {
  as_of: string;
  games: Record<string, MatchupPlayers>;
};

type Props = {
  gameId: string;
};

// player headshot
function Headshot({ player }: { player: Player }) {
  const [failed, setFailed] = useState(false);

  const initials = player.name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (!player.headshot || failed) {
    return (
      <div className="pw-headshot pw-fallback">
        {initials}
      </div>
    );
  }

  return (
    <img
      className="pw-headshot"
      src={player.headshot}
      alt={`${player.name} headshot`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

// player performance card
function PlayerCard({ player }: { player: Player }) {
  const trend = player.trend_pct;

  const trendText =
    trend === null
      ? "—"
      : `${trend > 0 ? "+" : ""}${trend.toFixed(1)}%`;

  const trendClass =
    trend === null
      ? ""
      : trend > 0
        ? "pw-positive"
        : trend < 0
          ? "pw-negative"
          : "";

  return (
    <article className="pw-card" style={teamStyle(player.team) as CSSProperties}>
      <div className="pw-name-line">
        <div>
          <div className="pw-name">
            {player.name}
          </div>

          <div className="pw-subtitle">
            <TeamMark team={player.team}/> · {player.position}{player.position === "QB" ? ` · ${player.qb_status === "confirmed" ? "Confirmed starter" : player.qb_status === "reported_expected" ? "Expected starter" : "Unconfirmed projection"}` : ""}
          </div>
        </div>

        <Headshot player={player} />
      </div>

      <div className="pw-metric-label">
        {player.stat_label} per game
      </div>

      <div className="pw-form-comparison" aria-label="Recent and season average yardage">
        {[['Season',player.season_average],['Recent',player.recent_average]].map(([label,value])=><div key={label}><span>{label}</span><span className="pw-form-track"><i style={{width:`${Math.max(0,Number(value))/Math.max(1,player.season_average,player.recent_average)*100}%`}}/></span><b>{Number(value).toFixed(1)}</b></div>)}
      </div>
      <div className="pw-stats">
        <div>
          <span>LAST {player.games_sampled} AVG.</span>
          <strong>
            {player.recent_average.toFixed(1)}
          </strong>
        </div>

        <div>
          <span>SEASON AVG.</span>
          <strong>
            {player.season_average.toFixed(1)}
          </strong>
        </div>

        <div>
          <span>RECENT TREND</span>
          <strong className={trendClass}>
            {trendText}
          </strong>
        </div>

        <div>
          <span>LAST 3 AVG. TDS</span>
          <strong>
            {player.recent_td_average.toFixed(2)}
          </strong>
        </div>
      </div>

      <div className="pw-card-footer">
        Based on {player.season_games} season appearances
      </div>
    </article>
  );
}

// matchup player statistics
export default function PlayersToWatch({ gameId }: Props) {
  const [data, setData] = useState<PlayerData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // load exported player data
  useEffect(() => {
    let active = true;

    fetchSnapshot(`${import.meta.env.BASE_URL}players_watch.json`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            "Could not load players_watch.json"
          );
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

  if (error) {
    return (
      <div className="ic-empty">
        {error}. Run the player-watch exporter first.
      </div>
    );
  }

  if (!data) {
    return (
      <div className="ic-empty">
        Loading player statistics...
      </div>
    );
  }

  const matchup = data.games[gameId];

  if (!matchup) {
    return (
      <div className="ic-empty">
        No player statistics available for this matchup.
      </div>
    );
  }

  return (
    <div className="pw-container">
      <div className="pw-heading">
        <h3>Players to Watch</h3>
        <span>Recent performance</span>
      </div>

      <div className="pw-team-columns">{(['away','home'] as const).map(side=><section key={side} aria-label={`${matchup[`${side}_team`]} recent players`}><h4 className="pw-team-heading"><TeamMark team={matchup[`${side}_team`]}/><span className="team-caption">{side==='away'?'Away':'Home'} · Recent form</span></h4><div className="pw-grid">{matchup[`${side}_players`].map(player=><PlayerCard key={player.player_id} player={player}/>)}</div></section>)}</div>

      <p className="ic-footnote">
        Statistics use available games through {data.as_of}.
        Trends compare recent average yardage with the
        season average. QB touchdowns are passing TDs;
        other positions use rushing and receiving TDs.
        These are historical statistics, not predictions.
      </p>
    </div>
  );
}
