
from pathlib import Path

import numpy as np
import polars as pl


# configuration
ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "processed"

TEAM_RENAMES = {
    "OAK": "LV",
    "SD": "LAC",
    "STL": "LA",
    "LAR": "LA",
    "JAC": "JAX",
}

QB_METRICS = [
    "completion_percentage_above_expectation",
    "avg_time_to_throw",
    "avg_intended_air_yards",
    "aggressiveness",
]

OUTPUT_PATH = (
    DATA_DIR / "qb_matchup_features_2019_2026.parquet"
)


# load datasets
ngs = pl.read_parquet(
    DATA_DIR / "qb_nextgen_weekly_2019_2026.parquet"
)

proxy = pl.read_parquet(
    DATA_DIR / "qb_starter_proxy_2019_2026.parquet"
)

matchups = pl.read_parquet(
    DATA_DIR / "ml_matchups_v2_2019_2026.parquet"
)


# prepare historical quarterback performances
ngs = (
    ngs
    .filter(
        pl.col("player_gsis_id").is_not_null()
        & (pl.col("attempts") > 0)
    )
    .with_columns(
        (
            pl.col("season") * 100
            + pl.col("week")
        ).alias("week_key")
    )
    .sort([
        "player_gsis_id",
        "week_key",
    ])
)

assert ngs.select(
    pl.struct([
        "player_gsis_id",
        "week_key",
    ]).n_unique()
).item() == ngs.height


# calculate weighted performance totals
ngs = ngs.with_columns([
    (
        pl.col(metric) * pl.col("attempts")
    ).alias(f"weighted_{metric}")
    for metric in QB_METRICS
])

ngs = ngs.with_columns(
    pl.col("attempts")
    .cum_sum()
    .over("player_gsis_id")
    .alias("qb_career_attempts"),

    pl.col("attempts")
    .rolling_sum(
        window_size=3,
        min_samples=1,
    )
    .over("player_gsis_id")
    .alias("qb_recent_attempts"),

    pl.col("attempts")
    .cum_count()
    .over("player_gsis_id")
    .alias("qb_career_appearances"),
)

for metric in QB_METRICS:
    weighted = f"weighted_{metric}"

    ngs = ngs.with_columns(
        pl.col(weighted)
        .cum_sum()
        .over("player_gsis_id")
        .alias(f"career_total_{metric}"),

        pl.col(weighted)
        .rolling_sum(
            window_size=3,
            min_samples=1,
        )
        .over("player_gsis_id")
        .alias(f"recent_total_{metric}"),
    )

    ngs = ngs.with_columns(
        (
            pl.col(f"career_total_{metric}")
            / pl.col("qb_career_attempts")
        ).alias(f"qb_career_{metric}"),

        (
            pl.col(f"recent_total_{metric}")
            / pl.col("qb_recent_attempts")
        ).alias(f"qb_recent_{metric}"),
    )


# create historical qb snapshots
snapshot_columns = [
    "qb_career_attempts",
    "qb_recent_attempts",
    "qb_career_appearances",
]

for metric in QB_METRICS:
    snapshot_columns.extend([
        f"qb_career_{metric}",
        f"qb_recent_{metric}",
    ])

snapshots = ngs.select([
    "player_gsis_id",
    "week_key",
    *snapshot_columns,
])


# prepare projected quarterbacks
proxy = (
    proxy
    .with_columns(
        (
            pl.col("season") * 100
            + pl.col("week")
            - 1
        ).alias("lookup_week_key")
    )
    .select([
        "game_id",
        "season",
        "week",
        "team",
        "side",
        "projected_qb_id",
        "projected_qb_name",
        "lookup_week_key",
    ])
)

assert proxy.select(
    pl.struct(["game_id", "team"]).n_unique()
).item() == proxy.height


# attach previously observed qb performances
projected = (
    proxy
    .sort("lookup_week_key")
    .join_asof(
        snapshots.sort("week_key"),
        left_on="lookup_week_key",
        right_on="week_key",
        by_left="projected_qb_id",
        by_right="player_gsis_id",
        strategy="backward",
    )
)


