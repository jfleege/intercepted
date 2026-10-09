
import polars as pl
from pathlib import Path

# load game-level statistics
weekly = pl.concat([
    pl.read_parquet(
        f"data/processed/weekly_team_stats_{season}.parquet"
    )
    for season in range(2018, 2027)
])

weekly = weekly.sort(["team", "season", "week", "game_id"])

# sort each team's games chronologically
weekly = weekly.sort(["team", "week", "game_id"])


# create lagged statistics (previous games only)
rolling = weekly.with_columns(
    pl.col("off_epa").shift(1).over("team").alias("prior_off_epa"),
    pl.col("def_epa_allowed").shift(1).over("team").alias("prior_def_epa"),
    pl.col("off_success").shift(1).over("team").alias("prior_success")
)

# calculate rolling and cumulative averages
rolling = rolling.with_columns(
    pl.col("prior_off_epa")
      .rolling_mean(window_size=3, min_samples=1)
      .over("team")
      .alias("off_epa_last3"),

    pl.col("prior_def_epa")
      .rolling_mean(window_size=3, min_samples=1)
      .over("team")
      .alias("def_epa_last3"),

    pl.col("prior_success")
      .rolling_mean(window_size=3, min_samples=1)
      .over("team")
      .alias("success_last3"),

    (
        pl.col("prior_off_epa").cum_sum().over("team")
        /
        pl.col("prior_off_epa").cum_count().over("team")
    ).alias("off_epa_season_prior")
)

# show the Dallas Cowboys' results as an example
cowboys = rolling.filter(
    pl.col("team") == "DAL"
)

print(
    cowboys.select([
        "week",
        "off_epa",
        "off_epa_last3",
        "def_epa_last3",
        "success_last3",
        "off_epa_season_prior"
    ])
)

# save for future ML modeling
output = Path("data/processed")
output.mkdir(parents=True, exist_ok=True)

rolling.write_parquet(
    output / "rolling_team_stats_2026.parquet"
)


# check first games of each season
first_games = (
    rolling.sort(["team", "season", "week", "game_id"])
    .group_by(["team", "season"])
    .first()
)

assert first_games["off_epa_last3"].null_count() == first_games.height
assert first_games["off_epa_season_prior"].null_count() == first_games.height

print("PASS: First games have no prior-season statistics")

# check that Week 2 uses Week 1 where both games exist
week_one = rolling.filter(pl.col("week") == 1).select(
    ["team", "season", "off_epa"]
)

week_two = rolling.filter(pl.col("week") == 2).join(
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
