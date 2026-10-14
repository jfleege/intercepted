import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import "./ScoreTicker.css";

type Forecast = {
  game_id: string;
  game_date: string;
  home_team: string;
  away_team: string;
  home_win_prob_v4_a: number;
  home_win_prob_v4_qb_plus: number;
};
type Competitor = { homeAway: string; score?: string; team: { abbreviation: string } };
type ScoreEvent = {
  date: string;
  competitions: { competitors: Competitor[] }[];
  status: { type: { state: string; completed: boolean; shortDetail: string } };
};
type Scoreboard = { events: ScoreEvent[] };
type Props = {
  games: Forecast[];
  season: number;
  week: number;
  model: "v4_a" | "v4_qb_plus";
  onSelect: (gameId: string) => void;
};

const aliases: Record<string, string> = { LAR: "LA", WSH: "WAS", JAC: "JAX" };
const normalize = (team: string) => aliases[team] ?? team;
const localDate = (value: string) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(value));

export default function ScoreTicker({ games, season, week, model, onSelect }: Props) {
  const [feed, setFeed] = useState<ScoreEvent[]>([]);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let active = true;
    let busy = false;
    let controller: AbortController | undefined;
    setFeed([]);
    setUpdated(null);
    setFailed(false);
    async function refresh() {
      if (busy || document.hidden) return;
      busy = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 10000);
      try {
        const params = new URLSearchParams({ dates: String(season), seasontype: "2", week: String(week) });
        const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Score feed unavailable");
        const result: Scoreboard = await response.json();
        if (!Array.isArray(result.events)) throw new Error("Invalid scoreboard");
        if (active) { setFeed(result.events); setUpdated(new Date()); setFailed(false); }
      } catch {
        if (active) setFailed(true);
      } finally { window.clearTimeout(timeout); busy = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60000);
    const resume = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", resume);
    return () => { active = false; controller?.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", resume); };
  }, [season, week]);

  const items = useMemo(() => games.map(game => {
    const event = feed.find(event => {
      const opponents = event.competitions?.[0]?.competitors ?? [];
      const home = opponents.find(team => team.homeAway === "home");
      const away = opponents.find(team => team.homeAway === "away");
      return home && away && normalize(home.team.abbreviation) === game.home_team
        && normalize(away.team.abbreviation) === game.away_team && localDate(event.date) === game.game_date;
    });
    const opponents = event?.competitions?.[0]?.competitors ?? [];
    const state = event?.status?.type?.state;
    const started = state === "in" || event?.status?.type?.completed;
    const score = (side: string) => started ? (opponents.find(team => team.homeAway === side)?.score ?? "—") : "—";
    let status = failed ? (updated ? "STALE SCORES" : "SCORES UNAVAILABLE") : "SCHEDULED";
    if (!failed && event) {
      status = state === "pre" ? new Intl.DateTimeFormat("en-US", {
        weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short",
      }).format(new Date(event.date)) : event.status.type.shortDetail;
    } else if (!failed && !updated) status = "LOADING SCORES";
    const homeProb = model === "v4_a" ? game.home_win_prob_v4_a : game.home_win_prob_v4_qb_plus;
    return { game, status, live: state === "in" && !failed, homeScore: score("home"), awayScore: score("away"),
      pick: homeProb >= 0.5 ? game.home_team : game.away_team, probability: Math.max(homeProb, 1 - homeProb) };
  }), [games, feed, model, failed, updated]);

  if (!games.length) return null;
  return (
    <section className="score-ticker" aria-label={`Week ${week} NFL scoreboard`}>
      <div className="score-ticker-label">
        <strong>NFL SCORES</strong>
        <span title={updated ? `Last checked ${updated.toLocaleString()}` : undefined}>{failed ? "Feed unavailable" : updated ? "ESPN · 60s refresh" : "Connecting…"}</span>
      </div>
      <div className="score-ticker-window">
        <div className={`score-ticker-track${paused ? " is-paused" : ""}`} style={{ "--ticker-duration": `${Math.max(35, games.length * 6)}s` } as CSSProperties}>
          {[0, 1].map(copy => (
            <div className="score-ticker-group" key={copy} aria-hidden={copy === 1 ? true : undefined}>
              {items.map(item => (
                <button type="button" className="score-ticker-game" key={item.game.game_id} tabIndex={copy === 1 ? -1 : 0}
                  onClick={() => onSelect(item.game.game_id)}
                  aria-label={`${item.game.away_team} ${item.awayScore}, ${item.game.home_team} ${item.homeScore}. ${item.status}. Pregame pick ${item.pick} ${(item.probability * 100).toFixed(1)} percent. Open matchup analysis.`}>
                  <span className="score-ticker-matchup">
                    <img src={`${import.meta.env.BASE_URL}logos/${item.game.away_team}.png`} alt="" />
                    <b>{item.game.away_team}</b><strong>{item.awayScore}</strong><span className="score-ticker-at">@</span>
                    <img src={`${import.meta.env.BASE_URL}logos/${item.game.home_team}.png`} alt="" />
                    <b>{item.game.home_team}</b><strong>{item.homeScore}</strong>
                  </span>
                  <span className="score-ticker-detail"><span className={item.live ? "score-ticker-live" : ""}>{item.live && "● "}{item.status}</span><span>Pregame: {item.pick} {(item.probability * 100).toFixed(1)}%</span></span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <button type="button" className="score-ticker-pause" onClick={() => setPaused(value => !value)} aria-label={paused ? "Resume scoreboard scrolling" : "Pause scoreboard scrolling"} aria-pressed={paused}>{paused ? "▶" : "Ⅱ"}</button>
    </section>
  );
}
