import type { PerformanceFeed } from './dashboardMetrics.ts';
import type { Game, PredictionData } from './forecastTypes.ts';
import { matchingResearchGame } from './projectionMarkets.ts';
import type { Research } from './projectionMarkets.ts';

type GameResult = { kickoff: string | null; final: boolean; cancelled: boolean };
const gameDate = new Intl.DateTimeFormat('sv-SE', {timeZone: 'America/New_York'});

function earlierKickoff(a?: string | null, b?: string | null) {
  const first = Date.parse(a ?? ''), second = Date.parse(b ?? '');
  if (!Number.isFinite(first)) return Number.isFinite(second) ? b! : null;
  return Number.isFinite(second) && second < first ? b! : a!;
}

export function marketGameResults(data: PredictionData, research: Research | null, feed: PerformanceFeed | null) {
  const rows = Object.values(feed?.schema_version === 1 ? feed.datasets?.verified ?? {} : {})
    .flatMap(model => model.rows ?? []);
  const results = new Map<string, GameResult>();
  for (const game of data.games) {
    const status = rows.filter(row => row.game_id === game.game_id && row.season === game.season &&
      row.week === game.week && row.home_team === game.home_team && row.away_team === game.away_team);
    results.set(game.game_id, {
      kickoff: earlierKickoff(matchingResearchGame(data, research, game)?.kickoff,
        status.reduce<string | null>((start, row) => earlierKickoff(start, row.kickoff), null)),
      final: game.result?.status === 'final' || status.some(row => row.status === 'final'),
      cancelled: game.result?.status === 'cancelled' || status.some(row => row.status === 'cancelled'),
    });
  }
  return results;
}

export function marketGameOpen(result: GameResult | undefined, now: number) {
  return !!result && !result.final && !result.cancelled && Date.parse(result.kickoff ?? '') > now;
}

export function marketGameCard(game: Game, result: GameResult | undefined, now: number) {
  const open = marketGameOpen(result, now);
  const label = result?.final ? 'Final' : result?.cancelled ? 'Cancelled' : open ? 'Upcoming' :
    result?.kickoff ? 'Started' : game.game_date < gameDate.format(now) ? 'Closed' : 'Kickoff TBD';
  return {open, label};
}
