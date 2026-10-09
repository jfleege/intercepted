
import polars as pl
from pathlib import Path

# configuration
DATA_DIR = Path("data/processed")

MAX_CURRENT_WEIGHT = 0.70
PRIOR_STRENGTH = 4.0


# load historical statistics
weekly = pl.read_parquet(
    DATA_DIR / "rolling_team_stats_2018_2026.parquet"
)

preseason = pl.read_parquet(
    DATA_DIR / "preseason_strength_2019_2026.parquet"
)

# rename target_season for joining
preseason = preseason.rename({
    "target_season": "season"
})


# join preseason strength to game data
df = (
    weekly.join(
        preseason.select([
            "team",
            "season",
            "preseason_off_epa",
            "preseason_def_epa"
        ]),
        on=["team", "season"],
        how="inner"
    )
    .sort(["team", "season", "week", "game_id"])
)


# calculate play-weighted current-season EPA using only previously completed games
groups = ["team", "season"]

df = df.with_columns(
    #  number of games completed before this matchup
    (
        pl.col("game_id").cum_count().over(groups) - 1
    ).alias("games_played_prior"),

    # offensive totals from previous games only
    pl.col("off_total_epa")
      .cum_sum()
      .shift(1)
      .over(groups)
      .fill_null(0)
      .alias("prior_off_total_epa"),

    pl.col("off_plays")
      .cum_sum()
      .shift(1)
      .over(groups)
      .fill_null(0)
      .alias("prior_off_plays"),

    # defensive totals from previous games only
    pl.col("def_total_epa")
      .cum_sum()
      .shift(1)
      .over(groups)
      .fill_null(0)
      .alias("prior_def_total_epa"),

    pl.col("def_plays")
      .cum_sum()
      .shift(1)
      .over(groups)
      .fill_null(0)
      .alias("prior_def_plays")
)

# calculate true cumulative EPA per play
df = df.with_columns(
    pl.when(pl.col("prior_off_plays") > 0)
      .then(
          pl.col("prior_off_total_epa")
          / pl.col("prior_off_plays")
      )
      .otherwise(None)
      .alias("current_off_epa"),

    pl.when(pl.col("prior_def_plays") > 0)
      .then(
          pl.col("prior_def_total_epa")
          / pl.col("prior_def_plays")
      )
      .otherwise(None)
      .alias("current_def_epa")
)


# calculate dynamic weights
df = df.with_columns(
    pl.min_horizontal(
        pl.lit(MAX_CURRENT_WEIGHT),
        pl.col("games_played_prior")
          / (pl.col("games_played_prior") + PRIOR_STRENGTH)
    ).alias("current_weight")
)

df = df.with_columns(
    (1 - pl.col("current_weight"))
      .alias("preseason_weight")
)

# calculate blended EPA
df = df.with_columns(
    (
        pl.col("current_weight")
        * pl.col("current_off_epa")
          .fill_null(pl.col("preseason_off_epa"))
        +
        pl.col("preseason_weight")
        * pl.col("preseason_off_epa")
    ).alias("blended_off_epa"),

    (
        pl.col("current_weight")
        * pl.col("current_def_epa")
          .fill_null(pl.col("preseason_def_epa"))
        +
        pl.col("preseason_weight")
        * pl.col("preseason_def_epa")
    ).alias("blended_def_epa")
)

# validate results
assert df["blended_off_epa"].null_count() == 0
assert df["blended_def_epa"].null_count() == 0

assert df.select(
    pl.col("current_weight").is_between(
        0, MAX_CURRENT_WEIGHT
    ).all()
).item()

week_one = df.filter(
    pl.col("games_played_prior") == 0
)

assert week_one.select(
    (
        pl.col("blended_off_epa")
        - pl.col("preseason_off_epa")
    ).abs().lt(1e-9).all()
).item()

assert week_one.select(
    (
        pl.col("blended_def_epa")
        - pl.col("preseason_def_epa")
    ).abs().lt(1e-9).all()
).item()

assert df.select(
    pl.struct(["game_id", "team"]).n_unique()
).item() == df.height

print("PASS: Blended statistics validated")



# additional V3 validation tests
# week 1 should contain no current-season games
first_games = df.filter(
    pl.col("games_played_prior") == 0
)

assert first_games.height == 32 * 8

assert first_games.select(
    (pl.col("prior_off_plays") == 0).all()
).item()

assert first_games.select(
    (pl.col("prior_def_plays") == 0).all()
).item()

# check EPA identities for all rows with prior plays
valid_off = df.filter(pl.col("prior_off_plays") > 0)

assert valid_off.select(
    (
        pl.col("current_off_epa")
        - (
            pl.col("prior_off_total_epa")
            / pl.col("prior_off_plays")
        )
    ).abs().max() < 1e-9
).item()

valid_def = df.filter(pl.col("prior_def_plays") > 0)

assert valid_def.select(
    (
        pl.col("current_def_epa")
        - (
            pl.col("prior_def_total_epa")
            / pl.col("prior_def_plays")
        )
    ).abs().max() < 1e-9
).item()

# verify first-game blended values equal preseason
assert first_games.select(
    (
        pl.col("blended_off_epa")
        - pl.col("preseason_off_epa")
    ).abs().max() < 1e-9
).item()

assert first_games.select(
    (
        pl.col("blended_def_epa")
        - pl.col("preseason_def_epa")
    ).abs().max() < 1e-9
).item()

print("PASS: V3 play-weighted EPA validation")


# inspect Dallas Cowboys in 2026
cowboys = df.filter(
    (pl.col("team") == "DAL") &
    (pl.col("season") == 2026)
)

print("\nDallas Cowboys — 2026")
print(
    cowboys.select([
        "week",
        "games_played_prior",
        "current_weight",
        "preseason_weight",
        "current_off_epa",
        "preseason_off_epa",
        "blended_off_epa",
        "blended_def_epa"
    ]).with_columns(
        pl.col(pl.Float64, pl.Float32).round(3)
    )
)

# save results
df.write_parquet(
    DATA_DIR / "blended_team_stats_2019_2026.parquet"
)

print(
    f"\nSUCCESS: Saved {df.height} blended "
    "team-game records."
)
