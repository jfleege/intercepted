
from pathlib import Path

import numpy as np
import polars as pl

from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    log_loss,
)


# configuration
ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "processed"
OUTPUT_DIR = ROOT / "data" / "diagnostics"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

FIRST_TRAIN_SEASON = 2019
EVALUATION_SEASONS = [2022, 2023, 2024]

# v3 baseline features
V3_METRICS = [
    "blended_off_epa",
    "blended_def_epa",
]

# passing, rushing, and success rates
EFFICIENCY_METRICS = [
    "v4_off_pass_epa",
    "v4_off_run_epa",
    "v4_def_pass_epa",
    "v4_def_run_epa",
    "v4_off_pass_success",
    "v4_off_run_success",
    "v4_def_pass_success_allowed",
    "v4_def_run_success_allowed",
]

# interceptions and fumbles
TURNOVER_METRICS = [
    "v4_interception_rate",
    "v4_def_interception_rate",
    "v4_off_fumble_rate",
    "v4_off_fumble_lost_rate",
    "v4_def_fumble_rate",
    "v4_def_fumble_takeaway_rate",
]

# field goals and extra points
KICKING_METRICS = [
    "v4_fg_pct",
    "v4_fg_50_plus_pct",
    "v4_pat_pct",
    "v4_fg_avg_distance",
]

MODEL_METRICS = {
    "V3": V3_METRICS,
    "V4-A": V3_METRICS + EFFICIENCY_METRICS,
    "V4-B": (
        V3_METRICS
        + EFFICIENCY_METRICS
        + TURNOVER_METRICS
    ),
    "V4-C": (
        V3_METRICS
        + EFFICIENCY_METRICS
        + TURNOVER_METRICS
        + KICKING_METRICS
    ),
}


# load historical matchups and v4 features
matchups = pl.read_parquet(
    DATA_DIR / "ml_matchups_v2_2019_2026.parquet"
)

v4 = pl.read_parquet(
    DATA_DIR / "pregame_features_v4_2019_2026.parquet"
)

assert matchups["game_id"].n_unique() == matchups.height
assert v4.select(
    pl.struct(["game_id", "team"]).n_unique()
).item() == v4.height

# existing matchup file already includes v3's
# home and away blended epa features.
df = matchups.select([
    "game_id",
    "season",
    "week",
    "home_team",
    "away_team",
    "home_win",
    *[
        f"{side}_{metric}"
        for side in ["home", "away"]
        for metric in V3_METRICS
    ],
])

# prepare v4 features for home and away joins
all_v4_metrics = (
    EFFICIENCY_METRICS
    + TURNOVER_METRICS
    + KICKING_METRICS
)

home = v4.select(
    "game_id",
    pl.col("team").alias("home_team"),
    *[
        pl.col(metric).alias(f"home_{metric}")
        for metric in all_v4_metrics
    ],
)

away = v4.select(
    "game_id",
    pl.col("team").alias("away_team"),
    *[
        pl.col(metric).alias(f"away_{metric}")
        for metric in all_v4_metrics
    ],
)

df = (
    df
    .join(
        home,
        on=["game_id", "home_team"],
        how="inner",
    )
    .join(
        away,
        on=["game_id", "away_team"],
        how="inner",
    )
    .sort(["season", "week", "game_id"])
)

assert df.height == matchups.height, (
    "Some historical matchups failed to join."
)

assert df["home_win"].is_in([0, 1]).all()

print(f"Loaded {df.height} historical matchups.")


# calculate home-minus-away feature differences
all_metrics = (
    V3_METRICS
    + EFFICIENCY_METRICS
    + TURNOVER_METRICS
    + KICKING_METRICS
)

df = df.with_columns([
    (
        pl.col(f"home_{metric}")
        - pl.col(f"away_{metric}")
    ).alias(f"diff_{metric}")
    for metric in all_metrics
])

feature_columns = [
    f"diff_{metric}"
    for metric in all_metrics
]

assert df.select(
    pl.all_horizontal([
        pl.col(name).is_finite()
        for name in feature_columns
    ]).all()
).item(), "Missing or non-finite model features."

# prepare fixed feature matrices
FEATURES = {
    name: df.select([
        f"diff_{metric}"
        for metric in metrics
    ]).to_numpy()
    for name, metrics in MODEL_METRICS.items()
}

seasons = df["season"].to_numpy()
outcomes = df["home_win"].to_numpy().astype(int)


# model functions
def make_model():
    return Pipeline([
        ("scaler", StandardScaler()),
        ("classifier", LogisticRegression(
            max_iter=1000,
            random_state=42,
        )),
    ])


