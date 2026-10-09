
import polars as pl
from pathlib import Path

# configuration
START_SEASON = 2018
END_SEASON = 2026

OFF_REGRESSION = 0.65
DEF_REGRESSION = 0.65

DATA_DIR = Path("data/processed")

# load historical team-game statistics
weekly = pl.concat([
    pl.read_parquet(
        DATA_DIR / f"weekly_team_stats_{season}.parquet"
    )
    for season in range(START_SEASON, END_SEASON)
])

# aggregate each team's previous-season performance
season_stats = (
    weekly.group_by(["team", "season"])
    .agg(
        pl.col("off_total_epa").sum().alias("total_off_epa"),
        pl.col("off_plays").sum().alias("total_off_plays"),
        pl.col("def_epa_allowed").mean().alias("def_epa"),
        pl.col("off_success").mean().alias("off_success"),
        pl.len().alias("games_played")
    )
    .with_columns(
        (
            pl.col("total_off_epa")
            / pl.col("total_off_plays")
        ).alias("off_epa")
    )
)

# calculate league averages for each season
league_stats = (
    season_stats.group_by("season")
    .agg(
        (
            pl.col("total_off_epa").sum()
            / pl.col("total_off_plays").sum()
        ).alias("league_off_epa"),

        pl.col("def_epa").mean().alias("league_def_epa"),

        pl.col("off_success").mean().alias(
            "league_off_success"
        )
    )
)

# join team performance to league averages
historical = season_stats.join(
    league_stats,
    on="season",
    how="left"
)

# create preseason estimates for the NEXT season
preseason = (
    historical.with_columns(
        (pl.col("season") + 1).alias("target_season"),

        (
            pl.col("league_off_epa")
            + OFF_REGRESSION * (
                pl.col("off_epa")
                - pl.col("league_off_epa")
            )
        ).alias("preseason_off_epa"),

        (
            pl.col("league_def_epa")
            + DEF_REGRESSION * (
                pl.col("def_epa")
                - pl.col("league_def_epa")
            )
        ).alias("preseason_def_epa")
    )
    .select([
        "team",
        "target_season",
        "season",
        "games_played",
        "preseason_off_epa",
        "preseason_def_epa"
    ])
    .rename({"season": "source_season"})
)

# validate the season relationship
assert preseason.select(
    (
        pl.col("target_season")
        == pl.col("source_season") + 1
    ).all()
).item()

assert preseason.select(
    pl.col("preseason_off_epa").is_not_null().all()
).item()

assert preseason.select(
    pl.col("preseason_def_epa").is_not_null().all()
).item()

assert preseason.select(
    pl.struct(["team", "target_season"]).n_unique()
).item() == preseason.height

# display 2026 preseason estimates
rankings = (
    preseason
    .filter(pl.col("target_season") == 2026)
    .sort("preseason_off_epa", descending=True)
)

print("\n2026 Preseason Offensive Rankings")
print(
    rankings.select([
        "team",
        "preseason_off_epa",
        "preseason_def_epa"
    ])
    .with_columns(
        pl.col(pl.Float64, pl.Float32).round(3)
    )
)

# save preseason estimates
preseason.write_parquet(
    DATA_DIR / "preseason_strength_2019_2026.parquet"
)

print("\nSUCCESS: Preseason strength estimates saved.")
print(f"Total team-season records: {preseason.height}")
