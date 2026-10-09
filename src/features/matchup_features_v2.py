
import polars as pl
import nflreadpy as nfl
from pathlib import Path

DATA_DIR = Path("data/processed")

# load blended team statistics
blended = pl.read_parquet(
    DATA_DIR / "blended_team_stats_2019_2026.parquet"
)

# load historical game schedules
schedules = nfl.load_schedules(
    list(range(2019, 2027))
)

# select completed regular-season games
games = (
    schedules.filter(
        (pl.col("game_type") == "REG") &
        pl.col("home_score").is_not_null() &
        pl.col("away_score").is_not_null() &
        (pl.col("home_score") != pl.col("away_score"))
    )
    .select([
        "game_id",
        "season",
        "week",
        "home_team",
        "away_team",
        "home_score",
        "away_score"
    ])
)

# select predictive features
features = [
    "blended_off_epa",
    "blended_def_epa"
]

# prepare home-team features
home = (
    blended.select(["game_id", "team"] + features)
    .rename({
        "team": "home_team",
        **{col: f"home_{col}" for col in features}
    })
)

# prepare away-team features
away = (
    blended.select(["game_id", "team"] + features)
    .rename({
        "team": "away_team",
        **{col: f"away_{col}" for col in features}
    })
)

# create one row per matchup
matchups = (
    games
    .join(home, on=["game_id", "home_team"], how="inner")
    .join(away, on=["game_id", "away_team"], how="inner")
    .with_columns(
        (pl.col("home_score") > pl.col("away_score"))
          .cast(pl.Int8)
          .alias("home_win")
    )
)

# validate dataset
assert matchups["game_id"].n_unique() == matchups.height

assert matchups.select(
    pl.all().is_not_null().all()
).row(0) == tuple([True] * len(matchups.columns))

print("\nGames by season:")
print(
    matchups.group_by("season")
    .agg(pl.len().alias("games"))
    .sort("season")
)

# save
matchups.write_parquet(
    DATA_DIR / "ml_matchups_v2_2019_2026.parquet"
)

print(f"\nSUCCESS: Saved {matchups.height} matchups")