def evaluate(actual, probabilities):
    predicted = (
        probabilities >= 0.5
    ).astype(int)

    return {
        "games": len(actual),
        "accuracy": accuracy_score(
            actual, predicted
        ),
        "brier": brier_score_loss(
            actual, probabilities
        ),
        "log_loss": log_loss(
            actual, probabilities,
            labels=[0, 1]
        ),
    }


# walk-forward evaluation
summary = []
predictions = []

for evaluation_year in EVALUATION_SEASONS:
    print(f"\n{'=' * 60}")
    print(f"EVALUATING {evaluation_year}")
    print(f"{'=' * 60}")

    train_mask = (
        (seasons >= FIRST_TRAIN_SEASON)
        & (seasons < evaluation_year)
    )

    test_mask = (
        seasons == evaluation_year
    )

    assert train_mask.sum() > 0
    assert test_mask.sum() > 0

    y_train = outcomes[train_mask]
    y_test = outcomes[test_mask]

    print(
        f"Training games: {train_mask.sum()} | "
        f"Evaluation games: {test_mask.sum()}"
    )

    results = {}

    season_predictions = df.filter(
        pl.col("season") == evaluation_year
    ).select([
        "game_id",
        "season",
        "week",
        "home_team",
        "away_team",
        "home_win",
    ])

    for name, X in FEATURES.items():
        model = make_model()

        model.fit(
            X[train_mask],
            y_train
        )

        probabilities = model.predict_proba(
            X[test_mask]
        )[:, 1]

        result = evaluate(
            y_test, probabilities
        )

        results[name] = result

        season_predictions = (
            season_predictions.with_columns(
                pl.Series(
                    f"prob_{name.lower().replace('-', '_')}",
                    probabilities,
                )
            )
        )

        print(
            f"{name:<6} "
            f"features={X.shape[1]:>2} | "
            f"accuracy={result['accuracy']:.3f} | "
            f"Brier={result['brier']:.4f} | "
            f"log loss={result['log_loss']:.4f}"
        )

    # compare each model against v3 on the same games
    for name, result in results.items():
        summary.append({
            "season": evaluation_year,
            "model": name,
            "features": FEATURES[name].shape[1],
            "games": result["games"],
            "accuracy": result["accuracy"],
            "brier": result["brier"],
            "log_loss": result["log_loss"],
            "brier_vs_v3": (
                result["brier"]
                - results["V3"]["brier"]
            ),
        })

    predictions.append(season_predictions)


# combine all evaluation seasons
summary_df = pl.DataFrame(summary)

predictions_df = (
    pl.concat(predictions)
    .sort(["season", "week", "game_id"])
)

print(f"\n{'=' * 60}")
print("COMBINED OUT-OF-SAMPLE PERFORMANCE")
print(f"{'=' * 60}")

actual = predictions_df[
    "home_win"
].to_numpy()

combined = []

for name, X in FEATURES.items():
    column_name = (
        f"prob_{name.lower().replace('-', '_')}"
    )

    probabilities = predictions_df[
        column_name
    ].to_numpy()

    result = evaluate(
        actual, probabilities
    )

    combined.append({
        "model": name,
        "features": X.shape[1],
        "games": result["games"],
        "accuracy": result["accuracy"],
        "brier": result["brier"],
        "log_loss": result["log_loss"],
    })

combined_df = pl.DataFrame(combined)

v3_brier = combined_df.filter(
    pl.col("model") == "V3"
)["brier"][0]

combined_df = (
    combined_df
    .with_columns(
        (
            pl.col("brier") - v3_brier
        ).alias("brier_vs_v3")
    )
    .sort("brier")
)

print(combined_df)


# compare v3 predictions with the existing benchmark
reference_path = (
    OUTPUT_DIR / "walk_forward_predictions.csv"
)

if reference_path.exists():
    reference = pl.read_csv(
        reference_path
    ).select([
        "game_id",
        "predicted_home_win",
    ])

    comparison = predictions_df.join(
        reference,
        on="game_id",
        how="inner",
    )

    assert comparison.height == predictions_df.height, (
        "V3 reference predictions are missing games."
    )

    max_difference = comparison.select(
        (
            pl.col("prob_v3")
            - pl.col("predicted_home_win")
        ).abs().max()
    ).item()

    print(
        f"\nV3 benchmark maximum probability "
        f"difference: {max_difference:.10f}"
    )

    assert max_difference < 1e-8, (
        "V3 predictions differ from the saved benchmark."
    )

    print("PASS: V3 benchmark reproduced.")


# save results
summary_df.write_csv(
    OUTPUT_DIR / "v4_season_summary.csv"
)

combined_df.write_csv(
    OUTPUT_DIR / "v4_combined_summary.csv"
)

predictions_df.write_csv(
    OUTPUT_DIR / "v4_predictions.csv"
)

print("\nSUCCESS: V4 model comparison completed.")
print(
    f"Saved {predictions_df.height} "
    "out-of-sample predictions."
)
