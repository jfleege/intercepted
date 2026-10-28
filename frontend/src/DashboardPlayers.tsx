import {useForecastInsights} from './forecastInsightsStore';
import {availabilityLabel,findContext,reportedOut,starterLabel} from './forecastInsights';
import { fetchSnapshot } from "./snapshotCache";

import { useEffect, useMemo, useRef, useState } from "react";
import { rankWatchPlayers, watchTouchdown } from "./playerWatchRanking";
import type { WatchProjection, WatchReport } from "./playerWatchRanking";

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

type WeeklyPlayer = Player & {
  opponent: string;
  isHome: boolean;
  projection?: WatchProjection;
};

type MatchupPlayers = {
  away_team: string;
  home_team: string;
  away_players: Player[];
  home_players: Player[];
};

type DefenseRank = {
  overall_rank: number | null;
  pass_rank: number | null;
  rush_rank: number | null;
  points_allowed_per_game: number | null;
  pass_yards_allowed_per_game: number | null;
  rush_yards_allowed_per_game: number | null;
  games: number;
  through_week: number;
};

type PlayerData = {
  season: number;
  week: number;
  as_of: string;
  games: Record<string, MatchupPlayers>;
  defense_rankings?: { league_size: number; teams: Record<string, DefenseRank> };
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
function PlayerCard({ player, week, season, gameId, defense, leagueSize }: { player: WeeklyPlayer; week: number; season:number; gameId:string; defense?: DefenseRank; leagueSize?: number }) {
  const insights=useForecastInsights();
  const context=findContext(insights.data,{season,week},player.player_id,gameId,player.team,player.opponent,insights.now);
  const rushing = player.position === "RB";
  const yardageRank = rushing ? defense?.rush_rank : defense?.pass_rank;
  const yards = rushing ? defense?.rush_yards_allowed_per_game : defense?.pass_yards_allowed_per_game;
  const overallDescription = defense?.overall_rank != null
    ? `${player.opponent} scoring defense: rank ${defense.overall_rank} of ${leagueSize}, ${defense.points_allowed_per_game} points allowed per game, through Week ${defense.through_week}.`
    : "Scoring-defense rank unavailable.";
  const yardageDescription = yardageRank != null
    ? `${player.opponent} ${rushing ? "rush" : "pass"} defense: rank ${yardageRank} of ${leagueSize}, ${yards} gross yards allowed per game. Rank 1 allows the fewest.`
    : "Yardage-defense rank unavailable.";
  const trend = player.trend_pct;
  const projection = player.projection;
  const touchdown = watchTouchdown(player.position, projection);
  const scale = Math.max(1, player.season_average, player.recent_average, projection?.expected_yards ?? 0);

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
        <div className="dp-player-context">
        <div className="dp-player-opponent" aria-label={`Week ${week}: ${player.team} ${player.isHome ? "hosts" : "at"} ${player.opponent}`}>
          <span>Week {week}</span>
          <strong>
            <img src={`${import.meta.env.BASE_URL}logos/${player.opponent}.png`} alt="" loading="lazy" />
            <small>{player.isHome ? "vs" : "at"}</small> {player.opponent}
          </strong>
        </div>
        <div className="dp-defense-ranks">
          <span title={overallDescription} aria-label={overallDescription}>DEF <b>{defense?.overall_rank != null ? `#${defense.overall_rank}` : "—"}</b></span>
          <span title={yardageDescription} aria-label={yardageDescription}>{rushing ? "RUSH" : "PASS"} <b>{yardageRank != null ? `#${yardageRank}` : "—"}</b></span>
        </div>
        </div>
      </div>

      <div className="dp-projection-summary"><div className="dp-player-stat">
        <strong>{(projection?.expected_yards ?? player.recent_average).toFixed(1)}</strong>
        <span>
          {projection ? "Projected" : `Last ${player.games_sampled}`} · {player.stat_label}{projection ? "" : "/game"}
        </span>
      </div>

      {projection && <div className="dp-touchdown-stat"><strong>{touchdown.probability === null ? "—" : `${(touchdown.probability * 100).toFixed(1)}%`}</strong><span>{touchdown.label}</span><small>{touchdown.probability === null ? "Unavailable" : "Model probability"}</small></div>}
      </div>
      {projection && <p className="dp-projection-range">80% range {projection.range_80![0].toFixed(1)}–{projection.range_80![1].toFixed(1)} yards · experimental</p>}
      <div className="ud-player-comparison" aria-label={`Season average ${player.season_average.toFixed(1)}, last ${player.games_sampled} average ${player.recent_average.toFixed(1)} ${player.stat_label} per game`}>
        <div><span>Season</span><i style={{width:`${Math.max(0, player.season_average) / scale * 100}%`}}/><b>{player.season_average.toFixed(1)}</b></div>
        <div><span>Last {player.games_sampled}</span><i className="ud-recent" style={{width:`${Math.max(0, player.recent_average) / scale * 100}%`}}/><b>{player.recent_average.toFixed(1)}</b></div>
        {projection && <div><span>Projected</span><i className="ud-projected" style={{width:`${projection.expected_yards! / scale * 100}%`}}/><b>{projection.expected_yards!.toFixed(1)}</b></div>}
      </div>
      <p className="fi-availability-note">{availabilityLabel(context,insights.now)} · {starterLabel(context,insights.now)}{context?.usage.estimate!=null && context.kickoff && insights.now<Date.parse(context.kickoff) && ` · Usage baseline ${context.usage.estimate.toFixed(1)} ${context.usage.field}`}</p>
      <div className="ud-player-trend"><span>Change vs. season average</span><strong className={`dp-trend ${trendClass}`}>{trendText}</strong></div>
    </article>
  );
}

