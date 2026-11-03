import type { Game } from "./forecastTypes.ts";
import type { Model } from "./predictionModels.ts";
import { probability } from "./predictionModels.ts";
import { TEAM_NAMES } from "./teams.ts";

/** Search and sort a small weekly slate without mutating the saved forecasts. */
export function filterGames(games: Game[], model: Model, search: string, sort: string): Game[] {
    const query = search.toLowerCase().trim();
    const filtered = games.filter((game) => {
      const names = [
        game.home_team,
        game.away_team,
        TEAM_NAMES[game.home_team],
        TEAM_NAMES[game.away_team],
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
}
