import { filterGames } from "./matchupFilters";
import { useEffect, useState } from "react";
import "./App.css";
import "./DashboardLayout.css";
import { availableModels, MODEL_LABELS } from "./predictionModels";
import type { Model } from "./predictionModels";
import "./PredictionHistory.css";
import MatchupModal from "./MatchupModal";
import playerBody from "./assets/playeronly.png";
import football from "./assets/ball.png";
import HeroPlaybook from "./HeroPlaybook";
import DashboardPlayers from "./DashboardPlayers";
import DashboardMarkets from "./DashboardMarkets";
import ScoreTicker from "./ScoreTicker";
import DashboardMetrics from "./DashboardMetrics";
import PerformancePage from "./PerformancePage";
import MarketsPage from "./MarketsPage";
import WeeklyMatchups from "./WeeklyMatchups";
import MatchupsPage from "./MatchupsPage";
import "./UnifiedDashboard.css";
import "./HeroPlaybook.css";

import type { Game, PredictionData } from "./forecastTypes";
type WeekEntry = {season: number; week: number; file: string; count: number};

function App() {
  const [page, setPage] = useState(() => window.location.hash === "#performance" ? "performance" : window.location.hash === "#markets" ? "markets" : window.location.hash === "#matchups" ? "matchups" : "dashboard");
  useEffect(() => {
    const navigate = () => setPage(window.location.hash === "#performance" ? "performance" : window.location.hash === "#markets" ? "markets" : window.location.hash === "#matchups" ? "matchups" : "dashboard");
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
  const games = filterGames(data?.games ?? [], model, search, sort);
const focusedGame =
  games.find((game) => game.game_id === focusedGameId) ??
  games[0] ??
  null;
  const weekControl = (
    <label className="prediction-week-label">Prediction week
      <select className="forecast-sort" value={selectedWeek} onChange={event => {
        setSelectedWeek(event.target.value); setSelectedGame(null); setFocusedGameId(null); setError("");
      }}>
        <option value="current">Current · {currentData?.season ?? "—"} Week {currentData?.week ?? "—"}</option>
        {weeks.filter(w => w.season !== currentData?.season || w.week !== currentData?.week).map(w =>
          <option key={`${w.season}-${w.week}`} value={`${w.season}-${w.week}`}>{w.season} · Week {w.week} (saved)</option>)}
      </select>
    </label>
  );
  return (
    <div className={`app dashboard-shell${(page === "dashboard" || page === "matchups" || page === "performance" || page === "markets") ? " unified-dashboard" : ""}`}>
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
            className={`dash-nav-item${page === "matchups" ? " active" : ""}`} aria-current={page === "matchups" ? "page" : undefined}
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
          {page === "performance" ? <PerformancePage /> : page === "markets" ? <MarketsPage search={search} /> : page === "matchups" ? <MatchupsPage data={data ? {...data, archived} : null} games={games} game={focusedGame} model={model} onSelect={setFocusedGameId} weekControl={weekControl} error={error}/> : <>
          <section className="ud-hero">
            <div className="ud-hero-copy"><p className="ud-eyebrow">NFL ANALYTICS FROM EVERY ANGLE.</p><h1>EVERY MATCHUP<br/>MORE <em>PERSPECTIVE.</em></h1><p>Explore statistical model predictions, analyze player trends, and track performance—all in one place.</p>
              <div className="ud-hero-meta"><span><b>{data?.week ?? '—'}</b> WEEK</span><span><b>{data?.count ?? '—'}</b> MATCHUPS</span><span><b>{modelOptions.length}</b> ACTIVE MODELS</span></div>
            </div>
            <HeroPlaybook games={data?.games ?? []} model={model} archived={archived} season={data?.season} week={data?.week}/>
          </section>
{data && (
  <ScoreTicker
    games={data.games}
    season={data.season}
    week={data.week}
    model={model}
    activeGameId={focusedGame?.game_id}
    onSelect={(gameId) => {
      const game = data.games.find((candidate) => candidate.game_id === gameId);
      if (game) { setFocusedGameId(gameId); setSelectedGame(game); }
    }}
  />
)}
<DashboardMetrics data={data} />
          {/* predictions */}
          <section
            className="forecast-section ud-forecast"
            id="weekly-matchups"
          >
            
<div className="ud-section-heading">
  <div>
    <p className="eyebrow">THE FORECAST</p>
    <h2>Weekly matchups</h2>
  </div>

  <div className="forecast-controls">
    {weekControl}
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
            {data && games.length > 0 && <WeeklyMatchups games={games} focusedGame={focusedGame} model={model} archived={archived} onFocus={setFocusedGameId} onAnalysis={setSelectedGame}/>}
            {data && !games.length && <p className="ud-empty">No matchups match your search.</p>}
</section>
{/* dashboard bottom panels */}
{!archived && <section className="ud-bottom-grid">
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
