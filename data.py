
import nflreadpy as nfl
import polars as pl

pbp = nfl.load_pbp(2026)

# Focus on offensive plays with valid EPA
plays = pbp.filter(
    (pl.col("play_type").is_in(["pass", "run"])) &
    (pl.col("epa").is_not_null())
)

# Calculate team offensive efficiency
team_stats = (
    plays.group_by("posteam")
    .agg(
        pl.len().alias("plays"),
        pl.col("epa").mean().alias("offensive_epa_per_play"),
        pl.col("success").mean().alias("success_rate"),
        pl.col("yards_gained").mean().alias("yards_per_play")
    )
    .sort("offensive_epa_per_play", descending=True)
)

print(team_stats)
