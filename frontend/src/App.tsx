
import { useEffect, useMemo, useState } from "react";
import "./App.css";
import MatchupModal from "./MatchupModal";

type Game = {
  game_id: string;
  season: number;
  week: number;
  game_date: string;
  home_team: string;
  away_team: string;
  predicted_winner: string;
  predicted_winner_probability: number;
  home_win_prob_v4_a: number;
  away_win_prob_v4_a: number;
  home_win_prob_v4_qb_plus: number;
  away_win_prob_v4_qb_plus: number;
  qb_probability_impact: number;
  home_projected_qb_name?: string | null;
  away_projected_qb_name?: string | null;
};

type PredictionData = {
  season: number;
  week: number;
  count: number;
  games: Game[];
};

type Model = "v4_qb_plus" | "v4_a";

const teams: Record<string, string> = {
  ARI: "Cardinals",
  ATL: "Falcons",
  BAL: "Ravens",
  BUF: "Bills",
  CAR: "Panthers",
  CHI: "Bears",
  CIN: "Bengals",
  CLE: "Browns",
  DAL: "Cowboys",
  DEN: "Broncos",
  DET: "Lions",
  GB: "Packers",
  HOU: "Texans",
  IND: "Colts",
  JAX: "Jaguars",
  KC: "Chiefs",
  LA: "Rams",
  LAC: "Chargers",
  LV: "Raiders",
  MIA: "Dolphins",
  MIN: "Vikings",
  NE: "Patriots",
  NO: "Saints",
  NYG: "Giants",
  NYJ: "Jets",
  PHI: "Eagles",
  PIT: "Steelers",
  SEA: "Seahawks",
  SF: "49ers",
  TB: "Buccaneers",
  TEN: "Titans",
  WAS: "Commanders",
};

