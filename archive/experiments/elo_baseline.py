
from pathlib import Path

import numpy as np
import polars as pl
import nflreadpy as nfl

from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    log_loss,
)


# configuration
ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "data" / "diagnostics"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

SEASONS = list(range(2019, 2025))
EVALUATION_SEASONS = [2022, 2023, 2024]

INITIAL_RATING = 1500.0
K_FACTOR = 20.0
HOME_ADVANTAGE = 65.0
OFFSEASON_CARRY = 0.67

TEAM_RENAMES = {
    "OAK": "LV",
    "SD": "LAC",
    "STL": "LA",
}

# load historical schedules
schedules = nfl.load_schedules(SEASONS)

games = (
    schedules.filter(
        (pl.col("game_type") == "REG")
        & pl.col("home_score").is_not_null()
        & pl.col("away_score").is_not_null()
    )
    .with_columns(
        pl.col("home_team").replace(TEAM_RENAMES),
        pl.col("away_team").replace(TEAM_RENAMES),
    )
)

# order games by date and kickoff time where available.
sort_columns = ["season", "gameday"]

if "gametime" in games.columns:
    sort_columns.append("gametime")

sort_columns.append("game_id")

games = games.sort(sort_columns)

assert games["game_id"].n_unique() == games.height


# elo functions
def expected_home_win(home_rating, away_rating):
    difference = (
        home_rating
        + HOME_ADVANTAGE
        - away_rating
    )

    return 1.0 / (
        1.0 + 10.0 ** (-difference / 400.0)
    )


def actual_home_result(home_score, away_score):
    if home_score > away_score:
        return 1.0

    if home_score < away_score:
        return 0.0

    return 0.5


def update_ratings(home_rating, away_rating, result):
    expected = expected_home_win(
        home_rating, away_rating
    )

    adjustment = K_FACTOR * (result - expected)

    return (
        home_rating + adjustment,
        away_rating - adjustment,
    )


def evaluate(actual, probabilities):
    predictions = (probabilities >= 0.5).astype(int)

    return {
        "games": len(actual),
        "accuracy": accuracy_score(
            actual, predictions
        ),
        "brier": brier_score_loss(
            actual, probabilities
        ),
        "log_loss": log_loss(
            actual, probabilities,
            labels=[0, 1]
        ),
    }


# calculate ratings chronologically
ratings = {}
current_season = None
records = []

for game in games.iter_rows(named=True):
    season = int(game["season"])

    # apply offseason regression at each season boundary.
    if current_season is not None and season != current_season:
        ratings = {
            team: (
                INITIAL_RATING
                + OFFSEASON_CARRY
                * (rating - INITIAL_RATING)
            )
            for team, rating in ratings.items()
        }

    current_season = season

    home_team = game["home_team"]
    away_team = game["away_team"]

    home_rating = ratings.get(
        home_team, INITIAL_RATING
    )
    away_rating = ratings.get(
        away_team, INITIAL_RATING
    )

    # these values exist BEFORE this game's result.
    probability = expected_home_win(
        home_rating, away_rating
    )

    result = actual_home_result(
        game["home_score"],
        game["away_score"]
    )

    records.append({
        "game_id": game["game_id"],
        "season": season,
        "week": game["week"],
        "home_team": home_team,
        "away_team": away_team,
        "home_rating_pre": home_rating,
        "away_rating_pre": away_rating,
        "elo_difference": (
            home_rating - away_rating
        ),
        "elo_home_win_probability": probability,
        "home_result": result,
    })

    # update ONLY after the pregame prediction.
    new_home, new_away = update_ratings(
        home_rating,
        away_rating,
        result
    )

    ratings[home_team] = new_home
    ratings[away_team] = new_away

elo_df = pl.DataFrame(records)

# keep all games while building ratings, including ties.
# exclude ties only when evaluating binary win probabilities.
elo_eval = elo_df.filter(
    pl.col("season").is_in(EVALUATION_SEASONS)
    & (pl.col("home_result") != 0.5)
)

assert elo_eval["game_id"].n_unique() == elo_eval.height


# load V3's existing walk-forward predictions
v3 = pl.read_csv(
    OUTPUT_DIR / "walk_forward_predictions.csv"
).select([
    "game_id",
    "home_win",
    "predicted_home_win",
])

comparison = elo_eval.join(
    v3,
    on="game_id",
    how="inner"
)

assert comparison.height == elo_eval.height, (
    "Elo and V3 evaluated different games."
)

assert comparison.select(
    (
        pl.col("home_result")
        == pl.col("home_win")
    ).all()
).item(), "Elo and V3 outcomes disagree."

# compare models on identical games
print("\nINTERCEPTED: ELO VS. V3")
print("=" * 55)

summary = []

for season in EVALUATION_SEASONS:
    subset = comparison.filter(
        pl.col("season") == season
    )

    actual = subset["home_win"].to_numpy()

    elo_p = subset[
        "elo_home_win_probability"
    ].to_numpy()

    v3_p = subset[
        "predicted_home_win"
    ].to_numpy()

    elo_metrics = evaluate(actual, elo_p)
    v3_metrics = evaluate(actual, v3_p)

    summary.append({
        "season": season,
        "games": len(actual),
        "elo_accuracy": elo_metrics["accuracy"],
        "v3_accuracy": v3_metrics["accuracy"],
        "elo_brier": elo_metrics["brier"],
        "v3_brier": v3_metrics["brier"],
        "elo_log_loss": elo_metrics["log_loss"],
        "v3_log_loss": v3_metrics["log_loss"],
    })

    print(f"\nSeason {season} ({len(actual)} games)")
    print(
        f"Elo: accuracy={elo_metrics['accuracy']:.3f}, "
        f"Brier={elo_metrics['brier']:.4f}, "
        f"log loss={elo_metrics['log_loss']:.4f}"
    )
    print(
        f"V3:  accuracy={v3_metrics['accuracy']:.3f}, "
        f"Brier={v3_metrics['brier']:.4f}, "
        f"log loss={v3_metrics['log_loss']:.4f}"
    )

# combined performance
actual = comparison["home_win"].to_numpy()

elo_total = evaluate(
    actual,
    comparison["elo_home_win_probability"].to_numpy()
)

v3_total = evaluate(
    actual,
    comparison["predicted_home_win"].to_numpy()
)

print("\n" + "=" * 55)
print("COMBINED RESULTS")

for name, result in [
    ("Elo", elo_total),
    ("V3", v3_total),
]:
    print(
        f"{name}: "
        f"accuracy={result['accuracy']:.3f}, "
        f"Brier={result['brier']:.4f}, "
        f"log loss={result['log_loss']:.4f}"
    )

# save results
pl.DataFrame(summary).write_csv(
    OUTPUT_DIR / "elo_comparison_summary.csv"
)

comparison.sort([
    "season", "week", "game_id"
]).write_csv(
    OUTPUT_DIR / "elo_comparison_predictions.csv"
)

elo_df.write_parquet(
    OUTPUT_DIR / "elo_historical_ratings.parquet"
)

print("\nSUCCESS: Elo benchmark completed.")
print(f"Compared {comparison.height} games.")
