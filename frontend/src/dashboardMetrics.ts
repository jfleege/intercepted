import { availableModels, probability } from './predictionModels.ts';
import type { Model, PredictionFields } from './predictionModels.ts';

export type RecordRow = {
  game_id: string; season: number; week: number; game_date: string;
  grade: string;
};
export type PerformanceFeed = {
  schema_version: number;
  datasets: { verified: Partial<Record<Model, { rows: RecordRow[] }>> };
};

// The live dashboard uses only first-saved, verified pregame forecasts.
// Never substitute backtests or a newer model's in-sample results.
export function seasonRecord(rows: RecordRow[], season: number, throughWeek: number) {
  const unique = new Map<string, RecordRow>();
  for (const row of rows) {
    if (row.season === season && row.week <= throughWeek && !unique.has(row.game_id)) unique.set(row.game_id, row);
  }
  const forecasts = [...unique.values()].sort((a, b) => a.game_date.localeCompare(b.game_date) || a.game_id.localeCompare(b.game_id));
  const graded = forecasts.filter(row => row.grade === 'correct' || row.grade === 'incorrect');
  let correct = 0;
  const trend = graded.map((row, i) => {
    if (row.grade === 'correct') correct++;
    return correct / (i + 1);
  });
  const weekly = [...new Set(forecasts.map(row => row.week))].sort((a, b) => a - b).map(week => {
    const games = forecasts.filter(row => row.week === week);
    return { week, total: games.length, correct: games.filter(row => row.grade === 'correct').length,
      incorrect: games.filter(row => row.grade === 'incorrect').length };
  });
  const completed = weekly.filter(w => w.correct + w.incorrect > 0);
  const last = completed.at(-1), previous = completed.at(-2);
  const delta = last && previous
    ? last.correct / (last.correct + last.incorrect) - previous.correct / (previous.correct + previous.incorrect) : null;
  return { total: forecasts.length, correct, incorrect: graded.length - correct, graded: graded.length,
    pending: forecasts.filter(row => row.grade === 'pending').length,
    excluded: forecasts.filter(row => !['correct', 'incorrect', 'pending'].includes(row.grade)).length,
    accuracy: graded.length ? correct / graded.length : null, trend, weekly, delta,
    form: graded.slice(-14).map(row => ({ gameId: row.game_id, correct: row.grade === 'correct' })) };
}

type Matchup = PredictionFields & { game_id: string; home_team: string; away_team: string };
export function modelAgreement(games: Matchup[]) {
  const models = availableModels(games, true);
  if (models.length < 2) return { models, points: [], unanimous: 0, total: 0, rate: null };
  const points = games.map(game => {
    const homeVotes = models.filter(model => probability(game, model) >= .5).length;
    const votes = Math.max(homeVotes, models.length - homeVotes);
    return { gameId: game.game_id, home: game.home_team, away: game.away_team,
      votes, total: models.length, share: votes / models.length,
      pick: homeVotes * 2 === models.length ? null : homeVotes * 2 > models.length ? game.home_team : game.away_team };
  });
  const unanimous = points.filter(point => point.votes === models.length).length;
  return { models, points, unanimous, total: points.length, rate: points.length ? unanimous / points.length : null };
}