// weekly player trend leaderboard
export default function DashboardPlayers() {
  const insights=useForecastInsights();
  const [data, setData] = useState<PlayerData | null>(null);
  const [error, setError] = useState("");
  const [report, setReport] = useState<WatchReport | null>(null);
  const [mode, setMode] = useState<"blend" | "form">("blend");
  const [reportLoading, setReportLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

// scroll player cards horizontally
const scrollPlayers = (direction: number) => {
  const container = scrollRef.current;
  if (!container) return;

  const card = container.querySelector<HTMLElement>(
    ".dp-player-card"
  );

  const distance = card
    ? card.getBoundingClientRect().width + 12
    : 200;

  container.scrollBy({
    left: direction * distance,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
  });
};

  // load player data
  useEffect(() => {
    let active = true;

    fetchSnapshot(`${import.meta.env.BASE_URL}players_watch.json`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Player data unavailable");
        }

        return response.json();
      })
      .then((result: PlayerData) => {
        if (active) {
          setReportLoading(true);
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

  useEffect(() => {
    if (!data) return;
    const controller = new AbortController();
    fetchSnapshot(`${import.meta.env.BASE_URL}research/${data.season}-week-${data.week}.json`, {signal: controller.signal})
      .then(response => { if (!response.ok) throw new Error("Projections unavailable"); return response.json(); })
      .then((result: WatchReport) => { if (!controller.signal.aborted) setReport(result); })
      .catch(() => { if (!controller.signal.aborted) setReport(null); })
      .finally(() => { if (!controller.signal.aborted) setReportLoading(false); });
    return () => controller.abort();
  }, [data]);

  const ranking = useMemo(() => data ? rankWatchPlayers(data, report, mode, Object.entries(data.games).flatMap(([gid,g])=>([...g.away_players,...g.home_players]).filter(p=>reportedOut(findContext(insights.data,data,p.player_id,gid,p.team,p.team===g.home_team?g.away_team:g.home_team,insights.now),insights.now)).map(p=>p.player_id))) : {players: [], blended: false, eligible: 0, total: 0}, [data, report, mode, insights.data, insights.now]);
  const {players} = ranking;

  return (
    <section className="dash-bottom-panel dp-panel">
      <div className="dash-bottom-heading">
        <div>
          <p className="ud-eyebrow">PROJECTION + FORM</p><h3>Players to Watch</h3>
          <p>
  {ranking.blended ? "Top 10 · projections + recent form" : "Top 10 · positive yardage trends"} · Week {data?.week ?? "—"}
</p>
        </div>

        <div className="dp-header-controls">
  <label className="dp-ranking-select"><span className="sr-only">Player ranking</span><select aria-label="Player ranking" value={mode} onChange={event => {setMode(event.target.value as "blend" | "form"); scrollRef.current?.scrollTo({left:0});}}><option value="blend">Projection + form</option><option value="form">Recent form</option></select></label>
  <span className="dp-week-label">
    TOP 10
  </span>

  <button
    type="button"
    className="dp-scroll-button"
    onClick={() => scrollPlayers(-1)}
    aria-label="Scroll players left"
  >
    ‹
  </button>

  <button
    type="button"
    className="dp-scroll-button"
    onClick={() => scrollPlayers(1)}
    aria-label="Scroll players right"
  >
    ›
  </button>
</div>
      </div>

      {data && mode === "blend" && !ranking.blended && <p className="dp-projection-status" role="status">{reportLoading ? "Loading projections; showing recent form." : "Matching projections unavailable; showing recent form."}</p>}
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
          <div className="dp-scroll-container" ref={scrollRef}>
  <div className="dp-grid">
    {players.map((player) => (
      <PlayerCard
        key={player.player_id}
        player={player}
        week={data!.week}
        season={data!.season}
        gameId={Object.keys(data!.games).find(gid=>[...data!.games[gid].away_players,...data!.games[gid].home_players].some(p=>p.player_id===player.player_id))??''}
        defense={data?.defense_rankings?.teams[player.opponent]}
        leagueSize={data?.defense_rankings?.league_size}
      />
    ))}
  </div>
</div>

          <p className="dp-footnote">
            {ranking.blended && <>Ranked equally by projected yardage and recent improvement within position, among {ranking.eligible} tracked players. Experimental estimates, conditional on appearing. </>}
            Fresh current-week reported-out players are excluded; unknown status is not healthy clearance. Statistics through {data?.as_of}. Trends compare
            recent yardage with season averages. Opponent defense ranks use points allowed/game; pass and rush ranks use gross yards allowed/game. #1 allows the fewest; completed prior weeks only.
          </p>
        </>
      )}
    </section>
  );
}
