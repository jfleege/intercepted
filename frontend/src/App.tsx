import { useEffect, useMemo, useState } from "react";
import "./App.css";
import "./DashboardLayout.css";
import { probability, availableModels, MODEL_LABELS } from "./predictionModels";
import type { Model } from "./predictionModels";
import "./PredictionHistory.css";
import MatchupModal from "./MatchupModal";
import playerBody from "./assets/playeronly.png";
import football from "./assets/ball.png";
import heroPlayer from "./assets/cw.webp";
import DashboardPlayers from "./DashboardPlayers";
import DashboardMarkets from "./DashboardMarkets";
import ScoreTicker from "./ScoreTicker";
import { PerformancePage, MarketsPage } from "./ReviewPages";

type Game = {
  home_win_prob_v5_qb_plus?: number;
  home_win_prob_v5_boosted?: number;
  result?: {status: string; home_score: number | null; away_score: number | null};
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
  home_qb_selection?: {status: string};
  away_qb_selection?: {status: string};
  home_projected_qb_name?: string | null;
  away_projected_qb_name?: string | null;
};
type PredictionData = {
  season: number;
  week: number;
  count: number;
  archived?: boolean;
  policy?: string;
  games: Game[];
};
type WeekEntry = {season: number; week: number; file: string; count: number};
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
function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}


const teamColors: Record<string, string> = {
  ARI: "#97233F",
  ATL: "#A71930",
  BAL: "#5A2D81",
  BUF: "#00338D",
  CAR: "#0085CA",
  CHI: "#C83803",
  CIN: "#FB4F14",
  CLE: "#FF3C00",
  DAL: "#003594",
  DEN: "#FB4F14",
  DET: "#0076B6",
  GB: "#203731",
  HOU: "#03202F",
  IND: "#002C5F",
  JAX: "#006778",
  KC: "#E31837",
  LA: "#003594",
  LAC: "#0080C6",
  LV: "#A5ACAF",
  MIA: "#008E97",
  MIN: "#4F2683",
  NE: "#002244",
  NO: "#D3BC8D",
  NYG: "#0B2265",
  NYJ: "#125740",
  PHI: "#004C54",
  PIT: "#FFB612",
  SEA: "#002244",
  SF: "#AA0000",
  TB: "#D50A0A",
  TEN: "#4B92DB",
  WAS: "#5A1414",
};


type ProbabilityWheelProps = {
  awayTeam: string;
  homeTeam: string;
  homeProb: number;
};

function ProbabilityWheel({
  awayTeam,
  homeTeam,
  homeProb,
}: ProbabilityWheelProps) {
  const awayProb = 1 - homeProb;
  const winnerIsHome = homeProb >= 0.5;

  const winnerTeam = winnerIsHome ? homeTeam : awayTeam;
  const winnerProb = winnerIsHome ? homeProb : awayProb;
  const winnerColor = teamColors[winnerTeam] ?? "#187be8";

  const radius = 61;
  const circumference = 2 * Math.PI * radius;
  const coloredLength = circumference * winnerProb;

  return (
    <div className="ga-wheel-block">
      <div className="ga-wheel-side">
        <strong>{awayTeam}</strong>
        <span className={winnerIsHome ? "" : "ga-favored"}>
          {percent(awayProb)}
        </span>
      </div>

      <div className="ga-wheel-wrap">
        <svg
          className="ga-prob-wheel"
          viewBox="0 0 160 160"
          role="img"
          aria-label={`${awayTeam} ${percent(awayProb)}, ${homeTeam} ${percent(homeProb)}`}
        >
          <defs>
            <pattern
              id="ga-loser-stripes"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(35)"
            >
              <rect width="6" height="6" fill="#f5f7f5" />
              <rect width="2" height="6" fill="#293b48" />
            </pattern>
          </defs>

          {/* striped background ring */}
          <circle
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke="url(#ga-loser-stripes)"
            strokeWidth="16"
          />

          {/* projected winner */}
          <circle
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke={winnerColor}
            strokeWidth="16"
            strokeDasharray={`${coloredLength} ${circumference}`}
            transform={
              winnerIsHome
                ? "rotate(-90 80 80)"
                : "translate(160 0) scale(-1 1) rotate(-90 80 80)"
            }
          />
        </svg>

        <div className="ga-wheel-center">
          <img
            src={`${import.meta.env.BASE_URL}logos/${awayTeam}.png`}
            alt={awayTeam}
          />

          <div className="ga-wheel-divider" />

          <img
            src={`${import.meta.env.BASE_URL}logos/${homeTeam}.png`}
            alt={homeTeam}
          />
        </div>
      </div>

      <div className="ga-wheel-side">
        <strong>{homeTeam}</strong>
        <span className={winnerIsHome ? "ga-favored" : ""}>
          {percent(homeProb)}
        </span>
      </div>
    </div>
  );
}


