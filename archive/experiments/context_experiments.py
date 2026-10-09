
from pathlib import Path

import numpy as np
import polars as pl

from sklearn.impute import SimpleImputer
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

CONTEXT_METRICS = [
    "rest_diff",
    "home_short_week",
    "away_short_week",
    "home_extended_rest",
    "away_extended_rest",
    "neutral_site",
]

DIVISION_METRICS = [
    "division_game",
]

BASE_METRICS = (
    V3_METRICS + EFFICIENCY_METRICS
)

MODEL_METRICS = {
    "V4-A": BASE_METRICS,
    "V4-D": BASE_METRICS + CONTEXT_METRICS,
    "V4-D+": (
        BASE_METRICS
        + CONTEXT_METRICS
        + DIVISION_METRICS
    ),
}


# load datasets
matchups = pl.read_parquet(
    DATA_DIR / "ml_matchups_v2_2019_2026.parquet"
)

v4 = pl.read_parquet(
    DATA_DIR / "pregame_features_v4_2019_2026.parquet"
)

context = pl.read_parquet(
    DATA_DIR / "game_context_2019_2026.parquet"
)

assert matchups["game_id"].n_unique() == matchups.height
assert context["game_id"].n_unique() == context.height

assert v4.select(
    pl.struct(["game_id", "team"]).n_unique()
).item() == v4.height


# prepare v3 baseline data
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


# prepare v4 home and away features
home = v4.select(
    "game_id",
    pl.col("team").alias("home_team"),
    *[
        pl.col(metric).alias(f"home_{metric}")
        for metric in EFFICIENCY_METRICS
    ],
)

away = v4.select(
    "game_id",
    pl.col("team").alias("away_team"),
    *[
        pl.col(metric).alias(f"away_{metric}")
        for metric in EFFICIENCY_METRICS
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
)

assert df.height == matchups.height, (
    "Some matchups failed to join V4 features."
)


# join scheduled game context
context_columns = (
    CONTEXT_METRICS + DIVISION_METRICS
)

df = df.join(
    context.select([
        "game_id",
        "home_team",
        "away_team",
        *context_columns,
    ]),
    on=["game_id", "home_team", "away_team"],
    how="inner",
)

assert df.height == matchups.height, (
    "Some matchups failed to join game context."
)

df = df.sort([
    "season", "week", "game_id"
])

assert df["game_id"].n_unique() == df.height
assert df["home_win"].is_in([0, 1]).all()

print(f"Loaded {df.height} historical matchups.")


# calculate home-minus-away efficiency features
df = df.with_columns([
    (
        pl.col(f"home_{metric}")
        - pl.col(f"away_{metric}")
    ).alias(f"diff_{metric}")
    for metric in BASE_METRICS
])

# convert categorical context to numeric indicators
df = df.with_columns([
    pl.col(name)
    .cast(pl.Float64)
    .alias(name)
    for name in context_columns
    if name != "rest_diff"
])

# use null rest differences for first games.
# the imputer will learn replacement values
# from training seasons only.
FEATURE_COLUMNS = {
    model_name: [
        f"diff_{metric}"
        if metric in BASE_METRICS
        else metric
        for metric in metrics
    ]
    for model_name, metrics in MODEL_METRICS.items()
}

FEATURES = {
    name: df.select(columns).to_numpy()
    for name, columns in FEATURE_COLUMNS.items()
}

seasons = df["season"].to_numpy()
outcomes = df["home_win"].to_numpy().astype(int)

for name, X in FEATURES.items():
    assert not np.isinf(X).any(), (
        f"Infinite features found in {name}"
    )

    assert all(
        np.isfinite(X[~np.isnan(X)])
    ), f"Invalid features found in {name}"

print(
    "Missing rest differences: "
    f"{df['rest_diff'].null_count()}"
)


# model functions
def make_model(c_value):
    return Pipeline([
        ("imputer", SimpleImputer(
            strategy="median",
        )),
        ("scaler", StandardScaler()),
        ("classifier", LogisticRegression(
            C=c_value,
            max_iter=1000,
            random_state=42,
        )),
    ])


def forecast(model_name, c_value, train_mask, test_mask):
    X = FEATURES[model_name]

    model = make_model(c_value)

    model.fit(
        X[train_mask],
        outcomes[train_mask],
    )

    return model.predict_proba(
        X[test_mask]
    )[:, 1]


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
            actual,
            probabilities,
            labels=[0, 1],
        ),
    }


