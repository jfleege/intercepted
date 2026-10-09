
import polars as pl
from pathlib import Path

# load historical game-level statistics
weekly = pl.concat([
    pl.read_parquet(
        f"data/processed/weekly_team_stats_{season}.parquet"
    )
    for season in range(2018, 2027)
])

# sort chronologically within each team and season
weekly = weekly.sort(["team", "season", "week", "game_id"])

# create lagged statistics (previous games only)
rolling = weekly.with_columns(
    pl.col("off_epa")
      .shift(1)
      .over(["team", "season"])
      .alias("prior_off_epa"),

    pl.col("def_epa_allowed")
      .shift(1)
      .over(["team", "season"])
      .alias("prior_def_epa"),

    pl.col("off_success")
      .shift(1)
      .over(["team", "season"])
      .alias("prior_success")
)

# calculate rolling and season-to-date averages
rolling = rolling.with_columns(
    pl.col("prior_off_epa")
      .rolling_mean(window_size=3, min_samples=1)
      .over(["team", "season"])
      .alias("off_epa_last3"),

    pl.col("prior_def_epa")
      .rolling_mean(window_size=3, min_samples=1)
      .over(["team", "season"])
      .alias("def_epa_last3"),

    pl.col("prior_success")
      .rolling_mean(window_size=3, min_samples=1)
      .over(["team", "season"])
      .alias("success_last3"),

    (
        pl.col("prior_off_epa")
          .cum_sum()
          .over(["team", "season"])
        /
        pl.col("prior_off_epa")
          .cum_count()
          .over(["team", "season"])
    ).alias("off_epa_season_prior")
)

# display Dallas Cowboys' 2026 results
cowboys = rolling.filter(
    (pl.col("team") == "DAL") &
    (pl.col("season") == 2026)
)

print(
    cowboys.select([
        "season",
        "week",
        "off_epa",
        "off_epa_last3",
        "def_epa_last3",
        "success_last3",
        "off_epa_season_prior"
    ])
)

# validate first games of each season
first_games = (
    rolling.sort(["team", "season", "week", "game_id"])
    .group_by(["team", "season"])
    .first()
)

assert (
    first_games["off_epa_last3"].null_count()
    == first_games.height
), "First games contain unexpected rolling statistics"

assert (
    first_games["off_epa_season_prior"].null_count()
    == first_games.height
), "First games contain unexpected season averages"

print("PASS: First games have no prior-game statistics")

# validate Week 2 against Week 1
week_one = rolling.filter(
    pl.col("week") == 1
).select(["team", "season", "off_epa"])

week_two = rolling.filter(
    pl.col("week") == 2
).join(
    week_one,
    on=["team", "season"],
    how="inner",
    suffix="_week1"
)

assert week_two.select(
    (
        (pl.col("off_epa_last3") - pl.col("off_epa_week1"))
        .abs() < 1e-9
    ).all()
).item(), "Week 2 rolling EPA does not match Week 1"

print("PASS: Week 2 correctly uses Week 1 EPA")

# save validated historical statistics
output = Path("data/processed")
output.mkdir(parents=True, exist_ok=True)

rolling.write_parquet(
    output / "rolling_team_stats_2018_2026.parquet"
)

print(
    f"SUCCESS: Saved {rolling.height} team-game records "
    "across 2018–2026"
)
