
import nflreadpy as nfl
import polars as pl

# load data for the 2026 season
pbp = nfl.load_pbp(2026)

# keep only plays that are either passes or runs, and have non-null EPA, posteam, and defteam
plays = pbp.filter(
    pl.col("play_type").is_in(["pass", "run"])
    & pl.col("epa").is_not_null()
    & pl.col("posteam").is_not_null()
    & pl.col("defteam").is_not_null()
)

# offensive statistics
offense = (
    plays.group_by("posteam")
    .agg(
        pl.len().alias("offensive_plays"),
        pl.col("epa").mean().alias("off_epa"),
        pl.col("success").mean().alias("off_success_rate"),
        pl.col("yards_gained").mean().alias("yards_per_play"),
        pl.col("epa")
          .filter(pl.col("play_type") == "pass")
          .mean()
          .alias("pass_epa"),
        pl.col("epa")
          .filter(pl.col("play_type") == "run")
          .mean()
          .alias("rush_epa"),
        (pl.col("yards_gained") >= 20)
          .mean()
          .alias("explosive_rate"),
    )
    .rename({"posteam": "team"})
)

# defensive statistics
defense = (
    plays.group_by("defteam")
    .agg(
        pl.col("epa").mean().alias("def_epa_allowed"),
        pl.col("success").mean().alias("def_success_allowed"),
    )
    .rename({"defteam": "team"})
)

# merge offensive and defensive statistics
team_stats = (
    offense.join(defense, on="team", how="inner")
    .sort("off_epa", descending=True)
)

# display results
print(
    team_stats.select([
        "team",
        "off_epa",
        "def_epa_allowed",
        "pass_epa",
        "rush_epa",
        "off_success_rate",
        "explosive_rate",
    ]).with_columns(
        pl.col(pl.Float64, pl.Float32).round(3)
    )
)
