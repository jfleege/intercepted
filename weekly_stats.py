
import nflreadpy as nfl
import polars as pl
from pathlib import Path

SEASONS = list(range(2018, 2027))

output = Path("data/processed")
output.mkdir(parents=True, exist_ok=True)

for season in SEASONS:
    print(f"Processing {season}...")

    pbp = nfl.load_pbp(season)

    plays = pbp.filter(
        pl.col("season_type") == "REG",
        pl.col("play_type").is_in(["pass", "run"]),
        pl.col("epa").is_not_null(),
        pl.col("posteam").is_not_null(),
        pl.col("defteam").is_not_null()
    )

    offense = (
        plays.group_by(
            ["game_id", "season", "week", "posteam"]
        )
        .agg(
            pl.len().alias("off_plays"),
            pl.col("epa").mean().alias("off_epa"),
            pl.col("epa").sum().alias("off_total_epa"),
            pl.col("success").mean().alias("off_success"),
            pl.col("yards_gained").mean().alias("off_yards_per_play")
        )
        .rename({"posteam": "team"})
    )

    defense = (
        plays.group_by(["game_id", "defteam"])
        .agg(
            pl.col("epa").mean().alias("def_epa_allowed"),
            pl.col("success").mean().alias("def_success_allowed")
        )
        .rename({"defteam": "team"})
    )

    weekly = (
        offense.join(
            defense,
            left_on=["game_id", "team"],
            right_on=["game_id", "team"],
            how="inner"
        )
        .sort(["team", "week"])
    )

    weekly.write_parquet(
        output / f"weekly_team_stats_{season}.parquet"
    )

    print(f"Saved {season}: {weekly.height} team-game records")
