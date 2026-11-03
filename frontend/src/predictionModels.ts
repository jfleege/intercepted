export type Model = "v4_a" | "v4_qb_plus" | "v5_qb_plus" | "v5_boosted";
export type PredictionFields = {
  home_win_prob_v4_a: number;
  home_win_prob_v4_qb_plus: number;
  home_win_prob_v5_qb_plus?: number;
  home_win_prob_v5_boosted?: number;
};
export const MODEL_LABELS: Record<Model, string> = {
  v5_qb_plus: "Updated QB+", v5_boosted: "Gradient Boosted",
  v4_a: "Base", v4_qb_plus: "QB+ (original)",
};
export const MODEL_ORDER: Model[] = ["v5_qb_plus", "v5_boosted", "v4_a", "v4_qb_plus"];
export function probability(game: PredictionFields, model: Model): number {
  const p = game[("home_win_prob_" + model) as keyof PredictionFields];
  if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) {
    throw Error("This model was not saved for the selected game.");
  }
  return p;
}
export function availableModels(games: PredictionFields[], archived = false): Model[] {
  const models = MODEL_ORDER.filter(m => games.length && games.every(g => {
    const p = g[("home_win_prob_" + m) as keyof PredictionFields];
    return typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1;
  }));
  return archived ? models : models.filter(m => m !== "v4_qb_plus" || !models.includes("v5_qb_plus"));
}