# select regularization using previous seasons
def select_c(model_name, evaluation_year):
    records = []

    for c_value in C_VALUES:
        errors = []

        for inner_year in range(
            FIRST_INNER_SEASON,
            evaluation_year,
        ):
            train_mask = (
                (seasons >= FIRST_TRAIN_SEASON)
                & (seasons < inner_year)
            )

            test_mask = (
                seasons == inner_year
            )

            probabilities = forecast(
                model_name,
                c_value,
                train_mask,
                test_mask,
            )

            errors.extend(
                (
                    probabilities
                    - outcomes[test_mask]
                ) ** 2
            )

        records.append({
            "model": model_name,
            "evaluation_season": evaluation_year,
            "c_value": c_value,
            "inner_brier": float(
                np.mean(errors)
            ),
            "inner_games": len(errors),
        })

    ranking = pl.DataFrame(records).sort([
        "inner_brier",
        "c_value",
    ])

    selected_c = float(
        ranking["c_value"][0]
    )

    return selected_c, ranking


# outer walk-forward evaluation
summary = []
all_predictions = []
all_rankings = []

for year in EVALUATION_SEASONS:
    print(f"\n{'=' * 60}")
    print(f"EVALUATING {year}")
    print(f"{'=' * 60}")

    train_mask = (
        (seasons >= FIRST_TRAIN_SEASON)
        & (seasons < year)
    )

    test_mask = seasons == year
    actual = outcomes[test_mask]

    season_predictions = df.filter(
        pl.col("season") == year
    ).select([
        "game_id",
        "season",
        "week",
        "home_team",
        "away_team",
        "home_win",
    ])

    for model_name in MODEL_METRICS:
        selected_c, ranking = select_c(
            model_name,
            year,
        )

        all_rankings.append(ranking)

        probabilities = forecast(
            model_name,
            selected_c,
            train_mask,
            test_mask,
        )

        result = evaluate(
            actual,
            probabilities,
        )

        label = (
            model_name.lower()
            .replace("-", "_")
            .replace("+", "_plus")
        )

        season_predictions = (
            season_predictions.with_columns(
                pl.Series(
                    f"prob_{label}",
                    probabilities,
                )
            )
        )

        summary.append({
            "season": year,
            "model": model_name,
            "features": FEATURES[model_name].shape[1],
            "selected_c": selected_c,
            "games": result["games"],
            "accuracy": result["accuracy"],
            "brier": result["brier"],
            "log_loss": result["log_loss"],
        })

        print(
            f"{model_name:<6} "
            f"C={selected_c:<6g} | "
            f"accuracy={result['accuracy']:.3f} | "
            f"Brier={result['brier']:.4f} | "
            f"log loss={result['log_loss']:.4f}"
        )

    all_predictions.append(season_predictions)


# combined out-of-sample performance
summary_df = pl.DataFrame(summary)

predictions_df = (
    pl.concat(all_predictions)
    .sort(["season", "week", "game_id"])
)

rankings_df = pl.concat(all_rankings)

actual = predictions_df["home_win"].to_numpy()

combined = []

for model_name in MODEL_METRICS:
    label = (
        model_name.lower()
        .replace("-", "_")
        .replace("+", "_plus")
    )

    probabilities = predictions_df[
        f"prob_{label}"
    ].to_numpy()

    result = evaluate(
        actual,
        probabilities,
    )

    combined.append({
        "model": model_name,
        "features": FEATURES[model_name].shape[1],
        "games": result["games"],
        "accuracy": result["accuracy"],
        "brier": result["brier"],
        "log_loss": result["log_loss"],
    })

combined_df = (
    pl.DataFrame(combined)
    .sort("brier")
)

print(f"\n{'=' * 60}")
print("COMBINED OUT-OF-SAMPLE PERFORMANCE")
print(f"{'=' * 60}")

print(combined_df)


# verify original v4-a predictions
reference_path = (
    OUTPUT_DIR / "regularization_predictions.csv"
)

if reference_path.exists():
    reference = pl.read_csv(
        reference_path
    ).select([
        "game_id",
        "selected_prob_v4_a",
    ])

    comparison = predictions_df.join(
        reference,
        on="game_id",
        how="inner",
    )

    assert comparison.height == predictions_df.height, (
        "Missing V4-A reference predictions."
    )

    maximum_difference = comparison.select(
        (
            pl.col("prob_v4_a")
            - pl.col("selected_prob_v4_a")
        ).abs().max()
    ).item()

    print(
        f"\nV4-A maximum prediction difference: "
        f"{maximum_difference:.10f}"
    )

    assert maximum_difference < 1e-8, (
        "V4-A predictions differ from the "
        "previous regularization experiment."
    )

    print("PASS: V4-A benchmark reproduced.")


# save results
summary_df.write_csv(
    OUTPUT_DIR / "context_season_summary.csv"
)

combined_df.write_csv(
    OUTPUT_DIR / "context_combined_summary.csv"
)

predictions_df.write_csv(
    OUTPUT_DIR / "context_predictions.csv"
)

rankings_df.write_csv(
    OUTPUT_DIR / "context_regularization_rankings.csv"
)

print("\nSUCCESS: Game context experiments completed.")
print(
    f"Saved {predictions_df.height} "
    "out-of-sample predictions."
)