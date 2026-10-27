import { probability } from "./predictionModels";
import type { Model, PredictionFields } from "./predictionModels";
import { useEffect, useMemo, useRef, useState } from "react";
import "./ScoreTicker.css";
import { possessionSide } from "./livePossession";
import type { PossessionCompetition } from "./livePossession";

type Forecast = PredictionFields & {
  game_id: string;
  game_date: string;
  home_team: string;
  away_team: string;
  result?: { status: string; home_score: number | null; away_score: number | null };
};
type Competitor = { id?: string; homeAway: string; score?: string; team: { id?: string; abbreviation: string } };
type ScoreEvent = {
  date: string;
  competitions: (PossessionCompetition & { competitors: Competitor[] })[];
  status: { type: { state: string; completed: boolean; shortDetail: string } };
};
type Scoreboard = { events: ScoreEvent[] };
type ScoreState = { season: number; week: number; events: ScoreEvent[]; updated: Date | null; failed: boolean };
type Props = {
  games: Forecast[];
  season: number;
  week: number;
  model: Model;
  activeGameId?: string;
  onSelect: (gameId: string) => void;
};

const EMPTY_EVENTS: ScoreEvent[] = [];

const aliases: Record<string, string> = { LAR: "LA", WSH: "WAS", JAC: "JAX" };
const normalize = (team: string) => aliases[team] ?? team;
const localDate = (value: string) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(value));

