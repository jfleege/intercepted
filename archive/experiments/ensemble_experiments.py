
from pathlib import Path

import numpy as np
import polars as pl

from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    log_loss,
)


# configuration
ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "data" / "diagnostics"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

FIRST_SELECTION_SEASON = 2022
EVALUATION_SEASONS = [2023, 2024]

# weight represents the share assigned to V3.
# the remaining share is assigned to Elo.
V3_WEIGHTS = np.round(
    np.arange(0.0, 1.01, 0.1), 2
)

# load existing out-of-sample predictions
df = pl.read_csv(
    OUTPUT_DIR / "elo_comparison_predictions.csv"
)

required_columns = [
    "game_id",
    "season",
    "week",
    "home_team",
    "away_team",
    "home_win",
    "predicted_home_win",
    "elo_home_win_probability",
]

assert all(
    column in df.columns
    for column in required_columns
), "Missing required prediction columns."

df = (
    df.select(required_columns)
    .sort(["season", "week", "game_id"])
)

assert df["game_id"].n_unique() == df.height
assert df["home_win"].is_in([0, 1]).all()

assert df.select(
    pl.all_horizontal([
        pl.col("predicted_home_win").is_finite(),
        pl.col("elo_home_win_probability").is_finite(),
    ]).all()
).item(), "Invalid model probabilities."

assert df.select(
    pl.all_horizontal([
        pl.col("predicted_home_win").is_between(0, 1),
        pl.col("elo_home_win_probability").is_between(0, 1),
    ]).all()
).item(), "Probabilities must be between 0 and 1."

required_seasons = (
    [FIRST_SELECTION_SEASON] + EVALUATION_SEASONS
)

assert all(
    df.filter(pl.col("season") == season).height > 0
    for season in required_seasons
), "Missing historical seasons."

assert all(
    season > FIRST_SELECTION_SEASON
    for season in EVALUATION_SEASONS
)

print(f"Loaded {df.height} out-of-sample predictions.")
print(f"Testing {len(V3_WEIGHTS)} ensemble weights.")


# ensemble functions
def blend_probabilities(v3, elo, weight):
    return (
        weight * v3
        + (1.0 - weight) * elo
    )


def evaluate(actual, probabilities):
    predictions = (
        probabilities >= 0.5
    ).astype(int)

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


def get_arrays(frame):
    actual = frame["home_win"].to_numpy()

    v3 = frame[
        "predicted_home_win"
    ].to_numpy()

    elo = frame[
        "elo_home_win_probability"
    ].to_numpy()

    return actual, v3, elo


# select weights using earlier seasons only
def select_weight(evaluation_year):
    historical = df.filter(
        (pl.col("season") >= FIRST_SELECTION_SEASON)
        & (pl.col("season") < evaluation_year)
    )

    assert historical.height > 0

    actual, v3, elo = get_arrays(historical)

    records = []

    for weight in V3_WEIGHTS:
        probabilities = blend_probabilities(
            v3, elo, weight
        )

        result = evaluate(
            actual, probabilities
        )

        records.append({
            "evaluation_season": evaluation_year,
            "v3_weight": float(weight),
            "elo_weight": float(1.0 - weight),
            "selection_games": result["games"],
            "selection_accuracy": result["accuracy"],
            "selection_brier": result["brier"],
            "selection_log_loss": result["log_loss"],
        })

    ranking = pl.DataFrame(records).sort([
        "selection_brier",
        "v3_weight",
    ])

    selected = float(
        ranking["v3_weight"][0]
    )

    return selected, ranking


# evaluate selected ensemble weights
summary = []
all_predictions = []
all_rankings = []

