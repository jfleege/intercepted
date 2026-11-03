
from pathlib import Path

import polars as pl


# configuration
ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "processed"
OUTPUT_DIR = ROOT / "data" / "diagnostics"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

EVALUATION_SEASONS = [2025, 2026]


# load datasets
depth = pl.read_parquet(
    DATA_DIR / "qb_depth_chart_records_2019_2026.parquet"
)

proxy = pl.read_parquet(
    DATA_DIR / "qb_starter_proxy_2019_2026.parquet"
)


# select timestamped qb1 observations
depth = (
    depth
    .filter(
        pl.col("season").is_in(EVALUATION_SEASONS)
        & (pl.col("schema") == "timestamped")
        & (pl.col("pos_rank") == 1)
    )
    .with_columns(
        pl.col("dt")
        .str.to_datetime(
            time_zone="UTC",
            strict=True,
        )
        .alias("snapshot_utc")
    )
    .rename({
        "normalized_team": "team",
        "qb_id": "depth_chart_qb_id",
        "qb_name": "depth_chart_qb_name",
    })
)

assert not depth.is_empty()

assert depth["snapshot_utc"].null_count() == 0


# inspect duplicate qb1 rankings
duplicate_ranks = (
    depth
    .group_by(["team", "snapshot_utc"])
    .agg(
        pl.len().alias("qb1_records")
    )
    .filter(
        pl.col("qb1_records") > 1
    )
)

print(
    "Team-snapshots with multiple QB1 records: "
    f"{duplicate_ranks.height}"
)


# retain one qb1 per team snapshot
# ties are resolved deterministically for this audit
snapshots = (
    depth
    .sort([
        "team",
        "snapshot_utc",
        "depth_chart_qb_id",
    ])
    .unique(
        subset=["team", "snapshot_utc"],
        keep="first",
        maintain_order=True,
    )
    .select([
        "team",
        "snapshot_utc",
        "depth_chart_qb_id",
        "depth_chart_qb_name",
    ])
)

assert snapshots.select(
    pl.struct([
        "team",
        "snapshot_utc",
    ]).n_unique()
).item() == snapshots.height

print(
    f"Loaded {snapshots.height:,} "
    "unique QB1 team-snapshots."
)


# prepare historical team-games
games = (
    proxy
    .filter(
        pl.col("season").is_in(
            EVALUATION_SEASONS
        )
    )
    .with_columns(
        pl.col("game_date")
        .cast(pl.Date)
        .cast(pl.Datetime("us"))
        .dt.replace_time_zone("UTC")
        .alias("cutoff_utc")
    )
)

assert games.select(
    pl.struct([
        "game_id",
        "team",
    ]).n_unique()
).item() == games.height


# select latest pregame snapshot
comparison = (
    games
    .sort("cutoff_utc")
    .join_asof(
        snapshots.sort("snapshot_utc"),
        left_on="cutoff_utc",
        right_on="snapshot_utc",
        by="team",
        strategy="backward",
    )
)

assert comparison.height == games.height

assert comparison.filter(
    pl.col("snapshot_utc").is_not_null()
    & (
        pl.col("snapshot_utc")
        >= pl.col("cutoff_utc")
    )
).is_empty(), (
    "A depth chart was selected after its cutoff."
)

print("PASS: Pregame snapshot timing validated.")


# evaluate completed games only
evaluated = (
    comparison
    .filter(
        pl.col("actual_primary_qb_id")
        .is_not_null()
    )
    .with_columns(
        pl.col("projected_qb_id")
        .is_not_null()
        .alias("previous_available"),

        pl.col("depth_chart_qb_id")
        .is_not_null()
        .alias("depth_available"),
    )
)

evaluated = evaluated.with_columns(
    (
        pl.col("projected_qb_id")
        == pl.col("actual_primary_qb_id")
    )
    .fill_null(False)
    .alias("previous_correct"),

    (
        pl.col("depth_chart_qb_id")
        == pl.col("actual_primary_qb_id")
    )
    .fill_null(False)
    .alias("depth_correct"),
)

print("\nCOMPLETED TEAM-GAME COVERAGE")
print(
    evaluated.group_by("season")
    .agg(
        pl.len().alias("completed_team_games"),
        pl.col("previous_available")
        .sum()
        .alias("previous_available"),
        pl.col("depth_available")
        .sum()
        .alias("depth_available"),
    )
    .sort("season")
)


# compare on identical available observations
shared = evaluated.filter(
    pl.col("previous_available")
    & pl.col("depth_available")
)

assert not shared.is_empty(), (
    "No completed games have both projections."
)

print("\nHEAD-TO-HEAD PROJECTION ACCURACY")
print(
    shared.group_by("season")
    .agg(
        pl.len().alias("team_games"),
        pl.col("previous_correct")
        .mean()
        .alias("previous_accuracy"),
        pl.col("depth_correct")
        .mean()
        .alias("depth_accuracy"),
    )
    .sort("season")
)

print("\nOVERALL HEAD-TO-HEAD")
print(
    shared.select(
        pl.len().alias("team_games"),
        pl.col("previous_correct")
        .mean()
        .alias("previous_accuracy"),
        pl.col("depth_correct")
        .mean()
        .alias("depth_accuracy"),
    )
)


# inspect situations where predictions disagree
disagreements = shared.filter(
    pl.col("projected_qb_id")
    != pl.col("depth_chart_qb_id")
)

print("\nQB PROJECTION DISAGREEMENTS")
print(
    disagreements.select(
        pl.len().alias("team_games"),
        pl.col("previous_correct")
        .mean()
        .alias("previous_accuracy"),
        pl.col("depth_correct")
        .mean()
        .alias("depth_accuracy"),
    )
)

print("\n2025 DISAGREEMENT EXAMPLES")
print(
    disagreements
    .filter(pl.col("season") == 2025)
    .sort(["week", "team"])
    .select([
        "week",
        "team",
        "projected_qb_name",
        "depth_chart_qb_name",
        "actual_primary_qb_name",
        "previous_correct",
        "depth_correct",
    ])
    .head(20)
)


# save audit results
output_path = (
    OUTPUT_DIR / "depth_chart_projection_comparison.csv"
)

evaluated.sort([
    "season",
    "week",
    "team",
]).write_csv(output_path)

print("\nSUCCESS: Depth chart projection audit completed.")
print(f"Output: {output_path.name}")
