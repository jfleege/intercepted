
from pathlib import Path

import nflreadpy as nfl
import polars as pl


# configuration
ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "processed"
DATA_DIR.mkdir(parents=True, exist_ok=True)

SEASONS = list(range(2019, 2027))

TEAM_RENAMES = {
    "OAK": "LV",
    "SD": "LAC",
    "STL": "LA",
}

DIVISIONS = {
    "AFC_EAST": ["BUF", "MIA", "NE", "NYJ"],
    "AFC_NORTH": ["BAL", "CIN", "CLE", "PIT"],
    "AFC_SOUTH": ["HOU", "IND", "JAX", "TEN"],
    "AFC_WEST": ["DEN", "KC", "LAC", "LV"],
    "NFC_EAST": ["DAL", "NYG", "PHI", "WAS"],
    "NFC_NORTH": ["CHI", "DET", "GB", "MIN"],
    "NFC_SOUTH": ["ATL", "CAR", "NO", "TB"],
    "NFC_WEST": ["ARI", "LA", "SF", "SEA"],
}

TEAM_DIVISION = {
    team: division
    for division, teams in DIVISIONS.items()
    for team in teams
}


# load historical schedules
schedules = nfl.load_schedules(SEASONS)

required = [
    "game_id",
    "season",
    "week",
    "game_type",
    "gameday",
    "home_team",
    "away_team",
    "location",
]

missing = [
    name
    for name in required
    if name not in schedules.columns
]

assert not missing, (
    f"Missing schedule columns: {missing}"
)

games = (
    schedules
    .filter(pl.col("game_type") == "REG")
    .with_columns(
        pl.col("home_team").replace(TEAM_RENAMES),
        pl.col("away_team").replace(TEAM_RENAMES),
        pl.col("gameday")
        .cast(pl.String)
        .str.strptime(pl.Date, "%Y-%m-%d")
        .alias("game_date"),
    )
    .select([
        "game_id",
        "season",
        "week",
        "game_date",
        "home_team",
        "away_team",
        "location",
    ])
    .sort(["season", "game_date", "game_id"])
)

assert games["game_id"].n_unique() == games.height

assert games.select(
    pl.col("game_date").is_not_null().all()
).item()

assert games.select(
    pl.col("home_team").is_in(
        list(TEAM_DIVISION)
    ).all()
    & pl.col("away_team").is_in(
        list(TEAM_DIVISION)
    ).all()
).item(), "Unknown team abbreviation."


# build one observation per team-game
home = games.select(
    "game_id",
    "season",
    "week",
    "game_date",
    pl.col("home_team").alias("team"),
)

away = games.select(
    "game_id",
    "season",
    "week",
    "game_date",
    pl.col("away_team").alias("team"),
)

team_games = (
    pl.concat([home, away])
    .sort([
        "team",
        "season",
        "game_date",
        "game_id",
    ])
)

assert team_games.select(
    pl.struct(["game_id", "team"]).n_unique()
).item() == team_games.height


# calculate days since each team's previous game
team_games = team_games.with_columns(
    pl.col("game_date")
    .shift(1)
    .over(["team", "season"])
    .alias("previous_game_date")
)

team_games = team_games.with_columns(
    (
        pl.col("game_date")
        - pl.col("previous_game_date")
    )
    .dt.total_days()
    .alias("rest_days")
)

# first games have no within-season rest history
team_games = team_games.with_columns(
    pl.col("previous_game_date")
    .is_null()
    .alias("first_game"),

    (pl.col("rest_days") <= 6)
    .fill_null(False)
    .alias("short_week"),

    (pl.col("rest_days") >= 10)
    .fill_null(False)
    .alias("extended_rest"),
)

assert team_games.filter(
    pl.col("rest_days").is_not_null()
    & (pl.col("rest_days") <= 0)
).is_empty(), "Invalid chronological game ordering."



# prepare home and away context
home_context = (
    team_games
    .join(
        games.select(["game_id", "home_team"]),
        left_on=["game_id", "team"],
        right_on=["game_id", "home_team"],
        how="inner",
    )
    .select(
        "game_id",
        pl.col("rest_days").alias("home_rest_days"),
        pl.col("short_week").alias("home_short_week"),
        pl.col("extended_rest").alias("home_extended_rest"),
        pl.col("first_game").alias("home_first_game"),
    )
)

away_context = (
    team_games
    .join(
        games.select(["game_id", "away_team"]),
        left_on=["game_id", "team"],
        right_on=["game_id", "away_team"],
        how="inner",
    )
    .select(
        "game_id",
        pl.col("rest_days").alias("away_rest_days"),
        pl.col("short_week").alias("away_short_week"),
        pl.col("extended_rest").alias("away_extended_rest"),
        pl.col("first_game").alias("away_first_game"),
    )
)



# combine matchup-level features
context = (
    games
    .join(home_context, on="game_id", how="left")
    .join(away_context, on="game_id", how="left")
    .with_columns(
        (
            pl.col("home_rest_days")
            - pl.col("away_rest_days")
        ).alias("rest_diff"),

        (
            pl.col("location")
            .cast(pl.String)
            .str.to_lowercase() == "neutral"
        ).alias("neutral_site"),

        (
            pl.col("home_team").replace(TEAM_DIVISION)
            == pl.col("away_team").replace(TEAM_DIVISION)
        ).alias("division_game"),
    )
    .sort(["season", "week", "game_date", "game_id"])
)


# validate game context
assert context.height == games.height
assert context["game_id"].n_unique() == context.height

assert context.select(
    pl.all_horizontal([
        pl.col("home_short_week").is_not_null(),
        pl.col("away_short_week").is_not_null(),
        pl.col("neutral_site").is_not_null(),
        pl.col("division_game").is_not_null(),
    ]).all()
).item()

first_games = context.filter(
    pl.col("home_first_game")
    | pl.col("away_first_game")
)

assert first_games.filter(
    pl.col("home_first_game")
    & pl.col("home_rest_days").is_not_null()
).is_empty()

assert first_games.filter(
    pl.col("away_first_game")
    & pl.col("away_rest_days").is_not_null()
).is_empty()

assert home_context["game_id"].n_unique() == games.height
assert away_context["game_id"].n_unique() == games.height

print("PASS: Game context features validated.")


# save features
output = context.select([
    "game_id",
    "season",
    "week",
    "game_date",
    "home_team",
    "away_team",
    "home_rest_days",
    "away_rest_days",
    "rest_diff",
    "home_short_week",
    "away_short_week",
    "home_extended_rest",
    "away_extended_rest",
    "home_first_game",
    "away_first_game",
    "neutral_site",
    "division_game",
])

output_path = (
    DATA_DIR / "game_context_2019_2026.parquet"
)

output.write_parquet(output_path)

print(f"\nSUCCESS: Saved {output.height} scheduled games.")
print(f"Output: {output_path.name}")

print("\nContext summary:")
print(
    output.select([
        pl.col("home_short_week").sum(),
        pl.col("away_short_week").sum(),
        pl.col("home_extended_rest").sum(),
        pl.col("away_extended_rest").sum(),
        pl.col("neutral_site").sum(),
        pl.col("division_game").sum(),
    ])
)

print("\nDallas Cowboys — 2026:")
print(
    output.filter(
        (pl.col("season") == 2026)
        & (
            (pl.col("home_team") == "DAL")
            | (pl.col("away_team") == "DAL")
        )
    )
    .sort("week")
    .select([
        "week",
        "home_team",
        "away_team",
        "home_rest_days",
        "away_rest_days",
        "rest_diff",
        "neutral_site",
        "division_game",
    ])
    .head(8)
)

