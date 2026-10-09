
from argparse import ArgumentParser
from datetime import date
from pathlib import Path

import nflreadpy as nfl
import polars as pl


# configuration
ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "processed"

TEAM_RENAMES = {
    "OAK": "LV",
    "SD": "LAC",
    "STL": "LA",
    "LAR": "LA",
    "JAC": "JAX",
}

parser = ArgumentParser()

parser.add_argument(
    "--season",
    type=int,
    default=2026,
)

parser.add_argument(
    "--week",
    type=int,
    default=6,
)

parser.add_argument(
    "--as-of",
    type=date.fromisoformat,
    default=date(2026, 10, 9),
)

args = parser.parse_args()

SEASON = args.season
WEEK = args.week
AS_OF = args.as_of

assert WEEK >= 2, (
    "This version requires a prior week of games."
)


# load schedule
schedule = nfl.load_schedules(SEASON)

required = [
    "game_id",
    "season",
    "week",
    "game_type",
    "gameday",
    "home_team",
    "away_team",
]

missing = [
    name
    for name in required
    if name not in schedule.columns
]

assert not missing, (
    f"Missing schedule columns: {missing}"
)

schedule = (
    schedule
    .filter(
        (pl.col("season") == SEASON)
        & (pl.col("week") == WEEK)
        & (pl.col("game_type") == "REG")
    )
    .with_columns(
        pl.col("home_team").replace(TEAM_RENAMES),
        pl.col("away_team").replace(TEAM_RENAMES),
        pl.col("gameday")
        .cast(pl.String)
        .str.strptime(pl.Date, "%Y-%m-%d")
        .alias("game_date"),
    )
    .sort(["gameday", "game_id"])
)

assert not schedule.is_empty(), (
    f"No scheduled games found for {SEASON} Week {WEEK}."
)

assert schedule["game_id"].n_unique() == schedule.height

print(
    f"Loaded {schedule.height} scheduled "
    f"games for {SEASON} Week {WEEK}."
)


# identify games after the cutoff date
# same-day games are excluded until kickoff times are checked
upcoming = schedule.filter(
    pl.col("game_date") > AS_OF
)

print(f"\nForecast cutoff date: {AS_OF}")
print(
    f"Games scheduled after cutoff date: "
    f"{upcoming.height}"
)

print("\nUpcoming matchups:")
print(
    upcoming.select([
        "game_id",
        "game_date",
        "home_team",
        "away_team",
    ])
)


# load current historical feature sources
blended = pl.read_parquet(
    DATA_DIR / "blended_team_stats_2019_2026.parquet"
)

v4 = pl.read_parquet(
    DATA_DIR / "pregame_features_v4_2019_2026.parquet"
)

expanded = pl.concat([
    pl.read_parquet(
        DATA_DIR / f"expanded_team_stats_{year}.parquet"
    )
    for year in range(2019, SEASON + 1)
])

ngs = pl.read_parquet(
    DATA_DIR / "qb_nextgen_weekly_2019_2026.parquet"
)

print("\nLoaded historical data sources.")
print(f"Blended team rows: {blended.height:,}")
print(f"V4 team rows: {v4.height:,}")
print(f"Expanded team rows: {expanded.height:,}")
print(f"NGS QB rows: {ngs.height:,}")


# inspect data needed for updated team ratings
print("\nBlended feature columns:")
print(blended.columns)

print("\nExpanded team statistics columns:")
print(expanded.columns)

print("\nV4 feature columns:")
print([
    name
    for name in v4.columns
    if name.startswith("v4_")
])


# identify participating teams
teams = pl.concat([
    upcoming.select(
        pl.col("home_team").alias("team")
    ),
    upcoming.select(
        pl.col("away_team").alias("team")
    ),
]).unique()

team_list = teams["team"].to_list()

assert len(team_list) == upcoming.height * 2, (
    "Unexpected duplicate team in upcoming matchups."
)


# identify most recent primary passer
ngs = (
    ngs
    .filter(
        (pl.col("season") == SEASON)
        & (pl.col("week") < WEEK)
        & (pl.col("attempts") > 0)
        & pl.col("player_gsis_id").is_not_null()
    )
    .with_columns(
        pl.col("team_abbr")
        .replace(TEAM_RENAMES)
        .alias("team")
    )
    .sort(
        [
            "season",
            "week",
            "team",
            "attempts",
            "player_gsis_id",
        ],
        descending=[
            False,
            False,
            False,
            True,
            False,
        ],
    )
    .unique(
        subset=["season", "week", "team"],
        keep="first",
        maintain_order=True,
    )
)

# select each team's latest prior game
recent_qbs = (
    ngs
    .sort(
        ["team", "week"],
        descending=[False, True],
    )
    .unique(
        subset=["team"],
        keep="first",
        maintain_order=True,
    )
    .select([
        "team",
        pl.col("week").alias("last_qb_week"),
        pl.col("player_gsis_id").alias(
            "projected_qb_id"
        ),
        pl.col("player_display_name").alias(
            "projected_qb_name"
        ),
    ])
)

team_qbs = teams.join(
    recent_qbs,
    on="team",
    how="left",
)

print("\nProjected QB coverage:")
print(
    team_qbs.select(
        pl.len().alias("teams"),
        pl.col("projected_qb_id")
        .is_not_null()
        .sum()
        .alias("with_projection"),
    )
)

print("\nProjected quarterbacks:")
print(
    team_qbs.sort("team")
)


# validate source coverage
recent_team_data = (
    expanded
    .filter(
        (pl.col("season") == SEASON)
        & (pl.col("week") < WEEK)
    )
    .select([
        "team",
        "season",
        "week",
    ])
    .group_by("team")
    .agg(
        pl.col("week").max().alias(
            "last_stats_week"
        )
    )
)

coverage = (
    teams
    .join(
        recent_team_data,
        on="team",
        how="left",
    )
    .join(
        team_qbs.select([
            "team",
            "projected_qb_name",
        ]),
        on="team",
        how="left",
    )
    .sort("team")
)

print("\nTeam data coverage:")
print(coverage)

assert coverage.select(
    pl.col("last_stats_week")
    .is_not_null()
    .all()
).item(), (
    "Some teams have no completed-game statistics."
)


# save upcoming matchup staging data
output = (
    upcoming.select([
        "game_id",
        "season",
        "week",
        "game_date",
        "home_team",
        "away_team",
    ])
    .join(
        team_qbs.select([
            pl.col("team").alias("home_team"),
            pl.col("projected_qb_id").alias(
                "home_projected_qb_id"
            ),
            pl.col("projected_qb_name").alias(
                "home_projected_qb_name"
            ),
        ]),
        on="home_team",
        how="left",
    )
    .join(
        team_qbs.select([
            pl.col("team").alias("away_team"),
            pl.col("projected_qb_id").alias(
                "away_projected_qb_id"
            ),
            pl.col("projected_qb_name").alias(
                "away_projected_qb_name"
            ),
        ]),
        on="away_team",
        how="left",
    )
)

assert output.height == upcoming.height
assert output["game_id"].n_unique() == output.height

output_path = (
    DATA_DIR
    / f"upcoming_matchups_{SEASON}_week_{WEEK}.parquet"
)

output.write_parquet(output_path)

print("\nPASS: Upcoming matchup staging data validated.")
print(
    f"SUCCESS: Saved {output.height} "
    "upcoming matchups."
)
print(f"Output: {output_path.name}")

print(
    "\nNOTE: Team efficiency features and final "
    "model predictions have not yet been generated."
)
