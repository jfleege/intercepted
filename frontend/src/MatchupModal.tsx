import { TEAM_NAMES } from "./teams";
import { probability, MODEL_LABELS } from "./predictionModels";
import type { Model, PredictionFields } from "./predictionModels";

import { useEffect, useState } from "react";
import PlayersToWatch from "./PlayersToWatch";
import draftkingsLogo from "./assets/draftkings.png";

export type Matchup = PredictionFields & {
  game_id: string;
  game_date: string;
  home_team: string;
  away_team: string;
  home_projected_qb_name?: string | null;
  away_projected_qb_name?: string | null;
};

type GameOdds = {
  bookmaker: string;
  last_update: string | null;
  commence_time: string;
  home_moneyline: number | null;
  away_moneyline: number | null;
  home_spread: number | null;
  away_spread: number | null;
  over_under: number | null;
};

type OddsData = {
  games: Record<string, GameOdds>;
};

type Tab = "overview" | "odds" | "players";

type Props = {
  game: Matchup;
  model: Model;
  archived?: boolean;
  onClose: () => void;
};

const pct = (value: number) =>
  `${(value * 100).toFixed(1)}%`;

const oddsText = (value: number | null | undefined) => {
  if (value == null) return "—";
  return value > 0 ? `+${value}` : String(value);
};