function probability(game: Game, model: Model) {
  return model === "v4_a"
    ? game.home_win_prob_v4_a
    : game.home_win_prob_v4_qb_plus;
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function MatchupCard({
  game,
  model,
  onOpen,
}: {
  game: Game;
  model: Model;
  onOpen: () => void;
}) {
  const home = probability(game, model);
  const away = 1 - home;

  const winner = home >= 0.5
    ? game.home_team
    : game.away_team;

  const gameDate = new Date(`${game.game_date}T12:00:00`);

  return (
    <button
        type="button"
        className="matchup-card"
        onClick={onOpen}
    > 
      <div className="card-top">
        <span>
          {gameDate.toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}
        </span>
        <span className="prediction-label">
          {teams[winner]} favored
        </span>
      </div>

      <div className="teams">
        <div className="team">
          <div className="team-abbr">{game.away_team}</div>
          <div className="team-name">
            {teams[game.away_team] ?? game.away_team}
          </div>
          <div className="qb-name">
            {game.away_projected_qb_name ?? "QB unavailable"}
          </div>
        </div>

        <div className="versus">@</div>

        <div className="team team-right">
          <div className="team-abbr">{game.home_team}</div>
          <div className="team-name">
            {teams[game.home_team] ?? game.home_team}
          </div>
          <div className="qb-name">
            {game.home_projected_qb_name ?? "QB unavailable"}
          </div>
        </div>
      </div>

      <div className="probabilities">
        <div>
          <strong className={away > home ? "favored" : ""}>
            {percent(away)}
          </strong>
          <span>AWAY</span>
        </div>

        <div className="probability-title">
          WIN PROBABILITY
        </div>

        <div className="probability-right">
          <strong className={home >= away ? "favored" : ""}>
            {percent(home)}
          </strong>
          <span>HOME</span>
        </div>
      </div>

      <div className="probability-bar">
        <div
          className="away-bar"
          style={{ width: `${away * 100}%` }}
        />
        <div className="home-bar" />
      </div>

      <div className="card-footer">
        <span>Projected winner</span>
        <strong>
          {teams[winner] ?? winner} · {percent(Math.max(home, away))}
        </strong>
      </div>
    </button>
  );
}

function App() {
  const [data, setData] = useState<PredictionData | null>(null);
  const [model, setModel] = useState<Model>("v4_qb_plus");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("date");
  const [error, setError] = useState("");
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}predictions.json`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Could not load predictions.json");
        }
        return response.json();
      })
      .then((result: PredictionData) => {
        setData(result);
      })
      .catch((err) => {
        setError(err.message);
      });
  }, []);

  const games = useMemo(() => {
    if (!data) return [];

    const filtered = data.games.filter((game) => {
      const query = search.toLowerCase().trim();

      const names = [
        game.home_team,
        game.away_team,
        teams[game.home_team],
        teams[game.away_team],
      ].join(" ").toLowerCase();

      return names.includes(query);
    });

    return filtered.sort((a, b) => {
      if (sort === "confidence") {
        const confidenceA = Math.abs(probability(a, model) - 0.5);
        const confidenceB = Math.abs(probability(b, model) - 0.5);
        return confidenceB - confidenceA;
      }

      if (sort === "closest") {
        const differenceA = Math.abs(probability(a, model) - 0.5);
        const differenceB = Math.abs(probability(b, model) - 0.5);
        return differenceA - differenceB;
      }

      return (
        a.game_date.localeCompare(b.game_date) ||
        a.game_id.localeCompare(b.game_id)
      );
    });
  }, [data, model, search, sort]);

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="brand">
            <div className="brand-icon">I.</div>
            <span>INTERCEPTED</span>
          </div>
          <span className="header-detail">
            NFL FORECASTING LAB
          </span>
        </div>
      </header>

      <main className="container">
        <section className="hero">
          <p className="eyebrow">
            DATA-DRIVEN FOOTBALL FORECASTS
          </p>
          <h1>
            KNOW THE ODDS.
            <br />
            <span>BEFORE KICKOFF.</span>
          </h1>
          <p className="hero-description">
            NFL win probabilities powered by historical team
            performance, advanced efficiency metrics, and
            quarterback analytics.
          </p>

          <div className="hero-stats">
            <div className="stat">
              <span>SEASON</span>
              <strong>{data?.season ?? "—"}</strong>
            </div>
            <div className="stat">
              <span>WEEK</span>
              <strong>{data?.week ?? "—"}</strong>
            </div>
            <div className="stat">
              <span>MATCHUPS</span>
              <strong>{data?.count ?? "—"}</strong>
            </div>
          </div>
        </section>

        <section className="forecast-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">THE FORECAST</p>
              <h2>Weekly matchups</h2>
            </div>

            <div className="model-switch">
              <button
                className={model === "v4_qb_plus" ? "active" : ""}
                onClick={() => setModel("v4_qb_plus")}
              >
                QB+ Model
              </button>
              <button
                className={model === "v4_a" ? "active" : ""}
                onClick={() => setModel("v4_a")}
              >
                Base Model
              </button>
            </div>
          </div>

          <div className="toolbar">
            <input
              type="search"
              placeholder="Search teams..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />

            <select
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              aria-label="Sort matchups"
            >
              <option value="date">Game date</option>
              <option value="confidence">Highest confidence</option>
              <option value="closest">Closest matchups</option>
            </select>
          </div>

          {error && (
            <div className="message error">
              {error}. Run the prediction JSON exporter first.
            </div>
          )}

          {!data && !error && (
            <div className="message">
              Loading predictions...
            </div>
          )}

          {data && (
            <div className="matchup-grid">
              {games.map((game) => (
                <MatchupCard
                  key={game.game_id}
                  game={game}
                  model={model}
                  onOpen={() => setSelectedGame(game)}
                />
              ))}
            </div>
          )}

          {data && games.length === 0 && (
            <div className="message">
              No teams match your search.
            </div>
          )}
        </section>

        <footer className="footer">
          <div className="brand">
            <div className="brand-icon">I.</div>
            <span>INTERCEPTED</span>
          </div>
          <p>
            Predictions are statistical estimates, not guarantees.
            Projected quarterbacks and inputs may change before kickoff.
          </p>
          </footer>
    </main>

    {selectedGame && (
      <MatchupModal
        game={selectedGame}
        model={model}
        onClose={() => setSelectedGame(null)}
      />
    )}
  </div>
);
}

export default App;
