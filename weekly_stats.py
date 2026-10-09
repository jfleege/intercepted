
import nflreadpy as nfl
import polars as pl
from pathlib import Path

# load the 2026 season
pbp = nfl.load_pbp(2026)

# keep valid offensive plays
plays = pbp.filter(
    pl.col("season_type") == "REG",
    pl.col("play_type").is_in(["pass", "run"]),
    pl.col("epa").is_not_null(),
    pl.col("posteam").is_not_null(),
    pl.col("defteam").is_not_null()
)

# calculate offensive statistics per game
offense = (
    plays.group_by(["game_id", "week", "posteam"])
    .agg(
        pl.len().alias("off_plays"),
        pl.col("epa").mean().alias("off_epa"),
        pl.col("success").mean().alias("off_success"),
        pl.col("yards_gained").mean().alias("off_yards_per_play")
    )
    .rename({"posteam": "team"})
)

# calculate defensive statistics per game
defense = (
    plays.group_by(["game_id", "defteam"])
    .agg(
        pl.col("epa").mean().alias("def_epa_allowed"),
        pl.col("success").mean().alias("def_success_allowed")
    )
    .rename({"defteam": "team"})
)

# combine offensive and defensive statistics
weekly_stats = (
    offense.join(
        defense,
        on=["game_id", "team"],
        how="inner"
    )
    .sort(["team", "week"])
)

# display results
print(weekly_stats.head(15))

# sve processed data
output = Path("data/processed")
output.mkdir(parents=True, exist_ok=True)

weekly_stats.write_parquet(
    output / "weekly_team_stats_2026.parquet"
)