export default function MatchupModal({
  game,
  model,
  archived = false,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [odds, setOdds] = useState<GameOdds | null>(null);
  const [oddsLoading, setOddsLoading] = useState(true);

  // close with escape
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKey);

    return () => {
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // load odds snapshot
  useEffect(() => {
    let active = true;
    if (archived) return;

    fetch(`${import.meta.env.BASE_URL}odds.json`)
      .then((response) => {
        if (!response.ok) throw new Error("Odds unavailable");
        return response.json();
      })
      .then((data: OddsData) => {
        if (active) {
          setOdds(data.games?.[game.game_id] ?? null);
        }
      })
      .catch(() => {
        if (active) setOdds(null);
      })
      .finally(() => {
        if (active) setOddsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [game.game_id, archived]);

  const home = probability(game, model);

  const away = 1 - home;

  const winner =
    home >= 0.5 ? game.home_team : game.away_team;

  const winnerProbability = Math.max(home, away);

  const gameDate = new Date(
    `${game.game_date}T12:00:00`
  ).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div
      className="ic-overlay"
      onMouseDown={onClose}
    >
      <section
        className="ic-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${game.away_team} at ${game.home_team} matchup`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="ic-header">
          <div>
            <div className="ic-eyebrow">
              INTERCEPTED / MATCHUP ANALYSIS
            </div>
            <div className="ic-date">{gameDate}</div>
          </div>

          <button
            type="button"
            className="ic-close"
            onClick={onClose}
            aria-label="Close matchup"
          >
            ×
          </button>
        </div>

        
<div className="ic-teams">
  <div className="ic-team ic-team-away">
    <div className="ic-team-info">
      <div className="ic-abbr">{game.away_team}</div>
      <div className="ic-team-name">
        {TEAM_NAMES[game.away_team] ?? game.away_team}
      </div>
      <div className="ic-qb">
        {game.away_projected_qb_name ?? "QB unavailable"}
      </div>
    </div>

    <img
      src={`${import.meta.env.BASE_URL}logos/${game.away_team}.png`}
      alt={`${TEAM_NAMES[game.away_team] ?? game.away_team} logo`}
      className="ic-team-logo"
    />
  </div>

  <span className="ic-at">@</span>

  <div className="ic-team ic-team-home">
    <img
      src={`${import.meta.env.BASE_URL}logos/${game.home_team}.png`}
      alt={`${TEAM_NAMES[game.home_team] ?? game.home_team} logo`}
      className="ic-team-logo"
    />

    <div className="ic-team-info">
      <div className="ic-abbr">{game.home_team}</div>
      <div className="ic-team-name">
        {TEAM_NAMES[game.home_team] ?? game.home_team}
      </div>
      <div className="ic-qb">
        {game.home_projected_qb_name ?? "QB unavailable"}
      </div>
    </div>
  </div>
</div>


        <div className="ic-probs">
          <div className={away > home ? "ic-highlight" : ""}>
            {pct(away)}
            <span>AWAY</span>
          </div>

          <span className="ic-probs-label">WIN PROBABILITY</span>

          <div className={home >= away ? "ic-highlight" : ""}>
            {pct(home)}
            <span>HOME</span>
          </div>
        </div>

        <div className="ic-bar">
          <div style={{ width: `${away * 100}%` }} />
        </div>

        <div className="ic-winner">
          <span>Projected winner</span>
          <strong>
            {TEAM_NAMES[winner] ?? winner} · {pct(winnerProbability)}
          </strong>
        </div>

        <div className="ic-tabs" role="tablist" aria-label="Matchup details">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "overview"}
            className={tab === "overview" ? "ic-active" : ""}
            onClick={() => setTab("overview")}
          >
            Overview
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={tab === "odds"}
            className={tab === "odds" ? "ic-active" : ""}
            disabled={archived}
            onClick={() => setTab("odds")}
          >
            Vegas Odds
          </button>

          <button
  type="button"
  role="tab"
  aria-selected={tab === "players"}
  className={tab === "players" ? "ic-active" : ""}
  disabled={archived}
  onClick={() => setTab("players")}
>
  Players to Watch
</button>
        </div>

        <div className="ic-content" role="tabpanel">
          {archived && <p className="ic-footnote">Archived prediction. Current player cards and sportsbook lines are not shown for past weeks.</p>}
          {tab === "overview" && (
            <div className="ic-info-grid">
              <div className="ic-panel">
                <h3>Projected quarterbacks</h3>
                <div className="ic-row">
                  <span>{game.away_team}</span>
                  <strong>
                    {game.away_projected_qb_name ?? "Unavailable"}
                  </strong>
                </div>
                <div className="ic-row">
                  <span>{game.home_team}</span>
                  <strong>
                    {game.home_projected_qb_name ?? "Unavailable"}
                  </strong>
                </div>
                <p>Projections are based on recent primary passers.</p>
              </div>

              <div className="ic-panel">
                <h3>Model comparison</h3>
                {(["v5_qb_plus", "v5_boosted", "v4_a", "v4_qb_plus"] as Model[]).map(option => {
                  const p = game[("home_win_prob_" + option) as keyof Matchup];
                  return typeof p === "number" ? <div className="ic-row" key={option}>
                    <span>{MODEL_LABELS[option]}</span><strong>{pct(p)}</strong></div> : null;
                })}
                <p>Comparison uses home-win probabilities.</p>
              </div>
            </div>
          )}

          {tab === "odds" && (
            <>
              {oddsLoading ? (
                <div className="ic-empty">Loading odds...</div>
              ) : odds ? (
                <>
                  <div className="ic-odds-heading">
  <h3>Sportsbook lines</h3>

  {odds.bookmaker.toLowerCase() === "draftkings" ? (
    <img
      src={draftkingsLogo}
      alt="DraftKings"
      className="ic-sportsbook-logo"
    />
  ) : (
    <span>{odds.bookmaker}</span>
  )}
</div>

                  <div className="ic-odds-grid">
                    <div className="ic-odds-tile">
                      <span>{game.away_team} MONEYLINE</span>
                      <strong>{oddsText(odds.away_moneyline)}</strong>
                    </div>
                    <div className="ic-odds-tile">
                      <span>{game.home_team} MONEYLINE</span>
                      <strong>{oddsText(odds.home_moneyline)}</strong>
                    </div>
                    <div className="ic-odds-tile">
                      <span>{game.away_team} SPREAD</span>
                      <strong>{oddsText(odds.away_spread)}</strong>
                    </div>
                    <div className="ic-odds-tile">
                      <span>{game.home_team} SPREAD</span>
                      <strong>{oddsText(odds.home_spread)}</strong>
                    </div>
                    <div className="ic-odds-tile ic-wide">
                      <span>OVER / UNDER</span>
                      <strong>{odds.over_under ?? "—"}</strong>
                    </div>
                  </div>

                  <p className="ic-footnote">
                    Odds from {odds.bookmaker}. Last updated:{" "}
                    {odds.last_update
                      ? new Date(odds.last_update).toLocaleString()
                      : "Unavailable"}.
                    This is a saved snapshot, not a live feed.
                  </p>
                </>
              ) : (
                <div className="ic-empty">
                  No sportsbook odds are available for this matchup.
                </div>
              )}
            </>
          )}

{tab === "players" && (
  <PlayersToWatch gameId={game.game_id} />
)}
        </div>

        <div className="ic-bottom">
          Statistical forecasts are estimates, not guarantees.
          Projected starters and sportsbook lines may change.
        </div>
      </section>
    </div>
  );
}
