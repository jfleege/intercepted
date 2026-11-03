
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
FIRST_INNER_SEASON = 2021
EVALUATION_SEASONS = [2022, 2023, 2024]

C_VALUES = [0.001, 0.01, 0.1, 1.0, 10.0]
REFERENCE_C = 1.0

V3_METRICS = [
    "blended_off_epa",
    "blended_def_epa",
]

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

TURNOVER_METRICS = [
    "v4_interception_rate",
    "v4_def_interception_rate",
    "v4_off_fumble_rate",
    "v4_off_fumble_lost_rate",
    "v4_def_fumble_rate",
    "v4_def_fumble_takeaway_rate",
]

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


# calculate home-minus-away features
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
def make_model(c_value):
    return Pipeline([
        ("scaler", StandardScaler()),
        ("classifier", LogisticRegression(
            C=c_value,
            max_iter=1000,
            random_state=42,
        )),
    ])


def forecast(model_name, c_value, train_mask, test_mask):
    X = FEATURES[model_name]

    assert train_mask.sum() > 0
    assert test_mask.sum() > 0

    model = make_model(c_value)

    model.fit(
        X[train_mask],
        outcomes[train_mask]
    )

    return model.predict_proba(
        X[test_mask]
    )[:, 1]


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


# select regularization using earlier seasons
def select_c(model_name, evaluation_year):
    inner_years = range(
        FIRST_INNER_SEASON,
        evaluation_year
    )

    records = []

    for c_value in C_VALUES:
        squared_errors = []
        total_games = 0

        for inner_year in inner_years:
            train_mask = (
                (seasons >= FIRST_TRAIN_SEASON)
                & (seasons < inner_year)
            )

            test_mask = (
                seasons == inner_year
            )

            actual = outcomes[test_mask]

            probabilities = forecast(
                model_name,
                c_value,
                train_mask,
                test_mask
            )

            squared_errors.extend(
                (probabilities - actual) ** 2
            )

            total_games += len(actual)

        records.append({
            "model": model_name,
            "evaluation_season": evaluation_year,
            "c_value": float(c_value),
            "inner_games": total_games,
            "inner_brier": float(
                np.mean(squared_errors)
            ),
        })

    rankings = pl.DataFrame(records).sort([
        "inner_brier",
        "c_value",
    ])

    selected_c = float(
        rankings["c_value"][0]
    )

    return selected_c, rankings


# outer walk-forward evaluation
summary = []
all_predictions = []
all_rankings = []

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

    actual = outcomes[test_mask]

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

    for model_name in MODEL_METRICS:
        selected_c, rankings = select_c(
            model_name,
            evaluation_year
        )

        all_rankings.append(rankings)

        selected_p = forecast(
            model_name,
            selected_c,
            train_mask,
            test_mask
        )

        reference_p = forecast(
            model_name,
            REFERENCE_C,
            train_mask,
            test_mask
        )

        selected_result = evaluate(
            actual, selected_p
        )

        reference_result = evaluate(
            actual, reference_p
        )

        print(
            f"{model_name:<5} "
            f"C={selected_c:<6g} | "
            f"selected Brier={selected_result['brier']:.4f} | "
            f"fixed Brier={reference_result['brier']:.4f}"
        )

        summary.append({
            "season": evaluation_year,
            "model": model_name,
            "features": FEATURES[model_name].shape[1],
            "games": len(actual),
            "selected_c": selected_c,
            "selected_accuracy": selected_result["accuracy"],
            "fixed_accuracy": reference_result["accuracy"],
            "selected_brier": selected_result["brier"],
            "fixed_brier": reference_result["brier"],
            "selected_log_loss": selected_result["log_loss"],
            "fixed_log_loss": reference_result["log_loss"],
        })

        label = model_name.lower().replace("-", "_")

        season_predictions = (
            season_predictions.with_columns(
                pl.Series(
                    f"selected_prob_{label}",
                    selected_p,
                ),
                pl.Series(
                    f"fixed_prob_{label}",
                    reference_p,
                ),
                pl.lit(selected_c).alias(
                    f"selected_c_{label}"
                ),
            )
        )

    all_predictions.append(season_predictions)


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

combined = []

for model_name in MODEL_METRICS:
    label = model_name.lower().replace("-", "_")

    selected_p = predictions_df[
        f"selected_prob_{label}"
    ].to_numpy()

    fixed_p = predictions_df[
        f"fixed_prob_{label}"
    ].to_numpy()

    selected_result = evaluate(
        actual, selected_p
    )

    fixed_result = evaluate(
        actual, fixed_p
    )

    combined.append({
        "model": model_name,
        "features": FEATURES[model_name].shape[1],
        "games": len(actual),
        "selected_accuracy": selected_result["accuracy"],
        "fixed_accuracy": fixed_result["accuracy"],
        "selected_brier": selected_result["brier"],
        "fixed_brier": fixed_result["brier"],
        "selected_log_loss": selected_result["log_loss"],
        "fixed_log_loss": fixed_result["log_loss"],
    })

combined_df = (
    pl.DataFrame(combined)
    .sort("selected_brier")
)

print(f"\n{'=' * 60}")
print("COMBINED OUT-OF-SAMPLE PERFORMANCE")
print(f"{'=' * 60}")

print(combined_df.select([
    "model",
    "features",
    "games",
    "selected_accuracy",
    "selected_brier",
    "fixed_brier",
    "selected_log_loss",
    "fixed_log_loss",
]))

print("\nSelected C by evaluation season:")
print(summary_df.select([
    "season",
    "model",
    "selected_c",
    "selected_brier",
    "fixed_brier",
]).sort(["season", "model"]))


# validate fixed results against train_v4.py
reference_path = (
    OUTPUT_DIR / "v4_predictions.csv"
)

if reference_path.exists():
    reference = pl.read_csv(
        reference_path
    )

    fixed_columns = [
        f"fixed_prob_{name.lower().replace('-', '_')}"
        for name in MODEL_METRICS
    ]

    reference_columns = [
        f"prob_{name.lower().replace('-', '_')}"
        for name in MODEL_METRICS
    ]

    comparison = predictions_df.join(
        reference.select([
            "game_id",
            *reference_columns,
        ]),
        on="game_id",
        how="inner",
    )

    assert comparison.height == predictions_df.height, (
        "Missing reference predictions."
    )

    for fixed_column, reference_column in zip(
        fixed_columns, reference_columns
    ):
        maximum_difference = comparison.select(
            (
                pl.col(fixed_column)
                - pl.col(reference_column)
            ).abs().max()
        ).item()

        assert maximum_difference < 1e-8, (
            f"Reference mismatch: {fixed_column}"
        )

    print("\nPASS: Fixed C=1 models reproduced.")


# save results
summary_df.write_csv(
    OUTPUT_DIR / "regularization_season_summary.csv"
)

combined_df.write_csv(
    OUTPUT_DIR / "regularization_combined_summary.csv"
)

predictions_df.write_csv(
    OUTPUT_DIR / "regularization_predictions.csv"
)

rankings_df.write_csv(
    OUTPUT_DIR / "regularization_rankings.csv"
)

print("\nSUCCESS: Regularization experiments completed.")
print(
    f"Saved {predictions_df.height} "
    "out-of-sample predictions."
)
