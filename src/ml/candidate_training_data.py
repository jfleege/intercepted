
from datetime import datetime, timezone
from pathlib import Path
import json

import joblib
import numpy as np
import polars as pl

from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


# configuration
ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "processed"
MODEL_DIR = ROOT / "models"

MODEL_DIR.mkdir(parents=True, exist_ok=True)

C_VALUE = 0.01

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
    "v4_a": BASE_COLUMNS,
    "v4_qb_plus": BASE_COLUMNS + QB_CORE + QB_STYLE,
}


# load historical datasets
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
    "Some games failed to join team features."
)

df = df.with_columns([
    (
        pl.col(f"home_{metric}")
        - pl.col(f"away_{metric}")
    ).alias(f"diff_{metric}")
    for metric in V3_METRICS + EFFICIENCY_METRICS
])


# add projected quarterback histories
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

assert df.height == matchups.height, (
    "Some games failed to join QB features."
)

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

print(f"Loaded {df.height:,} completed matchups.")


# validate training features
all_columns = MODEL_COLUMNS["v4_qb_plus"]

X = df.select(all_columns).to_numpy()

assert not np.isinf(X).any(), (
    "Training features contain infinite values."
)

for column in BASE_COLUMNS:
    assert df[column].null_count() == 0, (
        f"Missing team feature: {column}"
    )

print("PASS: Training features validated.")


