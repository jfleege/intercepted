
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

QB_CORE = [
    "diff_qb_career_completion_percentage_above_expectation",
    "diff_qb_recent_completion_percentage_above_expectation",
    "qb_experience_diff",
    "home_qb_projection_missing",
    "away_qb_projection_missing",
]

QB_STYLE = [
    "diff_qb_recent_avg_time_to_throw",
    "diff_qb_recent_avg_intended_air_yards",
    "diff_qb_recent_aggressiveness",
]

BASE_COLUMNS = [
    f"diff_{metric}"
    for metric in V3_METRICS + EFFICIENCY_METRICS
]

MODEL_COLUMNS = {
    "V4-A": BASE_COLUMNS,
    "V4-QB": BASE_COLUMNS + QB_CORE,
    "V4-QB+": BASE_COLUMNS + QB_CORE + QB_STYLE,
}


# load data
matchups = pl.read_parquet(
    DATA_DIR / "ml_matchups_v2_2019_2026.parquet"
)

v4 = pl.read_parquet(
    DATA_DIR / "pregame_features_v4_2019_2026.parquet"
)

qb = pl.read_parquet(
    DATA_DIR / "qb_matchup_features_2019_2026.parquet"
)

assert matchups["game_id"].n_unique() == matchups.height
assert qb["game_id"].n_unique() == qb.height

assert v4.select(
    pl.struct(["game_id", "team"]).n_unique()
).item() == v4.height


# prepare team efficiency features
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
    .join(home, on=["game_id", "home_team"])
    .join(away, on=["game_id", "away_team"])
)

assert df.height == matchups.height

df = df.with_columns([
    (
        pl.col(f"home_{metric}")
        - pl.col(f"away_{metric}")
    ).alias(f"diff_{metric}")
    for metric in V3_METRICS + EFFICIENCY_METRICS
])


# add projected quarterback features
qb_columns = [
    "game_id",
    "home_team",
    "away_team",
    "home_qb_career_attempts",
    "away_qb_career_attempts",
    *[
        col
        for col in QB_CORE + QB_STYLE
        if col != "qb_experience_diff"
    ],
]

df = df.join(
    qb.select(qb_columns),
    on=["game_id", "home_team", "away_team"],
    how="left",
)

assert df.height == matchups.height

df = df.with_columns(
    (
        pl.col("home_qb_career_attempts")
        .cast(pl.Float64)
        .log1p()
        -
        pl.col("away_qb_career_attempts")
        .cast(pl.Float64)
        .log1p()
    ).alias("qb_experience_diff")
)

for col in [
    "home_qb_projection_missing",
    "away_qb_projection_missing",
]:
    assert df[col].null_count() == 0

    df = df.with_columns(
        pl.col(col).cast(pl.Float64)
    )

df = df.sort(["season", "week", "game_id"])

assert df["game_id"].n_unique() == df.height
assert df["home_win"].is_in([0, 1]).all()


# prepare model arrays
FEATURES = {
    name: df.select(columns).to_numpy()
    for name, columns in MODEL_COLUMNS.items()
}

seasons = df["season"].to_numpy()
outcomes = df["home_win"].to_numpy().astype(int)

for name, X in FEATURES.items():
    assert not np.isinf(X).any(), (
        f"Infinite features in {name}"
    )

print(f"Loaded {df.height} historical matchups.")


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


def forecast(name, c_value, train_mask, test_mask):
    model = make_model(c_value)

    model.fit(
        FEATURES[name][train_mask],
        outcomes[train_mask],
    )

    return model.predict_proba(
        FEATURES[name][test_mask]
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
            actual,
            probabilities,
            labels=[0, 1],
        ),
    }


# select c using earlier seasons
def select_c(name, evaluation_year):
    rankings = []

    for c_value in C_VALUES:
        errors = []

        for inner_year in range(2021, evaluation_year):
            train_mask = (
                (seasons >= 2019)
                & (seasons < inner_year)
            )

            test_mask = seasons == inner_year

            probabilities = forecast(
                name,
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

        rankings.append({
            "model": name,
            "evaluation_season": evaluation_year,
            "c_value": c_value,
            "inner_games": len(errors),
            "inner_brier": float(np.mean(errors)),
        })

    ranking = pl.DataFrame(rankings).sort([
        "inner_brier",
        "c_value",
    ])

    return float(ranking["c_value"][0]), ranking


# walk-forward evaluation
summaries = []
predictions = []
rankings = []

for year in EVALUATION_SEASONS:
    print(f"\n{'=' * 60}")
    print(f"EVALUATING {year}")
    print(f"{'=' * 60}")

    train_mask = seasons < year
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

    for name in MODEL_COLUMNS:
        selected_c, ranking = select_c(name, year)
        rankings.append(ranking)

        probabilities = forecast(
            name,
            selected_c,
            train_mask,
            test_mask,
        )

        result = evaluate(actual, probabilities)

        label = (
            name.lower()
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

        summaries.append({
            "season": year,
            "model": name,
            "features": len(MODEL_COLUMNS[name]),
            "selected_c": selected_c,
            **result,
        })

        print(
            f"{name:<7} "
            f"C={selected_c:<6g} | "
            f"accuracy={result['accuracy']:.3f} | "
            f"Brier={result['brier']:.4f} | "
            f"log loss={result['log_loss']:.4f}"
        )

    predictions.append(season_predictions)


# combined results
predictions_df = (
    pl.concat(predictions)
    .sort(["season", "week", "game_id"])
)

summary_df = pl.DataFrame(summaries)
rankings_df = pl.concat(rankings)

actual = predictions_df["home_win"].to_numpy()

combined = []

for name in MODEL_COLUMNS:
    label = (
        name.lower()
        .replace("-", "_")
        .replace("+", "_plus")
    )

    probabilities = predictions_df[
        f"prob_{label}"
    ].to_numpy()

    combined.append({
        "model": name,
        "features": len(MODEL_COLUMNS[name]),
        **evaluate(actual, probabilities),
    })

combined_df = (
    pl.DataFrame(combined)
    .sort("brier")
)

print(f"\n{'=' * 60}")
print("COMBINED OUT-OF-SAMPLE PERFORMANCE")
print(f"{'=' * 60}")

print(combined_df)


# reproduce v4-a benchmark
reference_path = (
    OUTPUT_DIR / "regularization_predictions.csv"
)

assert reference_path.exists(), (
    "Missing V4-A reference predictions."
)

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

assert comparison.height == predictions_df.height

max_difference = comparison.select(
    (
        pl.col("prob_v4_a")
        - pl.col("selected_prob_v4_a")
    ).abs().max()
).item()

print(
    f"\nV4-A maximum probability difference: "
    f"{max_difference:.10f}"
)

assert max_difference < 1e-8, (
    "V4-A benchmark does not match."
)

print("PASS: V4-A benchmark reproduced.")


# save results
summary_df.write_csv(
    OUTPUT_DIR / "qb_experiments_season_summary.csv"
)

combined_df.write_csv(
    OUTPUT_DIR / "qb_experiments_combined_summary.csv"
)

predictions_df.write_csv(
    OUTPUT_DIR / "qb_experiments_predictions.csv"
)

rankings_df.write_csv(
    OUTPUT_DIR / "qb_experiments_rankings.csv"
)

print("\nSUCCESS: QB model comparison completed.")
print(
    f"Saved {predictions_df.height} "
    "out-of-sample predictions."
)
