import type { PredictionFields } from "./predictionModels";

export type QbSelection = {status: string; ngs_coverage_note?: string; ngs_through_season?: number; ngs_through_week?: number};
export type Game = PredictionFields & {
  result?: {status: string; home_score: number | null; away_score: number | null};
  game_id: string;
  season: number;
  week: number;
  game_date: string;
  home_team: string;
  away_team: string;
  predicted_winner: string;
  predicted_winner_probability: number;
  away_win_prob_v4_a: number;
  away_win_prob_v4_qb_plus: number;
  qb_probability_impact: number;
  home_qb_selection?: QbSelection;
  away_qb_selection?: QbSelection;
  home_projected_qb_name?: string | null;
  away_projected_qb_name?: string | null;
};
export type PredictionData = {
  generated_at?: string;
  season: number;
  week: number;
  count: number;
  archived?: boolean;
  policy?: string;
  games: Game[];
};
