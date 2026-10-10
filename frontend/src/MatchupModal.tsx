
import { useEffect, useState } from "react";

export type Matchup = {
  game_id: string;
  game_date: string;
  home_team: string;
  away_team: string;
  home_win_prob_v4_a: number;
  home_win_prob_v4_qb_plus: number;
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
  model: "v4_a" | "v4_qb_plus";
  onClose: () => void;
};

const teamNames: Record<string, string> = {
  ARI: "Cardinals", ATL: "Falcons", BAL: "Ravens",
  BUF: "Bills", CAR: "Panthers", CHI: "Bears",
  CIN: "Bengals", CLE: "Browns", DAL: "Cowboys",
  DEN: "Broncos", DET: "Lions", GB: "Packers",
  HOU: "Texans", IND: "Colts", JAX: "Jaguars",
  KC: "Chiefs", LA: "Rams", LAC: "Chargers",
  LV: "Raiders", MIA: "Dolphins", MIN: "Vikings",
  NE: "Patriots", NO: "Saints", NYG: "Giants",
  NYJ: "Jets", PHI: "Eagles", PIT: "Steelers",
  SEA: "Seahawks", SF: "49ers", TB: "Buccaneers",
  TEN: "Titans", WAS: "Commanders",
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
  }, [game.game_id]);

  const home =
    model === "v4_a"
      ? game.home_win_prob_v4_a
      : game.home_win_prob_v4_qb_plus;

  const away = 1 - home;

  const winner =
    home >= 0.5 ? game.home_team : game.away_team;

  const winnerProbability = Math.max(home, away);

  const difference =
    (game.home_win_prob_v4_qb_plus -
      game.home_win_prob_v4_a) * 100;

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
          <div className="ic-team">
            <div className="ic-abbr">{game.away_team}</div>
            <div className="ic-team-name">
              {teamNames[game.away_team] ?? game.away_team}
            </div>
            <div className="ic-qb">
              {game.away_projected_qb_name ?? "QB unavailable"}
            </div>
          </div>

          <span className="ic-at">@</span>

          <div className="ic-team ic-team-right">
            <div className="ic-abbr">{game.home_team}</div>
            <div className="ic-team-name">
              {teamNames[game.home_team] ?? game.home_team}
            </div>
            <div className="ic-qb">
              {game.home_projected_qb_name ?? "QB unavailable"}
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
            {teamNames[winner] ?? winner} · {pct(winnerProbability)}
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
            onClick={() => setTab("odds")}
          >
            Vegas Odds
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={tab === "players"}
            className={tab === "players" ? "ic-active" : ""}
            onClick={() => setTab("players")}
          >
            Players to Watch
          </button>
        </div>

        <div className="ic-content" role="tabpanel">
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
                <div className="ic-row">
                  <span>Base model</span>
                  <strong>{pct(game.home_win_prob_v4_a)}</strong>
                </div>
                <div className="ic-row">
                  <span>QB+ model</span>
                  <strong>{pct(game.home_win_prob_v4_qb_plus)}</strong>
                </div>
                <div className="ic-row">
                  <span>Difference</span>
                  <strong>
                    {difference > 0 ? "+" : ""}
                    {difference.toFixed(1)} pp
                  </strong>
                </div>
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
                    <span>{odds.bookmaker}</span>
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
            <div className="ic-empty">
              <h3>Players to Watch</h3>
              <p>
                Player-level analysis is coming next. We'll show
                real usage and performance statistics here.
              </p>
            </div>
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