for season in EVALUATION_SEASONS:
    print(f"\n{'=' * 55}")
    print(f"EVALUATING {season}")
    print(f"{'=' * 55}")

    selected_weight, ranking = select_weight(
        season
    )

    all_rankings.append(ranking)

    print("\nTop weights from earlier seasons:")
    print(ranking.head(5))

    print(
        f"\nSelected weights: "
        f"V3={selected_weight:.0%}, "
        f"Elo={1.0 - selected_weight:.0%}"
    )

    test = df.filter(
        pl.col("season") == season
    )

    actual, v3, elo = get_arrays(test)

    selected_p = blend_probabilities(
        v3, elo, selected_weight
    )

    equal_p = blend_probabilities(
        v3, elo, 0.5
    )

    results = {
        "selected": evaluate(
            actual, selected_p
        ),
        "v3": evaluate(
            actual, v3
        ),
        "elo": evaluate(
            actual, elo
        ),
        "equal": evaluate(
            actual, equal_p
        ),
    }

    print(f"\nSeason {season} ({len(actual)} games)")

    for name, result in results.items():
        print(
            f"{name.upper():<10} "
            f"accuracy={result['accuracy']:.3f}, "
            f"Brier={result['brier']:.4f}, "
            f"log loss={result['log_loss']:.4f}"
        )

    summary.append({
        "season": season,
        "games": len(actual),
        "selected_v3_weight": selected_weight,
        "selected_elo_weight": 1.0 - selected_weight,
        "selected_accuracy": results["selected"]["accuracy"],
        "v3_accuracy": results["v3"]["accuracy"],
        "elo_accuracy": results["elo"]["accuracy"],
        "equal_accuracy": results["equal"]["accuracy"],
        "selected_brier": results["selected"]["brier"],
        "v3_brier": results["v3"]["brier"],
        "elo_brier": results["elo"]["brier"],
        "equal_brier": results["equal"]["brier"],
        "selected_log_loss": results["selected"]["log_loss"],
        "v3_log_loss": results["v3"]["log_loss"],
        "elo_log_loss": results["elo"]["log_loss"],
        "equal_log_loss": results["equal"]["log_loss"],
    })

    predictions = test.with_columns(
        pl.Series(
            "selected_probability",
            selected_p
        ),
        pl.Series(
            "equal_weight_probability",
            equal_p
        ),
        pl.lit(selected_weight).alias(
            "selected_v3_weight"
        ),
        pl.lit(1.0 - selected_weight).alias(
            "selected_elo_weight"
        ),
    )

    all_predictions.append(predictions)


# combined out-of-sample performance
summary_df = pl.DataFrame(summary)

predictions_df = (
    pl.concat(all_predictions)
    .sort(["season", "week", "game_id"])
)

rankings_df = pl.concat(all_rankings)

actual = predictions_df[
    "home_win"
].to_numpy()

probability_columns = {
    "Selected ensemble": "selected_probability",
    "V3": "predicted_home_win",
    "Elo": "elo_home_win_probability",
    "50/50 ensemble": "equal_weight_probability",
}

print(f"\n{'=' * 55}")
print("COMBINED OUT-OF-SAMPLE PERFORMANCE")
print(f"{'=' * 55}")

for name, column_name in probability_columns.items():
    probabilities = predictions_df[
        column_name
    ].to_numpy()

    result = evaluate(
        actual, probabilities
    )

    print(
        f"{name:<18} "
        f"accuracy={result['accuracy']:.3f}, "
        f"Brier={result['brier']:.4f}, "
        f"log loss={result['log_loss']:.4f}"
    )

print("\nSeason-by-season summary:")
print(
    summary_df.select([
        "season",
        "games",
        "selected_v3_weight",
        "selected_elo_weight",
        "selected_accuracy",
        "v3_accuracy",
        "selected_brier",
        "v3_brier",
        "selected_log_loss",
        "v3_log_loss",
    ])
)


# save results
summary_df.write_csv(
    OUTPUT_DIR / "ensemble_summary.csv"
)

predictions_df.write_csv(
    OUTPUT_DIR / "ensemble_predictions.csv"
)

rankings_df.write_csv(
    OUTPUT_DIR / "ensemble_weight_rankings.csv"
)

print("\nSUCCESS: Ensemble experiments completed.")
print(
    f"Saved {predictions_df.height} "
    "out-of-sample predictions."
)
