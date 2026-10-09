
import polars as pl
import nflreadpy as nfl
from pathlib import Path

# load historical rolling statistics
rolling = pl.read_parquet(
    "data/processed/rolling_team_stats_2018_2026.parquet"
)

# load game schedules and final results
schedules = nfl.load_schedules(list(range(2018, 2027)))

# keep completed regular-season games
games = (
    schedules.filter(
        (pl.col("game_type") == "REG") &
        pl.col("home_score").is_not_null() &
        pl.col("away_score").is_not_null()
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

# select pre-game statistical features
features = [
    "off_epa_last3",
    "def_epa_last3",
    "success_last3",
    "off_epa_season_prior"
]

# prepare home-team features
home = (
    rolling.select(["game_id", "team"] + features)
    .rename({
        "team": "home_team",
        **{col: f"home_{col}" for col in features}
    })
)

# prepare away-team features
away = (
    rolling.select(["game_id", "team"] + features)
    .rename({
        "team": "away_team",
        **{col: f"away_{col}" for col in features}
    })
)

# combine schedules with both teams' features
matchups = (
    games
    .join(home, on=["game_id", "home_team"], how="inner")
    .join(away, on=["game_id", "away_team"], how="inner")
)

# create prediction target
matchups = matchups.with_columns(
    (pl.col("home_score") > pl.col("away_score"))
      .cast(pl.Int8)
      .alias("home_win")
)

# exclude games without sufficient historical data
matchups = matchups.drop_nulls(
    subset=[
        f"{side}_{col}"
        for side in ["home", "away"]
        for col in features
    ]
)

# 10. save the ML-ready dataset
output = Path("data/processed")
output.mkdir(parents=True, exist_ok=True)

matchups.write_parquet(
    output / "ml_matchups_2018_2026.parquet"
)

print(f"Total matchups: {matchups.height}")
print(f"Total features: {len(matchups.columns)}")
print(matchups.head(10))


# verify that every game appears only once
assert matchups["game_id"].n_unique() == matchups.height

# verify all game outcomes are valid
assert matchups["home_win"].is_in([0, 1]).all()

# verify the season range
print(
    matchups.group_by("season")
    .agg(pl.len().alias("games"))
    .sort("season")
)

print("PASS: Matchup dataset validation completed")
