import { fetchSnapshot } from "./snapshotCache";
import { filterGames } from "./matchupFilters";
import { lazy, memo, useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import "./DashboardLayout.css";
import { availableModels, MODEL_LABELS } from "./predictionModels";
import type { Model } from "./predictionModels";
import "./PredictionHistory.css";
import MatchupModal from "./MatchupModal";
import HeroPlaybook from "./HeroPlaybook";
import DashboardPlayers from "./DashboardPlayers";
import DashboardMarkets from "./DashboardMarkets";
import ScoreTicker from "./ScoreTicker";
import RefreshStatus from "./RefreshStatus";
import PagePanel from "./PagePanel";
import SiteFooter from "./SiteFooter";
import {ForecastInsightsProvider} from "./ForecastInsightsContext";
import {ForecastChanges} from "./ForecastInsightPanels";
import LoadingSurface from "./LoadingSurface";
import DashboardMetrics from "./DashboardMetrics";
import WeeklyMatchups from "./WeeklyMatchups";
import "./UnifiedDashboard.css";
import "./HeroPlaybook.css";
import "./Brand.css";
import "./InterfacePolish.css";
import "./GlassTheme.css";

import type { Game, PredictionData } from "./forecastTypes";
type WeekEntry = {season: number; week: number; file: string; count: number};

const RetainedPlayers = memo(lazy(() => import("./PlayersPage"))), RetainedPerformance = memo(lazy(() => import("./PerformancePage"))), RetainedMarkets = memo(lazy(() => import("./MarketsPage"))), RetainedMatchups = memo(lazy(() => import("./MatchupsPage")));
const infoPages = ['methodology', 'privacy', 'terms'] as const;
const RetainedSiteInfo = memo(lazy(() => import('./SiteInfoPages')));
const routeNames = ['dashboard', 'matchups', 'performance', 'players', 'markets', ...infoPages];
const route = () => routeNames.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'dashboard';
function App() {
  const [page, setPage] = useState(route);
  const [visited, setVisited] = useState(() => new Set([route()]));
  const pageRef = useRef(page);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  useEffect(() => {
    const navigate = () => {
      const next = route();
      pageRef.current = next;
      setVisited(previous => new Set([...previous, next]));
      setPage(next); setSelectedGame(null);
    };
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    window.addEventListener("hashchange", navigate);
    return () => {window.removeEventListener("hashchange", navigate);window.history.scrollRestoration=previousRestoration;};
  }, []);
  useEffect(() => {
    const labels: Record<string,string> = {dashboard:'',players:'Players',performance:'Performance',markets:'Markets',matchups:'Matchups',methodology:'Models & data sources',privacy:'Privacy',terms:'Terms'};
    document.title = labels[page] ? `${labels[page]} | Intercepted` : 'Intercepted';
    const nav=document.querySelector<HTMLElement>('.dash-nav');
    const current=nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if(nav&&current&&nav.scrollWidth>nav.clientWidth){
      const bounds=current.getBoundingClientRect(),rail=nav.getBoundingClientRect();
      if(bounds.left<rail.left||bounds.right>rail.right)nav.scrollTo({left:nav.scrollLeft+bounds.left-rail.left-8,behavior:'instant'});
    }
  }, [page]);
  const [currentData, setCurrentData] = useState<PredictionData | null>(null);
  const [archivedData, setArchivedData] = useState<Record<string, PredictionData>>({});
  const [weeks, setWeeks] = useState<WeekEntry[]>([]);
  const [selectedWeek, setSelectedWeek] = useState("current");
  const [preferredModel, setModel] = useState<Model>("v5_qb_plus");
  const data = selectedWeek === "current" ? currentData : archivedData[selectedWeek] ?? null;
  const archived = selectedWeek !== "current";
  const modelOptions = availableModels(data?.games ?? [], archived);
  const model: Model = modelOptions.includes(preferredModel) ? preferredModel : modelOptions[0] ?? "v4_a";
  const [searches, setSearches] = useState<Record<string, string>>({});
  const search = searches[page] ?? '';
  const setPlayerSearch = useCallback((value: string) => setSearches(previous => ({...previous, players: value})), []);
  const setSearch = (value: string) => setSearches(previous => ({...previous, [pageRef.current]: value}));
  const [sort, setSort] = useState("date");
  const [error, setError] = useState("");
  const [focusedGameId, setFocusedGameId] = useState<string | null>(null);
  useEffect(() => {
    fetchSnapshot(`${import.meta.env.BASE_URL}predictions.json`)
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
    fetchSnapshot(`${import.meta.env.BASE_URL}prediction_weeks.json`)
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
    fetchSnapshot(`${import.meta.env.BASE_URL}${entry.file}`, {signal: controller.signal})
      .then(r => { if (!r.ok) throw Error("Saved week unavailable"); return r.json(); })
      .then((value: PredictionData) => {
        if (!controller.signal.aborted) setArchivedData(previous => ({...previous, [selectedWeek]: value}));
      })
      .catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [selectedWeek, weeks, archivedData]);
  const games = filterGames(data?.games ?? [], model, searches[page === "matchups" ? "matchups" : "dashboard"] ?? "", sort);
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
    <ForecastInsightsProvider><div className="app dashboard-shell unified-dashboard">
      <a className="skip-link" href="#page-content" onClick={event=>{event.preventDefault();document.getElementById("page-content")?.focus();}}>Skip to content</a>
      {/* sidebar */}
      <aside className="dash-sidebar" inert={!!selectedGame}>
        <div className="dash-brand">
          <a className="intercepted-brand" href="#dashboard" aria-label="Intercepted dashboard">
            <img className="intercepted-logo" src={`${import.meta.env.BASE_URL}brand/intercepted-logo.svg`} alt="Intercepted"/>
            <img className="intercepted-icon" src={`${import.meta.env.BASE_URL}brand/intercepted-icon.svg`} alt=""/>
          </a>
        </div>
        <nav className="dash-nav" aria-label="Main navigation">
          <a
            href="#dashboard"
            className={`dash-nav-item${page === "dashboard" ? " active" : ""}`} aria-current={page === "dashboard" ? "page" : undefined}
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
          <a href="#players" className={`dash-nav-item${page === "players" ? " active" : ""}`} aria-current={page === "players" ? "page" : undefined}><span className="dash-nav-icon">⌁</span><span className="dash-nav-label">Players</span></a>
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
        <div className="dash-topbar" inert={!!selectedGame}>
          {infoPages.some(name => name === page) ? <span className="info-topbar-title">About Intercepted</span> : <input
            className="dash-search"
            type="search"
            placeholder={page === "players" ? "Search players..." : "Search teams or matchups..."}
            aria-label={page === "players" ? "Search players or teams" : "Search teams or matchups"}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />}
          <div className="dash-topbar-right">
            <span className="dash-week">
              Week {data?.week ?? "—"}
            </span>
            <span className="dash-season">
              {data?.season ?? "—"} Season
            </span>
          </div>
        </div>
        <main className="container" id="dashboard" inert={!!selectedGame}>
          <div id="page-content" tabIndex={-1}/>
          <RefreshStatus season={currentData?.season} week={currentData?.week}/>
          {infoPages.filter(name => visited.has(name)).map(name => <PagePanel active={page === name} name={name} key={name}><RetainedSiteInfo page={name}/></PagePanel>)}
          {visited.has('players') && <PagePanel active={page === 'players'} name="players"><RetainedPlayers search={searches.players ?? ''} onSearch={setPlayerSearch}/></PagePanel>}
          {visited.has('performance') && <PagePanel active={page === 'performance'} name="performance"><RetainedPerformance/></PagePanel>}
          {visited.has('markets') && <PagePanel active={page === 'markets'} name="markets"><RetainedMarkets search={searches.markets ?? ''}/></PagePanel>}
          {visited.has('matchups') && <PagePanel active={page === 'matchups'} name="matchups"><RetainedMatchups data={data ? {...data, archived} : null} games={games} game={focusedGame} model={model} onSelect={setFocusedGameId} weekControl={weekControl} error={error}/></PagePanel>}
          {visited.has('dashboard') && <PagePanel active={page === 'dashboard'} name="dashboard">
          <section className="ud-hero">
            <div className="ud-hero-copy"><p className="ud-eyebrow">NFL ANALYTICS FROM EVERY ANGLE.</p><h1>EVERY MATCHUP<br/>MORE <em>PERSPECTIVE.</em></h1><p>Explore statistical model predictions, analyze player trends, and track performance—all in one place.</p>
              <div className="ud-hero-meta"><span><b>{data?.week ?? '—'}</b> WEEK</span><span><b>{data?.count ?? '—'}</b> MATCHUPS</span><span><b>{modelOptions.length}</b> ACTIVE MODELS</span></div>
            </div>
            <HeroPlaybook games={data?.games ?? []} model={model} archived={archived} season={data?.season} week={data?.week}/>
          </section>
{data ? (
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
) : <div className="score-ticker score-ticker-placeholder" role="status" aria-label="Loading scoreboard"><span>Loading scoreboard…</span></div>}
<DashboardMetrics data={data} />
{!archived && <ForecastChanges season={data?.season} week={data?.week}/>}
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
              <LoadingSurface label="Loading predictions" kind="matchups"/>
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
          </PagePanel>}
        </main>
        <SiteFooter inert={!!selectedGame}/>
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
    </div></ForecastInsightsProvider>
  );
}
export default App;
