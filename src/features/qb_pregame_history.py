
from pathlib import Path

import numpy as np
import polars as pl


# configuration
ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "processed"

INPUT_PATH = (
    DATA_DIR / "qb_nextgen_weekly_2019_2026.parquet"
)

OUTPUT_PATH = (
    DATA_DIR / "qb_pregame_history_2019_2026.parquet"
)

QB_METRICS = [
    "completion_percentage_above_expectation",
    "avg_time_to_throw",
    "avg_intended_air_yards",
    "aggressiveness",
]


# load weekly quarterback data
qb = pl.read_parquet(INPUT_PATH)

qb = (
    qb
    .select([
        "player_gsis_id",
        "player_display_name",
        "team_abbr",
        "season",
        "week",
        "attempts",
        *QB_METRICS,
    ])
    .filter(
        pl.col("player_gsis_id").is_not_null()
        & (pl.col("attempts") > 0)
    )
    .sort([
        "player_gsis_id",
        "season",
        "week",
    ])
)

assert qb.select(
    pl.struct([
        "player_gsis_id",
        "season",
        "week",
    ]).n_unique()
).item() == qb.height, (
    "Duplicate QB records within a season-week."
)

print(f"Loaded {qb.height:,} QB-week records.")


# calculate attempt-weighted totals
qb = qb.with_columns([
    (
        pl.col(metric) * pl.col("attempts")
    ).alias(f"weighted_{metric}")
    for metric in QB_METRICS
])


# calculate previous appearances and attempts
qb = qb.with_columns(
    (
        pl.col("attempts")
        .cum_count()
        .shift(1)
        .over("player_gsis_id")
        .fill_null(0)
        .alias("prior_qb_games")
    ),

    (
        pl.col("attempts")
        .cum_sum()
        .shift(1)
        .over("player_gsis_id")
        .fill_null(0)
        .alias("prior_qb_attempts")
    ),

    (
        pl.col("attempts")
        .rolling_sum(
            window_size=3,
            min_samples=1,
        )
        .shift(1)
        .over("player_gsis_id")
        .fill_null(0)
        .alias("recent_qb_attempts")
    ),
)


# calculate historical weighted metrics
for metric in QB_METRICS:
    weighted = f"weighted_{metric}"

    qb = qb.with_columns(
        pl.col(weighted)
        .cum_sum()
        .shift(1)
        .over("player_gsis_id")
        .fill_null(0)
        .alias(f"prior_total_{metric}"),

        pl.col(weighted)
        .rolling_sum(
            window_size=3,
            min_samples=1,
        )
        .shift(1)
        .over("player_gsis_id")
        .fill_null(0)
        .alias(f"recent_total_{metric}"),
    )

    qb = qb.with_columns(
        pl.when(pl.col("prior_qb_attempts") > 0)
        .then(
            pl.col(f"prior_total_{metric}")
            / pl.col("prior_qb_attempts")
        )
        .otherwise(None)
        .alias(f"prior_{metric}"),

        pl.when(pl.col("recent_qb_attempts") > 0)
        .then(
            pl.col(f"recent_total_{metric}")
            / pl.col("recent_qb_attempts")
        )
        .otherwise(None)
        .alias(f"recent_{metric}"),
    )


# select pregame features
output_columns = [
    "player_gsis_id",
    "player_display_name",
    "team_abbr",
    "season",
    "week",
    "prior_qb_games",
    "prior_qb_attempts",
    "recent_qb_attempts",
]

for metric in QB_METRICS:
    output_columns.extend([
        f"prior_{metric}",
        f"recent_{metric}",
    ])

output = qb.select(output_columns)


# validate historical features
assert output.height == qb.height

first_appearances = output.filter(
    pl.col("prior_qb_games") == 0
)

assert first_appearances.select(
    (pl.col("prior_qb_attempts") == 0).all()
).item()

for metric in QB_METRICS:
    assert first_appearances.select(
        pl.col(f"prior_{metric}")
        .is_null()
        .all()
    ).item()

    assert first_appearances.select(
        pl.col(f"recent_{metric}")
        .is_null()
        .all()
    ).item()

    for prefix in ["prior", "recent"]:
        values = output[
            f"{prefix}_{metric}"
        ].drop_nulls().to_numpy()

        assert np.isfinite(values).all(), (
            f"Invalid {prefix}_{metric} values."
        )

print("PASS: QB historical features validated.")


# save dataset
output.write_parquet(OUTPUT_PATH)

print(f"\nSUCCESS: Saved {output.height:,} QB records.")
print(f"Output: {OUTPUT_PATH.name}")

print("\nCoverage by season:")
print(
    output.group_by("season")
    .agg(
        pl.len().alias("qb_records"),
        (
            pl.col("prior_qb_attempts") > 0
        ).sum().alias("with_prior_history"),
    )
    .sort("season")
)

print("\n2024 QB examples:")
print(
    output.filter(
        (pl.col("season") == 2024)
        & (pl.col("week") == 10)
    )
    .select([
        "player_display_name",
        "team_abbr",
        "prior_qb_games",
        "prior_qb_attempts",
        "prior_completion_percentage_above_expectation",
        "recent_completion_percentage_above_expectation",
        "prior_avg_time_to_throw",
    ])
    .head(10)
)
