
import { useEffect, useState } from "react";

type Game = {
  game_id: string;
  home_team: string;
  away_team: string;
  home_win_prob_v4_a: number;
  home_win_prob_v4_qb_plus: number;
};

type Model = "v4_a" | "v4_qb_plus";

type GameOdds = {
  bookmaker: string;
  last_update: string | null;
  home_moneyline: number | null;
  away_moneyline: number | null;
  home_spread: number | null;
  away_spread: number | null;
  over_under: number | null;
};

type OddsData = {
  exported_at: string;
  games: Record<string, GameOdds>;
};

type Props = {
  game: Game | null;
  model: Model;
};

// format american odds
function american(value: number | null | undefined) {
  if (value == null) return "—";
  return value > 0 ? `+${value}` : String(value);
}

// convert american odds to implied probability
function impliedProbability(odds: number) {
  if (odds < 0) {
    return -odds / (-odds + 100);
  }

  if (odds > 0) {
    return 100 / (odds + 100);
  }

  return null;
}

function percentage(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function percentagePoints(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} pp`;
}

// selected matchup markets
export default function DashboardMarkets({
  game,
  model,
}: Props) {
  const [data, setData] = useState<OddsData | null>(null);
  const [error, setError] = useState("");

  // fetch saved sportsbook snapshot once
  useEffect(() => {
    let active = true;

    fetch(`${import.meta.env.BASE_URL}odds.json`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Sportsbook data unavailable");
        }

        return response.json();
      })
      .then((result: OddsData) => {
        if (active) setData(result);
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      });

    return () => {
      active = false;
    };
  }, []);

  const odds = game && data
    ? data.games[game.game_id] ?? null
    : null;

  const homeModel = game
    ? model === "v4_a"
      ? game.home_win_prob_v4_a
      : game.home_win_prob_v4_qb_plus
    : null;

  const awayModel =
    homeModel === null ? null : 1 - homeModel;

  // remove sportsbook margin by normalizing both sides
  const homeRaw =
    odds?.home_moneyline != null
      ? impliedProbability(odds.home_moneyline)
      : null;

  const awayRaw =
    odds?.away_moneyline != null
      ? impliedProbability(odds.away_moneyline)
      : null;

  const rawTotal =
    homeRaw !== null && awayRaw !== null
      ? homeRaw + awayRaw
      : null;

  const homeMarket =
    homeRaw !== null && rawTotal !== null && rawTotal > 0
      ? homeRaw / rawTotal
      : null;

  const awayMarket =
    homeMarket === null ? null : 1 - homeMarket;

  // compare selected model against no-vig market
  const homeEdge =
    homeModel !== null && homeMarket !== null
      ? (homeModel - homeMarket) * 100
      : null;

  const awayEdge =
    awayModel !== null && awayMarket !== null
      ? (awayModel - awayMarket) * 100
      : null;

  const edgeTeam =
    homeEdge === null || !game
      ? null
      : homeEdge >= 0
        ? game.home_team
        : game.away_team;

  const edgeValue =
    homeEdge === null ? null : Math.abs(homeEdge);

  const lastUpdated = odds?.last_update
    ? new Date(odds.last_update).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  const unavailable = error
    ? error
    : !data
      ? "Loading sportsbook data..."
      : !game
        ? "Select a matchup."
        : !odds
          ? "No sportsbook odds saved for this matchup."
          : null;

  return (
    <>
      {/* betting and market insights */}
      <section className="dash-bottom-panel dm-panel">
        <div className="dash-bottom-heading">
          <div>
            <h3>Betting & Market Insights</h3>
            <p>
              {game
                ? `${game.away_team} @ ${game.home_team}`
                : "Selected matchup"}
            </p>
          </div>

          <span className="dm-source-tag">
            {odds?.bookmaker ?? "MARKETS"}
          </span>
        </div>

        {unavailable ? (
          <div className="dm-empty">{unavailable}</div>
        ) : (
          <>
            <div className="dm-market-row">
              <div>
                <span className="dm-row-label">Moneyline</span>
                <small>American odds</small>
              </div>
              <div className="dm-market-values">
                <span>
                  {game?.away_team}{" "}
                  <strong>{american(odds?.away_moneyline)}</strong>
                </span>
                <span>
                  {game?.home_team}{" "}
                  <strong>{american(odds?.home_moneyline)}</strong>
                </span>
              </div>
            </div>

            <div className="dm-market-row">
              <div>
                <span className="dm-row-label">Spread</span>
                <small>Points</small>
              </div>
              <div className="dm-market-values">
                <span>
                  {game?.away_team}{" "}
                  <strong>{american(odds?.away_spread)}</strong>
                </span>
                <span>
                  {game?.home_team}{" "}
                  <strong>{american(odds?.home_spread)}</strong>
                </span>
              </div>
            </div>

            <div className="dm-market-row">
              <div>
                <span className="dm-row-label">Over / Under</span>
                <small>Total points</small>
              </div>

              <span className="dm-total-pill">
                {odds?.over_under ?? "—"}
              </span>
            </div>

            <div className="dm-snapshot">
              <span>Saved sportsbook snapshot</span>
              <strong>{lastUpdated ?? "Update unavailable"}</strong>
            </div>
          </>
        )}
      </section>

      {/* model edge */}
      <section className="dash-bottom-panel dm-panel">
        <div className="dash-bottom-heading">
          <div>
            <h3>Model Edge</h3>
            <p>Model vs. no-vig market</p>
          </div>

          <span className="dm-source-tag">
            {model === "v4_qb_plus" ? "QB+" : "BASE"}
          </span>
        </div>

        {unavailable ? (
          <div className="dm-empty">{unavailable}</div>
        ) : homeEdge === null || awayEdge === null ? (
          <div className="dm-empty">
            Moneyline odds unavailable for comparison.
          </div>
        ) : (
          <>
            
<div className="dm-edge-summary">
  <span className="dm-edge-label">
    LARGEST DIFFERENCE
  </span>

  <div className="dm-edge-team-row">
    <div className="dm-edge-team">
      {edgeTeam && (
        <img
          src={`${import.meta.env.BASE_URL}logos/${edgeTeam}.png`}
          alt={`${edgeTeam} logo`}
        />
      )}

      <strong>{edgeTeam}</strong>
    </div>

    <div className="dm-edge-value">
      +{edgeValue?.toFixed(1)} pp
    </div>
  </div>
</div>


            <div className="dm-comparison">
              <div className="dm-comparison-row">
                <span>Team</span>
                <span>Model</span>
                <span>Market</span>
                <span>Diff.</span>
              </div>

              <div className="dm-comparison-row">
                <strong>{game?.away_team}</strong>
                <span>{percentage(awayModel ?? 0)}</span>
                <span>{percentage(awayMarket ?? 0)}</span>
                <strong
                  className={
                    awayEdge > 0 ? "dm-positive" : "dm-negative"
                  }
                >
                  {percentagePoints(awayEdge)}
                </strong>
              </div>

              <div className="dm-comparison-row">
                <strong>{game?.home_team}</strong>
                <span>{percentage(homeModel ?? 0)}</span>
                <span>{percentage(homeMarket ?? 0)}</span>
                <strong
                  className={
                    homeEdge > 0 ? "dm-positive" : "dm-negative"
                  }
                >
                  {percentagePoints(homeEdge)}
                </strong>
              </div>
            </div>
          </>
        )}
      </section>
    </>
  );
}