# verify every matched performance predates the game
assert projected.filter(
    pl.col("week_key").is_not_null()
    & (
        pl.col("week_key")
        >= (
            pl.col("season") * 100
            + pl.col("week")
        )
    )
).is_empty(), "Found current-game QB information."


# identify unavailable qb histories
projected = projected.with_columns(
    pl.col("projected_qb_id")
    .is_null()
    .alias("qb_projection_missing"),

    pl.col("qb_career_attempts")
    .is_null()
    .alias("qb_history_missing"),
)


# prepare home and away quarterback features
home = projected.filter(
    pl.col("side") == "home"
).select([
    "game_id",
    "team",
    "projected_qb_name",
    "qb_projection_missing",
    "qb_history_missing",
    *snapshot_columns,
])

home = home.rename({
    name: f"home_{name}"
    for name in home.columns
    if name not in ["game_id", "team"]
}).rename({
    "team": "home_team"
})

away = projected.filter(
    pl.col("side") == "away"
).select([
    "game_id",
    "team",
    "projected_qb_name",
    "qb_projection_missing",
    "qb_history_missing",
    *snapshot_columns,
])

away = away.rename({
    name: f"away_{name}"
    for name in away.columns
    if name not in ["game_id", "team"]
}).rename({
    "team": "away_team"
})


# join to completed historical matchups
output = (
    matchups.select([
        "game_id",
        "season",
        "week",
        "home_team",
        "away_team",
        "home_win",
    ])
    .join(
        home,
        on=["game_id", "home_team"],
        how="left",
    )
    .join(
        away,
        on=["game_id", "away_team"],
        how="left",
    )
    .sort(["season", "week", "game_id"])
)

assert output.height == matchups.height
assert output["game_id"].n_unique() == output.height

assert output.select(
    pl.col("home_qb_projection_missing")
    .is_not_null().all()
    & pl.col("away_qb_projection_missing")
    .is_not_null().all()
).item(), "Missing team-game joins."


# calculate quarterback matchup differences
for metric in QB_METRICS:
    for prefix in ["career", "recent"]:
        column = f"qb_{prefix}_{metric}"

        output = output.with_columns(
            (
                pl.col(f"home_{column}")
                - pl.col(f"away_{column}")
            ).alias(f"diff_{column}")
        )


# validate and save
numeric_columns = [
    name
    for name in output.columns
    if name.startswith("diff_qb_")
]

for name in numeric_columns:
    values = output[name].drop_nulls().to_numpy()

    assert np.isfinite(values).all(), (
        f"Invalid QB values in {name}"
    )

output.write_parquet(OUTPUT_PATH)

print("PASS: QB matchup features validated.")
print(f"\nSUCCESS: Saved {output.height:,} matchups.")
print(f"Output: {OUTPUT_PATH.name}")


# report data coverage
print("\nQB coverage by evaluation season:")

print(
    output.filter(
        pl.col("season").is_between(2022, 2024)
    )
    .group_by("season")
    .agg(
        pl.len().alias("games"),
        (
            ~pl.col("home_qb_projection_missing")
            & ~pl.col("away_qb_projection_missing")
        ).sum().alias("both_qbs_projected"),
        (
            ~pl.col("home_qb_history_missing")
            & ~pl.col("away_qb_history_missing")
        ).sum().alias("both_histories_available"),
    )
    .sort("season")
)


# inspect a sample
print("\n2024 Week 10 example:")

print(
    output.filter(
        (pl.col("season") == 2024)
        & (pl.col("week") == 10)
    )
    .select([
        "home_team",
        "away_team",
        "home_projected_qb_name",
        "away_projected_qb_name",
        "diff_qb_career_completion_percentage_above_expectation",
        "diff_qb_recent_completion_percentage_above_expectation",
    ])
    .head(8)
)
