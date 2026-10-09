
from pathlib import Path

import numpy as np
import polars as pl

from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    log_loss,
)
from xgboost import XGBClassifier


# configuration
ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "processed"
OUTPUT_DIR = ROOT / "data" / "diagnostics"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

EVALUATION_SEASONS = [2022, 2023, 2024]

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
    "XGB-A": BASE_COLUMNS,
    "XGB-QB": BASE_COLUMNS + QB_CORE,
    "XGB-QB+": BASE_COLUMNS + QB_CORE + QB_STYLE,
}

CONFIGS = [
    {
        "name": "shallow_100",
        "max_depth": 2,
        "n_estimators": 100,
        "learning_rate": 0.03,
        "min_child_weight": 5,
        "reg_lambda": 10,
    },
    {
        "name": "shallow_200",
        "max_depth": 2,
        "n_estimators": 200,
        "learning_rate": 0.03,
        "min_child_weight": 5,
        "reg_lambda": 10,
    },
    {
        "name": "depth3_100",
        "max_depth": 3,
        "n_estimators": 100,
        "learning_rate": 0.03,
        "min_child_weight": 5,
        "reg_lambda": 10,
    },
    {
        "name": "depth3_200",
        "max_depth": 3,
        "n_estimators": 200,
        "learning_rate": 0.03,
        "min_child_weight": 10,
        "reg_lambda": 15,
    },
    {
        "name": "strong_regularization",
        "max_depth": 2,
        "n_estimators": 150,
        "learning_rate": 0.02,
        "min_child_weight": 15,
        "reg_lambda": 25,
    },
]


# load datasets
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


# build team efficiency differences
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


# add quarterback features
qb_columns = [
    "game_id",
    "home_team",
    "away_team",
    "home_qb_career_attempts",
    "away_qb_career_attempts",
    *[
        name
        for name in QB_CORE + QB_STYLE
        if name != "qb_experience_diff"
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

for name in [
    "home_qb_projection_missing",
    "away_qb_projection_missing",
]:
    assert df[name].null_count() == 0

    df = df.with_columns(
        pl.col(name).cast(pl.Float64)
    )

df = df.sort([
    "season",
    "week",
    "game_id",
])

assert df["game_id"].n_unique() == df.height
assert df["home_win"].is_in([0, 1]).all()


# prepare feature matrices
FEATURES = {
    name: df.select(columns).to_numpy()
    for name, columns in MODEL_COLUMNS.items()
}

seasons = df["season"].to_numpy()
outcomes = df["home_win"].to_numpy().astype(int)

for name, X in FEATURES.items():
    assert not np.isinf(X).any(), (
        f"Infinite feature value in {name}"
    )

print(f"Loaded {df.height} historical matchups.")


# model functions
def make_model(config):
    return XGBClassifier(
        objective="binary:logistic",
        eval_metric="logloss",
        tree_method="hist",
        random_state=42,
        n_jobs=4,
        subsample=1.0,
        colsample_bytree=1.0,
        **{
            key: value
            for key, value in config.items()
            if key != "name"
        },
    )


def forecast(name, config, train_mask, test_mask):
    X = FEATURES[name]

    imputer = SimpleImputer(
        strategy="median"
    )

    X_train = imputer.fit_transform(
        X[train_mask]
    )

    X_test = imputer.transform(
        X[test_mask]
    )

    model = make_model(config)

    model.fit(
        X_train,
        outcomes[train_mask],
    )

    return model.predict_proba(
        X_test
    )[:, 1]


def evaluate(actual, probabilities):
    predictions = (
        probabilities >= 0.5
    ).astype(int)

    return {
        "games": len(actual),
        "accuracy": accuracy_score(
            actual,
            predictions,
        ),
        "brier": brier_score_loss(
            actual,
            probabilities,
        ),
        "log_loss": log_loss(
            actual,
            probabilities,
            labels=[0, 1],
        ),
    }


# select tree configuration using earlier seasons
def select_config(name, evaluation_year):
    records = []

    for config in CONFIGS:
        errors = []

        for inner_year in range(
            2021,
            evaluation_year,
        ):
            train_mask = (
                (seasons >= 2019)
                & (seasons < inner_year)
            )

            test_mask = (
                seasons == inner_year
            )

            probabilities = forecast(
                name,
                config,
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
            "model": name,
            "evaluation_season": evaluation_year,
            "config_name": config["name"],
            "inner_games": len(errors),
            "inner_brier": float(
                np.mean(errors)
            ),
        })

    ranking = pl.DataFrame(records).sort([
        "inner_brier",
        "config_name",
    ])

    chosen_name = ranking["config_name"][0]

    selected = next(
        config
        for config in CONFIGS
        if config["name"] == chosen_name
    )

    return selected, ranking


# outer walk-forward evaluation
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
        config, ranking = select_config(
            name,
            year,
        )

        rankings.append(ranking)

        probabilities = forecast(
            name,
            config,
            train_mask,
            test_mask,
        )

        result = evaluate(
            actual,
            probabilities,
        )

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
            "config": config["name"],
            **result,
        })

        print(
            f"{name:<8} "
            f"config={config['name']:<22} | "
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


# compare against logistic regression
reference_path = (
    OUTPUT_DIR / "qb_experiments_predictions.csv"
)

assert reference_path.exists(), (
    "Missing logistic regression predictions."
)

reference = pl.read_csv(reference_path)

comparison = predictions_df.join(
    reference.select([
        "game_id",
        "home_win",
        "prob_v4_a",
        "prob_v4_qb",
        "prob_v4_qb_plus",
    ]).drop("home_win"),
    on="game_id",
    how="inner",
)

assert comparison.height == predictions_df.height

logistic_results = []

for name, column in [
    ("V4-A logistic", "prob_v4_a"),
    ("V4-QB logistic", "prob_v4_qb"),
    ("V4-QB+ logistic", "prob_v4_qb_plus"),
]:
    result = evaluate(
        comparison["home_win"].to_numpy(),
        comparison[column].to_numpy(),
    )

    logistic_results.append({
        "model": name,
        **result,
    })

logistic_df = pl.DataFrame(
    logistic_results
)

print(f"\n{'=' * 60}")
print("XGBOOST RESULTS")
print(f"{'=' * 60}")

print(combined_df)

print("\nLOGISTIC REGRESSION BENCHMARKS")
print(logistic_df)

print("\nSELECTED CONFIGURATIONS")
print(
    summary_df.select([
        "season",
        "model",
        "config",
        "brier",
    ]).sort(["season", "model"])
)


# save experiment results
summary_df.write_csv(
    OUTPUT_DIR / "xgboost_season_summary.csv"
)

combined_df.write_csv(
    OUTPUT_DIR / "xgboost_combined_summary.csv"
)

predictions_df.write_csv(
    OUTPUT_DIR / "xgboost_predictions.csv"
)

rankings_df.write_csv(
    OUTPUT_DIR / "xgboost_config_rankings.csv"
)

print("\nSUCCESS: XGBoost experiments completed.")
print(
    f"Saved {predictions_df.height} "
    "out-of-sample predictions."
)