
from pathlib import Path

import numpy as np
import polars as pl
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    log_loss
)

# configuration
DATA_DIR = Path("data/processed")
OUTPUT_DIR = Path("data/diagnostics")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

FIRST_TRAIN_SEASON = 2019
EVALUATION_SEASONS = [2022, 2023, 2024]

# load V3 matchup features
df = pl.read_parquet(
    DATA_DIR / "ml_matchups_v2_2019_2026.parquet"
)

# keep completed games without ties
df = df.filter(
    (pl.col("home_score") != pl.col("away_score"))
    & pl.col("home_score").is_not_null()
    & pl.col("away_score").is_not_null()
)

# build matchup-level differences
metrics = [
    "blended_off_epa",
    "blended_def_epa"
]

for metric in metrics:
    df = df.with_columns(
        (
            pl.col(f"home_{metric}")
            - pl.col(f"away_{metric}")
        ).alias(f"diff_{metric}")
    )

features = [f"diff_{metric}" for metric in metrics]

# validate our data before training
assert df["game_id"].n_unique() == df.height
assert df["home_win"].is_in([0, 1]).all()

assert df.select(
    pl.all_horizontal([
        pl.col(c).is_finite() for c in features
    ]).all()
).item(), "Missing or non-finite ML features"

# evaluation functions
def evaluate(y, probabilities):
    predictions = (probabilities >= 0.5).astype(int)

    return {
        "games": len(y),
        "accuracy": accuracy_score(y, predictions),
        "brier": brier_score_loss(y, probabilities),
        "log_loss": log_loss(
            y, probabilities, labels=[0, 1]
        )
    }


def print_results(name, results):
    print(f"\n{name}")
    print(f"Games: {results['games']}")
    print(f"Accuracy: {results['accuracy']:.3f}")
    print(f"Brier score: {results['brier']:.3f}")
    print(f"Log loss: {results['log_loss']:.3f}")

# walk-forward validation
all_predictions = []
summary = []

for evaluation_year in EVALUATION_SEASONS:

    print(f"\n{'=' * 55}")
    print(f"EVALUATING {evaluation_year}")
    print(f"{'=' * 55}")

    # train only on earlier seasons
    train = df.filter(
        pl.col("season").is_between(
            FIRST_TRAIN_SEASON,
            evaluation_year - 1
        )
    )

    # evaluate on the next season
    test = df.filter(
        pl.col("season") == evaluation_year
    ).sort(["week", "game_id"])

    assert train.height > 0
    assert test.height > 0
    assert train["season"].max() < evaluation_year

    X_train = train.select(features).to_numpy()
    y_train = train["home_win"].to_numpy()

    X_test = test.select(features).to_numpy()
    y_test = test["home_win"].to_numpy()

    print(
        f"Training: {FIRST_TRAIN_SEASON}"
        f"–{evaluation_year - 1} "
        f"({train.height} games)"
    )

    # train a new model for this evaluation year
    model = Pipeline([
        ("scaler", StandardScaler()),
        ("classifier", LogisticRegression(
            max_iter=1000,
            random_state=42
        ))
    ])

    model.fit(X_train, y_train)

    # predict probabilities for the evaluation season
    probabilities = model.predict_proba(X_test)[:, 1]

    model_results = evaluate(y_test, probabilities)

    # baseline: historical home-team win frequency
    home_rate = float(y_train.mean())

    baseline_probabilities = np.full(
        len(y_test), home_rate
    )

    baseline_results = evaluate(
        y_test, baseline_probabilities
    )

    print_results("Intercepted V3", model_results)
    print_results("Historical Home-Win Baseline", baseline_results)

    summary.append({
        "season": evaluation_year,
        "games": model_results["games"],
        "accuracy": model_results["accuracy"],
        "brier": model_results["brier"],
        "log_loss": model_results["log_loss"],
        "baseline_brier": baseline_results["brier"],
        "baseline_log_loss": baseline_results["log_loss"]
    })

    # store every forecast for later analysis
    predictions = (
        test.select([
            "game_id",
            "season",
            "week",
            "home_team",
            "away_team",
            "home_score",
            "away_score",
            "home_win"
        ])
        .with_columns(
            pl.Series("predicted_home_win", probabilities),
            pl.Series(
                "baseline_home_win",
                baseline_probabilities
            ),
            pl.lit(evaluation_year - 1)
              .alias("training_end_season")
        )
    )

    all_predictions.append(predictions)

# aggregate out-of-sample predictions
results_df = pl.DataFrame(summary)

predictions_df = pl.concat(
    all_predictions
).sort(["season", "week", "game_id"])

y_all = predictions_df["home_win"].to_numpy()

p_all = predictions_df[
    "predicted_home_win"
].to_numpy()

p_baseline = predictions_df[
    "baseline_home_win"
].to_numpy()

print(f"\n{'=' * 55}")
print("COMBINED OUT-OF-SAMPLE PERFORMANCE")
print(f"{'=' * 55}")

print_results(
    "Intercepted V3",
    evaluate(y_all, p_all)
)

print_results(
    "Historical Home-Win Baseline",
    evaluate(y_all, p_baseline)
)

print("\nYear-by-year summary:")
print(results_df)

# save results
results_df.write_csv(
    OUTPUT_DIR / "walk_forward_summary.csv"
)

predictions_df.write_csv(
    OUTPUT_DIR / "walk_forward_predictions.csv"
)

print("\nSUCCESS: Walk-forward validation completed.")
print(f"Predictions saved: {predictions_df.height}")
