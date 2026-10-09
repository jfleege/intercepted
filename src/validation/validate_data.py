
import polars as pl
from pathlib import Path

DATA_DIR = Path("data/processed")

for season in range(2018, 2027):
    path = DATA_DIR / f"weekly_team_stats_{season}.parquet"

    assert path.exists(), f"Missing file: {path}"

    df = pl.read_parquet(path)

    # no duplicate team-game records
    duplicates = df.group_by(["game_id", "team"]).len().filter(
        pl.col("len") > 1
    )

    assert duplicates.is_empty(), (
        f"{season}: Duplicate team-game records found"
    )

    # every game should contain two teams
    games = df.group_by("game_id").agg(
        pl.col("team").n_unique().alias("teams")
    )

    invalid_games = games.filter(pl.col("teams") != 2)

    assert invalid_games.is_empty(), (
        f"{season}: Games found without exactly two teams"
    )

    # EPA should exist for each team-game
    assert df["off_epa"].null_count() == 0
    assert df["def_epa_allowed"].null_count() == 0

    print(
        f"{season}: PASSED | "
        f"{df['game_id'].n_unique()} games | "
        f"{df.height} team records"
    )

print("\nAll historical data validation tests passed!")
