
from pathlib import Path

import nflreadpy as nfl
import polars as pl


# configuration
ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "processed"
DATA_DIR.mkdir(parents=True, exist_ok=True)

SEASONS = list(range(2019, 2027))

QB_METRICS = [
    "attempts",
    "completions",
    "pass_yards",
    "pass_touchdowns",
    "interceptions",
    "completion_percentage",
    "expected_completion_percentage",
    "completion_percentage_above_expectation",
    "avg_time_to_throw",
    "avg_intended_air_yards",
    "avg_completed_air_yards",
    "avg_air_yards_to_sticks",
    "aggressiveness",
    "passer_rating",
]


# load next gen passing stats
print("Loading Next Gen Stats passing data...")

ngs = nfl.load_nextgen_stats(
    seasons=SEASONS,
    stat_type="passing",
)

print(f"Loaded {ngs.height:,} raw records.")


# inspect data structure
print("\nAvailable columns:")
print(ngs.columns)

required = ["season", "week", "attempts"]

missing_required = [
    col for col in required
    if col not in ngs.columns
]

assert not missing_required, (
    f"Missing required columns: {missing_required}"
)

available_metrics = [
    col for col in QB_METRICS
    if col in ngs.columns
]

missing_metrics = [
    col for col in QB_METRICS
    if col not in ngs.columns
]

print("\nAvailable QB metrics:")
print(available_metrics)

print("\nMissing QB metrics:")
print(missing_metrics)


# keep weekly regular-season records
ngs = ngs.filter(
    (pl.col("week") >= 1)
    & (pl.col("week") <= 18)
)

if "season_type" in ngs.columns:
    ngs = ngs.filter(
        pl.col("season_type").is_in(
            ["REG", "REGULAR"]
        )
    )

if "season" in ngs.columns:
    ngs = ngs.filter(
        pl.col("season").is_in(SEASONS)
    )

ngs = ngs.sort(["season", "week"])


# inspect coverage
print("\nRecords by season:")
print(
    ngs.group_by("season")
    .agg(
        pl.len().alias("qb_week_records"),
    )
    .sort("season")
)

print("\nMissing values by metric:")

missing_summary = ngs.select([
    pl.col(col)
    .null_count()
    .alias(col)
    for col in available_metrics
])

print(missing_summary)


# identify player columns
identity_columns = [
    col for col in [
        "player_id",
        "player_display_name",
        "player_name",
        "player",
        "team_abbr",
        "team",
    ]
    if col in ngs.columns
]

print("\nPlayer identification columns:")
print(identity_columns)

print("\nSample QB records:")

sample_columns = (
    identity_columns
    + [
        col for col in [
            "season",
            "week",
            "attempts",
            "completion_percentage_above_expectation",
            "avg_time_to_throw",
            "avg_intended_air_yards",
        ]
        if col in ngs.columns
    ]
)

print(
    ngs.select(
        list(dict.fromkeys(sample_columns))
    ).head(10)
)


# save weekly data
output_path = (
    DATA_DIR / "qb_nextgen_weekly_2019_2026.parquet"
)

ngs.write_parquet(output_path)

print("\nSUCCESS: Next Gen passing data saved.")
print(f"Records: {ngs.height:,}")
print(f"Output: {output_path.name}")