export default function ScoreTicker({ games, season, week, model, activeGameId, onSelect }: Props) {
  const [scores, setScores] = useState<ScoreState | null>(null);
  const current = scores?.season === season && scores.week === week ? scores : null;
  const feed = current?.events ?? EMPTY_EVENTS;
  const updated = current?.updated ?? null;
  const failed = current?.failed ?? false;
  const [paused, setPaused] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const motion = useRef({direction: 1, holdUntil: 0});
  const move = (direction: number) => {
    const element = scroller.current;
    if (!element) return;
    motion.current = {direction, holdUntil: performance.now() + 1800};
    if (track.current) track.current.style.transform = '';
    const width = element.querySelector('button')?.getBoundingClientRect().width ?? 174;
    const max = element.scrollWidth - element.clientWidth;
    element.scrollTo({left: Math.max(0, Math.min(element.scrollLeft + direction * width, max)),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  };
  useEffect(() => {
    const element = scroller.current, content = track.current;
    if (!element || !content || paused) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, last = 0, position = element.scrollLeft, velocity = 0;
    const hold = () => {motion.current.holdUntil = performance.now() + 1800;};
    function glide(time: number) {
      const elapsed = last ? Math.min(time - last, 64) : 0;
      last = time;
      const interacting = element!.closest('.score-ticker')?.matches(':hover, :focus-within');
      if (document.hidden || reduce.matches || interacting || time < motion.current.holdUntil) {
        position = element!.scrollLeft;
        velocity = 0;
        content!.style.transform = '';
      } else {
        const max = Math.max(0, content!.offsetWidth - element!.clientWidth);
        position = Math.max(0, Math.min(position, max));
        const direction = motion.current.direction;
        const distance = direction > 0 ? max - position : position;
        const target = direction * 24 * Math.min(1, Math.sqrt(Math.max(distance, 1) / 48));
        velocity += (target - velocity) * (1 - Math.exp(-elapsed / 220));
        position += velocity * elapsed / 1000;
        if (position >= max || position <= 0) {
          position = Math.max(0, Math.min(position, max));
          motion.current.direction = position >= max ? -1 : 1;
          motion.current.holdUntil = time + 900;
          velocity = 0;
        }
        element!.scrollLeft = position;
        // Native scroll positions can round to whole pixels. Keep the fractional
        // remainder on a composited layer for a smooth, subpixel glide.
        content!.style.transform = `translate3d(${element!.scrollLeft - position}px, 0, 0)`;
      }
      frame = requestAnimationFrame(glide);
    }
    for (const event of ['wheel', 'pointerdown', 'touchmove', 'keydown']) element.addEventListener(event, hold, {passive:true});
    frame = requestAnimationFrame(glide);
    return () => {
      cancelAnimationFrame(frame);
      content.style.transform = '';
      for (const event of ['wheel', 'pointerdown', 'touchmove', 'keydown']) element.removeEventListener(event, hold);
    };
  }, [paused, season, week, games.length]);


  useEffect(() => {
    let active = true;
    let busy = false;
    let controller: AbortController | undefined;
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
        if (active) setScores({season, week, events: result.events, updated: new Date(), failed: false});
      } catch {
        if (active) setScores(previous => {
          const sameWeek = previous?.season === season && previous.week === week;
          return {season, week, events: sameWeek ? previous.events : [],
            updated: sameWeek ? previous.updated : null, failed: true};
        });
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
    const savedFinal = game.result?.status === 'final' && game.result.home_score !== null && game.result.away_score !== null;
    const score = (side: string) => started ? (opponents.find(team => team.homeAway === side)?.score ?? "—")
      : savedFinal ? String(side === 'home' ? game.result!.home_score : game.result!.away_score) : "";
    let status = failed ? (updated ? "STALE SCORES" : "SCORES UNAVAILABLE") : "SCHEDULED";
    if (!failed && event) {
      status = state === "pre" ? new Intl.DateTimeFormat("en-US", {
        weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short",
      }).format(new Date(event.date)) : event.status.type.shortDetail;
    } else if (!failed && !updated) status = "LOADING SCORES";
    if (!started && savedFinal) status = 'FINAL · SAVED';
    const homeProb = probability(game, model);
    return { game, status, possession: possessionSide(event?.competitions?.[0], state, event?.status?.type?.completed, failed), live: state === "in" && !failed, homeScore: score("home"), awayScore: score("away"),
      pick: homeProb >= 0.5 ? game.home_team : game.away_team, probability: Math.max(homeProb, 1 - homeProb) };
  }), [games, feed, model, failed, updated]);

  if (!games.length) return null;
  return (
    <section className="score-ticker" aria-label={`Week ${week} NFL scoreboard`}>
      <div className="score-ticker-label"><strong>WEEK {week}</strong><span>NFL SCORES</span>
        <button type="button" className="score-ticker-arrow" onClick={() => move(-1)} aria-label="Previous score matchups">←</button>
      </div>
      <div className="score-ticker-window" ref={scroller}>
        <div className="score-ticker-glide" ref={track}>
        {items.map(item => (
          <button type="button" className={`score-ticker-game${activeGameId === item.game.game_id ? ' is-selected' : ''}`} key={item.game.game_id}
            onClick={() => onSelect(item.game.game_id)} aria-current={activeGameId === item.game.game_id ? 'true' : undefined}
            aria-label={`${item.game.away_team} ${item.awayScore}, ${item.game.home_team} ${item.homeScore}. ${item.status}.${item.possession ? ` ${item.game[item.possession === 'home' ? 'home_team' : 'away_team']} has possession.` : ''} Pregame pick ${item.pick} ${(item.probability * 100).toFixed(1)} percent. Open matchup analysis.`}>
            <span className="score-ticker-team"><img src={`${import.meta.env.BASE_URL}logos/${item.game.away_team}.png`} alt=""/><b>{item.game.away_team}{item.possession === "away" && <span className="score-ticker-possession" aria-hidden="true">🏈</span>}</b><strong>{item.awayScore}</strong></span>
            <span className="score-ticker-team"><img src={`${import.meta.env.BASE_URL}logos/${item.game.home_team}.png`} alt=""/><b>{item.game.home_team}{item.possession === "home" && <span className="score-ticker-possession" aria-hidden="true">🏈</span>}</b><strong>{item.homeScore}</strong></span>
            <span className={`score-ticker-status${item.live ? ' is-live' : ''}`}>{item.live && '● '}{item.status}</span>
          </button>
        ))}
        </div>
      </div>
      <div className="score-ticker-controls">
        <button type="button" className="score-ticker-arrow" onClick={() => move(1)} aria-label="Next score matchups">→</button>
        <button type="button" className="score-ticker-pause" onClick={() => setPaused(value => !value)} aria-label={paused ? "Resume scoreboard scrolling" : "Pause scoreboard scrolling"} aria-pressed={paused}>{paused ? "▶" : "Ⅱ"}</button>
      </div>
    </section>
  );
}
