
import polars as pl
from pathlib import Path

# load game-level statistics
weekly = pl.read_parquet(
    "data/processed/weekly_team_stats_2026.parquet"
)

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
