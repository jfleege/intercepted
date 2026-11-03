
from pathlib import Path

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

# load datasets
context = pl.read_parquet(
    DATA_DIR / "game_context_2019_2026.parquet"
)

qb = pl.read_parquet(
    DATA_DIR / "qb_nextgen_weekly_2019_2026.parquet"
)

qb = qb.with_columns(
    pl.col("team_abbr")
    .replace(TEAM_RENAMES)
    .alias("team")
)


# identify primary passer in each game
primary = (
    qb
    .filter(
        pl.col("player_gsis_id").is_not_null()
        & (pl.col("attempts") > 0)
    )
    .sort(
        [
            "season",
            "week",
            "team",
            "attempts",
            "player_gsis_id",
        ],
        descending=[
            False,
            False,
            False,
            True,
            False,
        ],
    )
    .unique(
        subset=["season", "week", "team"],
        keep="first",
        maintain_order=True,
    )
    .select([
        "season",
        "week",
        "team",
        pl.col("player_gsis_id").alias(
            "actual_primary_qb_id"
        ),
        pl.col("player_display_name").alias(
            "actual_primary_qb_name"
        ),
        pl.col("attempts").alias(
            "actual_primary_qb_attempts"
        ),
    ])
)


# create team-game schedule
home = context.select([
    "game_id",
    "season",
    "week",
    "game_date",
    pl.col("home_team").alias("team"),
    pl.lit("home").alias("side"),
])

away = context.select([
    "game_id",
    "season",
    "week",
    "game_date",
    pl.col("away_team").alias("team"),
    pl.lit("away").alias("side"),
])

team_games = (
    pl.concat([home, away])
    .sort([
        "team",
        "season",
        "game_date",
        "game_id",
    ])
)

assert team_games.select(
    pl.struct(["game_id", "team"]).n_unique()
).item() == team_games.height

assert team_games.select(
    pl.struct(["season", "week", "team"]).n_unique()
).item() == team_games.height, (
    "A team has multiple games in one season-week."
)


# attach actual primary passers
team_games = team_games.join(
    primary,
    on=["season", "week", "team"],
    how="left",
)

assert team_games.height == context.height * 2


# project next game's qb using the previous game
team_games = team_games.with_columns(
    pl.col("actual_primary_qb_id")
    .shift(1)
    .over(["team", "season"])
    .alias("projected_qb_id"),

    pl.col("actual_primary_qb_name")
    .shift(1)
    .over(["team", "season"])
    .alias("projected_qb_name"),
)


# evaluate only games with known outcomes
evaluated = team_games.filter(
    pl.col("actual_primary_qb_id").is_not_null()
    & pl.col("projected_qb_id").is_not_null()
)

evaluated = evaluated.with_columns(
    (
        pl.col("actual_primary_qb_id")
        == pl.col("projected_qb_id")
    ).alias("correct_projection")
)

print("\nPrimary passer projection accuracy:")
print(
    evaluated.group_by("season")
    .agg(
        pl.len().alias("team_games"),
        pl.col("correct_projection")
        .mean()
        .alias("accuracy"),
    )
    .sort("season")
)

print("\nOverall:")
print(
    evaluated.select(
        pl.len().alias("evaluated_team_games"),
        pl.col("correct_projection")
        .mean()
        .alias("projection_accuracy"),
    )
)


# inspect missing coverage
print("\nCoverage:")
print(
    team_games.group_by("season")
    .agg(
        pl.len().alias("scheduled_team_games"),
        pl.col("actual_primary_qb_id")
        .is_not_null()
        .sum()
        .alias("actual_qb_available"),
        pl.col("projected_qb_id")
        .is_not_null()
        .sum()
        .alias("projected_qb_available"),
    )
    .sort("season")
)


# inspect incorrect projections
print("\n2024 incorrect projections:")
print(
    evaluated.filter(
        (pl.col("season") == 2024)
        & (~pl.col("correct_projection"))
    )
    .sort(["week", "team"])
    .select([
        "week",
        "team",
        "projected_qb_name",
        "actual_primary_qb_name",
    ])
    .head(15)
)


# save projection dataset
output_path = (
    DATA_DIR / "qb_starter_proxy_2019_2026.parquet"
)

team_games.sort([
    "season",
    "week",
    "team",
]).write_parquet(output_path)

print("\nSUCCESS: QB starter proxy audit completed.")
print(f"Output: {output_path.name}")
