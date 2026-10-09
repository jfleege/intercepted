
import csv
import math
import os
from datetime import date
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware


# configuration
ROOT = Path(
    os.getenv(
        "INTERCEPTED_ROOT",
        Path(__file__).resolve().parents[1],
    )
)

PREDICTION_DIR = ROOT / "data" / "predictions"

DEFAULT_SEASON = 2026
DEFAULT_WEEK = 6

app = FastAPI(
    title="Intercepted API",
    description="NFL matchup predictions from the Intercepted models.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


# parse forecast records
REQUIRED_COLUMNS = {
    "game_id",
    "season",
    "week",
    "game_date",
    "home_team",
    "away_team",
    "home_win_prob_v4_a",
    "away_win_prob_v4_a",
    "home_win_prob_v4_qb_plus",
    "away_win_prob_v4_qb_plus",
    "qb_probability_impact",
    "predicted_winner",
    "predicted_winner_probability",
}

OPTIONAL_COLUMNS = (
    "home_projected_qb_name",
    "away_projected_qb_name",
    "home_team_latest_week",
    "away_team_latest_week",
)

PROBABILITY_COLUMNS = (
    "home_win_prob_v4_a",
    "away_win_prob_v4_a",
    "home_win_prob_v4_qb_plus",
    "away_win_prob_v4_qb_plus",
    "predicted_winner_probability",
)


def parse_record(row):
    try:
        item = dict(row)

        item["season"] = int(item["season"])
        item["week"] = int(item["week"])
        item["game_date"] = (
            date.fromisoformat(item["game_date"]).isoformat()
        )

        for field in (*PROBABILITY_COLUMNS, "qb_probability_impact"):
            item[field] = float(item[field])

            if not math.isfinite(item[field]):
                raise ValueError(
                    f"Invalid numeric value: {field}"
                )

        for field in PROBABILITY_COLUMNS:
            if not 0 <= item[field] <= 1:
                raise ValueError(
                    f"Probability outside [0, 1]: {field}"
                )

        if item["predicted_winner"] not in (
            item["home_team"],
            item["away_team"],
        ):
            raise ValueError(
                "Predicted winner is not in the matchup"
            )

        for field in OPTIONAL_COLUMNS:
            value = item.get(field)

            if field.endswith("_week"):
                item[field] = (
                    int(value)
                    if value not in (None, "")
                    else None
                )
            else:
                item[field] = value or None

        return item

    except (TypeError, ValueError, KeyError) as error:
        raise ValueError(
            f"Invalid forecast record "
            f"{row.get('game_id', 'unknown')}: {error}"
        ) from error


def load_predictions(season, week):
    path = (
        PREDICTION_DIR
        / f"predictions_{season}_week_{week}.csv"
    )

    if not path.is_file():
        raise HTTPException(
            status_code=404,
            detail=(
                f"No predictions found for "
                f"{season} Week {week}."
            ),
        )

    try:
        with path.open(
            newline="",
            encoding="utf-8",
        ) as file:
            reader = csv.DictReader(file)

            missing = (
                REQUIRED_COLUMNS
                - set(reader.fieldnames or [])
            )

            if missing:
                raise ValueError(
                    f"Missing CSV columns: {sorted(missing)}"
                )

            games = [
                parse_record(row)
                for row in reader
            ]

        if len({
            game["game_id"]
            for game in games
        }) != len(games):
            raise ValueError(
                "Duplicate game IDs in prediction CSV"
            )

        if any(
            game["season"] != season
            or game["week"] != week
            for game in games
        ):
            raise ValueError(
                "Forecast file contains a different season or week"
            )

        return sorted(
            games,
            key=lambda game: (
                game["game_date"],
                game["game_id"],
            ),
        )

    except (
        OSError,
        UnicodeError,
        csv.Error,
        ValueError,
    ) as error:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Could not load prediction data: {error}"
            ),
        ) from error


# api routes
@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "intercepted-api",
        "version": app.version,
    }


@app.get("/predictions")
def predictions(
    season: int = Query(
        DEFAULT_SEASON,
        ge=2019,
        le=2100,
    ),
    week: int = Query(
        DEFAULT_WEEK,
        ge=1,
        le=18,
    ),
):
    games = load_predictions(season, week)

    return {
        "season": season,
        "week": week,
        "count": len(games),
        "model": "v4_qb_plus",
        "games": games,
    }


@app.get("/predictions/{game_id}")
def prediction(
    game_id: str,
    season: int = Query(
        DEFAULT_SEASON,
        ge=2019,
        le=2100,
    ),
    week: int = Query(
        DEFAULT_WEEK,
        ge=1,
        le=18,
    ),
):
    games = load_predictions(season, week)

    for game in games:
        if game["game_id"] == game_id:
            return game

    raise HTTPException(
        status_code=404,
        detail=f"Game not found: {game_id}",
    )