function App() {
  const [page, setPage] = useState(() => window.location.hash === "#performance" ? "performance" : window.location.hash === "#markets" ? "markets" : "dashboard");
  useEffect(() => {
    const navigate = () => setPage(window.location.hash === "#performance" ? "performance" : window.location.hash === "#markets" ? "markets" : "dashboard");
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  const [currentData, setCurrentData] = useState<PredictionData | null>(null);
  const [archivedData, setArchivedData] = useState<Record<string, PredictionData>>({});
  const [weeks, setWeeks] = useState<WeekEntry[]>([]);
  const [selectedWeek, setSelectedWeek] = useState("current");
  const [preferredModel, setModel] = useState<Model>("v5_qb_plus");
  const data = selectedWeek === "current" ? currentData : archivedData[selectedWeek] ?? null;
  const archived = selectedWeek !== "current";
  const modelOptions = availableModels(data?.games ?? [], archived);
  const model: Model = modelOptions.includes(preferredModel) ? preferredModel : modelOptions[0] ?? "v4_a";
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("date");
  const [error, setError] = useState("");
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [focusedGameId, setFocusedGameId] = useState<string | null>(null);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}predictions.json`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Could not load predictions.json");
        }
        return response.json();
      })
      .then((result: PredictionData) => {
        setCurrentData(result);
      })
      .catch((err) => {
        setError(err.message);
      });
  }, []);
  useEffect(() => {
    let active = true;
    fetch(`${import.meta.env.BASE_URL}prediction_weeks.json`)
      .then(r => { if (!r.ok) throw Error("Archive index unavailable"); return r.json(); })
      .then((value: {weeks: WeekEntry[]}) => { if (active) setWeeks(value.weeks); })
      .catch(() => { /* Current predictions remain usable if no archive has been exported. */ });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (selectedWeek === "current" || archivedData[selectedWeek]) return;
    const entry = weeks.find(w => `${w.season}-${w.week}` === selectedWeek);
    if (!entry || !/^predictions\/\d{4}-week-\d{1,2}\.json$/.test(entry.file)) return;
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}${entry.file}`, {signal: controller.signal})
      .then(r => { if (!r.ok) throw Error("Saved week unavailable"); return r.json(); })
      .then((value: PredictionData) => {
        if (!controller.signal.aborted) setArchivedData(previous => ({...previous, [selectedWeek]: value}));
      })
      .catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [selectedWeek, weeks, archivedData]);
  const games = useMemo(() => {
    if (!data) return [];
    const query = search.toLowerCase().trim();
    const filtered = data.games.filter((game) => {
      const names = [
        game.home_team,
        game.away_team,
        teams[game.home_team],
        teams[game.away_team],
      ]
        .join(" ")
        .toLowerCase();
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
const focusedGame =
  games.find((game) => game.game_id === focusedGameId) ??
  games[0] ??
  null;
  return (
    <div className="app dashboard-shell">
      {/* sidebar */}
      <aside className="dash-sidebar">
        <div className="dash-brand">
          <div className="brand-logo">
            <div className="brand-scene">
              <img
                src={playerBody}
                alt=""
                className="brand-player-body"
              />
              <img
                src={football}
                alt=""
                className="brand-football"
              />
            </div>
            <span className="brand-text">
              ntercepted
            </span>
          </div>
        </div>
        <nav className="dash-nav" aria-label="Main navigation">
          <a
            href="#dashboard"
            className={`dash-nav-item${page === "dashboard" ? " active" : ""}`}
          >
            <span className="dash-nav-icon">⌂</span>
            <span className="dash-nav-label">Dashboard</span>
          </a>
          <a
            href="#matchups"
            className="dash-nav-item"
          >
            <span className="dash-nav-icon">◉</span>
            <span className="dash-nav-label">Matchups</span>
          </a>
          <a href="#performance" className={`dash-nav-item${page === "performance" ? " active" : ""}`} aria-current={page === "performance" ? "page" : undefined}>
            <span className="dash-nav-icon">▥</span><span className="dash-nav-label">Performance</span>
          </a>
          <span className="dash-nav-item disabled">
            <span className="dash-nav-icon">⌁</span>
            <span className="dash-nav-label">Players</span>
          </span>
          <a href="#markets" className={`dash-nav-item${page === "markets" ? " active" : ""}`} aria-current={page === "markets" ? "page" : undefined}>
            <span className="dash-nav-icon">↗</span><span className="dash-nav-label">Markets</span>
          </a>
        </nav>
        <div className="dash-sidebar-bottom">
          <div className="dash-side-note">
            <strong>INTERCEPTED</strong>
            <p>
              NFL forecasts powered by team efficiency
              and quarterback analytics.
            </p>
          </div>
        </div>
      </aside>
      {/* main dashboard */}
      <div className="dash-workspace">
        {/* top navigation */}
        <div className="dash-topbar">
          <input
            className="dash-search"
            type="search"
            placeholder="Search teams or matchups..."
            aria-label="Search teams or matchups"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="dash-topbar-right">
            <span className="dash-week">
              Week {data?.week ?? "—"}
            </span>
            <span className="dash-season">
              {data?.season ?? "—"} Season
            </span>
          </div>
        </div>
        <main className="container" id="dashboard">
          {page === "performance" ? <PerformancePage /> : page === "markets" ? <MarketsPage /> : <>
          {/* hero */}
          <section className="hero-banner">
  <div className="hero-copy">
    <p className="hero-eyebrow">NFL INSIGHTS. SMARTER PICKS.</p>

    <h1 className="hero-title">
      Turn Data
      <br />
      Into an <span>Edge.</span>
    </h1>

    <p className="hero-description">
      NFL win probabilities powered by historical team performance,
      advanced efficiency metrics, and quarterback analytics.
    </p>

    <div className="hero-stats">
      <div className="hero-stat-card">
        <span>SEASON</span>
        <strong>{data?.season ?? "—"}</strong>
      </div>
      <div className="hero-stat-card">
        <span>WEEK</span>
        <strong>{data?.week ?? "—"}</strong>
      </div>
      <div className="hero-stat-card">
        <span>MATCHUPS</span>
        <strong>{data?.count ?? "—"}</strong>
      </div>
    </div>
  </div>

  <div className="hero-visual">
    <div className="hero-visual-glow" />
    <img
      src={heroPlayer}
      alt="Quarterback hero"
      className="hero-player-image"
    />
  </div>
</section>
{data && !archived && (
  <ScoreTicker
    games={data.games}
    season={data.season}
    week={data.week}
    model={model}
    onSelect={(gameId) => {
      const game = data.games.find((candidate) => candidate.game_id === gameId);
      if (game) { setFocusedGameId(gameId); setSelectedGame(game); }
    }}
  />
)}
{/* dashboard metrics */}
<section className="dash-kpi-grid">
  {[
    {
      icon: "◎",
      label: "Model Accuracy",
      value: "—",
      detail: "Historical performance",
    },
    {
      icon: "◈",
      label: "Prediction Record",
      value: "—",
      detail: "Correct vs. incorrect",
    },
    {
      icon: "↗",
      label: "Model vs. Vegas",
      value: "—",
      detail: "Market comparison",
    },
    {
      icon: "▥",
      label: "Games Forecasted",
      value: data?.count?.toString() ?? "—",
      detail: `Week ${data?.week ?? "—"} · ${data?.season ?? "—"}`,
    },
  ].map((metric) => (
    <div className="dash-kpi-card" key={metric.label}>
      <div className="dash-kpi-icon">{metric.icon}</div>
      <div className="dash-kpi-content">
        <span>{metric.label}</span>
        <strong>{metric.value}</strong>
        <small>{metric.detail}</small>
      </div>
      <span className="dash-placeholder-tag">SOON</span>
    </div>
  ))}
</section>
          {/* predictions */}
          <section
            className="forecast-section"
            id="matchups"
          >
            
<div className="section-heading">
  <div>
    <p className="eyebrow">THE FORECAST</p>
    <h2>Weekly matchups</h2>
  </div>

  <div className="forecast-controls">
    <label className="prediction-week-label">Prediction week
      <select className="forecast-sort" value={selectedWeek} onChange={event => {
        setSelectedWeek(event.target.value); setSelectedGame(null); setFocusedGameId(null); setError("");
      }}>
        <option value="current">Current · {currentData?.season ?? "—"} Week {currentData?.week ?? "—"}</option>
        {weeks.filter(w => w.season !== currentData?.season || w.week !== currentData?.week).map(w =>
          <option key={`${w.season}-${w.week}`} value={`${w.season}-${w.week}`}>{w.season} · Week {w.week} (saved)</option>)}
      </select>
    </label>
    <select
      className="forecast-sort"
      value={sort}
      onChange={(event) => setSort(event.target.value)}
      aria-label="Sort matchups"
    >
      <option value="date">Game date</option>
      <option value="confidence">Highest confidence</option>
      <option value="closest">Closest matchups</option>
    </select>

    <div className="model-switch" aria-label="Forecast model">
      {modelOptions.map(option => <button key={option} type="button"
        className={model === option ? "active" : ""} aria-pressed={model === option}
        onClick={() => setModel(option)}>{MODEL_LABELS[option]}</button>)}
    </div>
  </div>
</div>

          
            {archived && <p className="prediction-history-note">Saved pregame forecasts · {data?.policy ?? "Loading saved week…"} Models created later are unavailable for this week.</p>}
            {/* loading and errors */}
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
            {/* matchup cards */}
{data && games.length > 0 && (
  <div className="dash-analysis-grid">
    <section className="dash-panel">
      <div className="dash-panel-heading">
        <div>
          <h3>Week {data.week} Matchups</h3>
          <p>{games.length} games · NFL {data.season}</p>
        </div>
        <span className="dash-panel-label">PREDICTIONS</span>
      </div>
      <div className="dash-table-scroll">
        <table className="dash-matchup-table">
          <thead>
            <tr>
              <th>DATE</th>
              <th>MATCHUP</th>
              <th>INTERCEPTED PICK</th>
              <th>WIN PROB.</th>
              {archived && <th>RESULT</th>}
            </tr>
          </thead>
          <tbody>
            {games.map((game) => {
              const home = probability(game, model);
              const away = 1 - home;
              const winner =
                home >= 0.5 ? game.home_team : game.away_team;
              const selected =
                focusedGame?.game_id === game.game_id;
              const date = new Date(
                `${game.game_date}T12:00:00`
              );
              return (
                <tr
                  key={game.game_id}
                  className={selected ? "dash-row-active" : ""}
                  onClick={() => setFocusedGameId(game.game_id)}
                >
                  <td>
                    {date.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                  <td>
                    <div className="dash-matchup-teams">
                      <img
                        src={`${import.meta.env.BASE_URL}logos/${game.away_team}.png`}
                        alt=""
                      />
                      <strong>{game.away_team}</strong>
                      <span>@</span>
                      <img
                        src={`${import.meta.env.BASE_URL}logos/${game.home_team}.png`}
                        alt=""
                      />
                      <strong>{game.home_team}</strong>
                    </div>
                  </td>
                  <td>
                    <div className="dash-pick">
                      <img
                        src={`${import.meta.env.BASE_URL}logos/${winner}.png`}
                        alt=""
                      />
                      <span>{teams[winner] ?? winner}</span>
                    </div>
                  </td>
                  <td>
                    <span className="dash-prob-pill">
                      {percent(Math.max(home, away))}
                    </span>
                  </td>
                  {archived && <td>{game.result?.status === "final" ?
                    <><strong>{game.result.away_score}–{game.result.home_score}</strong><small>
                    {game.result.home_score === game.result.away_score ? "Tie" :
                      (winner === (Number(game.result.home_score) > Number(game.result.away_score) ? game.home_team : game.away_team) ? "Correct" : "Incorrect")}</small></> :
                    game.result?.status ?? "Pending"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
    {focusedGame && (
      <section className="dash-panel dash-game-analysis">
        <div className="dash-panel-heading">
          <div>
            <h3>Game Analysis</h3>
            <p>Intercepted · Week {focusedGame.week}</p>
          </div>
        </div>
        
<div className="dash-analysis-teams">
  <div className="dash-analysis-team">
    <img
      src={`${import.meta.env.BASE_URL}logos/${focusedGame.away_team}.png`}
      alt=""
    />

    <div className="dash-analysis-team-info">
      <strong>{focusedGame.away_team}</strong>
      <span>
        {focusedGame.away_projected_qb_name ?? "QB TBD"}
        <small>{focusedGame.away_qb_selection?.status === "reported_expected" ? "Expected starter" : focusedGame.away_qb_selection?.status === "confirmed" ? "Confirmed starter" : "Unconfirmed QB projection"}</small>
      </span>
    </div>
  </div>

  <span className="dash-analysis-at">@</span>

  <div className="dash-analysis-team">
    <img
      src={`${import.meta.env.BASE_URL}logos/${focusedGame.home_team}.png`}
      alt=""
    />

    <div className="dash-analysis-team-info">
      <strong>{focusedGame.home_team}</strong>
      <span>
        {focusedGame.home_projected_qb_name ?? "QB TBD"}
        <small>{focusedGame.home_qb_selection?.status === "reported_expected" ? "Expected starter" : focusedGame.home_qb_selection?.status === "confirmed" ? "Confirmed starter" : "Unconfirmed QB projection"}</small>
      </span>
    </div>
  </div>
</div>
        
        <ProbabilityWheel
  awayTeam={focusedGame.away_team}
  homeTeam={focusedGame.home_team}
  homeProb={probability(focusedGame, model)}
/>

        <button
          type="button"
          className="dash-details-button"
          onClick={() => setSelectedGame(focusedGame)}
        >
          Full matchup analysis →
        </button>
      </section>
    )}
  </div>
)}
</section>
{/* dashboard bottom panels */}
{!archived && <section className="dash-bottom-grid">
<DashboardPlayers />

<DashboardMarkets
  game={focusedGame}
  model={model}
/>
</section>}
          </>}
          {/* footer */}
          <footer className="footer">
            <div className="brand">
              <div className="brand-icon">I.</div>
              <span>INTERCEPTED</span>
            </div>
            <p>
              Predictions are statistical estimates, not
              guarantees. Projected quarterbacks and inputs
              may change before kickoff.
            </p>
          </footer>
        </main>
        {/* matchup popup */}
        {selectedGame && (
          <MatchupModal
            game={selectedGame}
            archived={archived}
            model={model}
            onClose={() => setSelectedGame(null)}
          />
        )}
      </div>
    </div>
  );
}
export default App;
