
import csv
import json
import os
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen
from zoneinfo import ZoneInfo


# configuration
ROOT = Path(__file__).resolve().parents[2]
PREDICTIONS = (
    ROOT / "data" / "predictions"
    / "predictions_2026_week_6.csv"
)
OUTPUT = ROOT / "frontend" / "public" / "odds.json"

API_KEY = os.getenv("ODDS_API_KEY")
API_URL = (
    "https://api.the-odds-api.com"
    "/v4/sports/americanfootball_nfl/odds/"
)

TEAMS = {
    "ARI": "Arizona Cardinals",
    "ATL": "Atlanta Falcons",
    "BAL": "Baltimore Ravens",
    "BUF": "Buffalo Bills",
    "CAR": "Carolina Panthers",
    "CHI": "Chicago Bears",
    "CIN": "Cincinnati Bengals",
    "CLE": "Cleveland Browns",
    "DAL": "Dallas Cowboys",
    "DEN": "Denver Broncos",
    "DET": "Detroit Lions",
    "GB": "Green Bay Packers",
    "HOU": "Houston Texans",
    "IND": "Indianapolis Colts",
    "JAX": "Jacksonville Jaguars",
    "KC": "Kansas City Chiefs",
    "LA": "Los Angeles Rams",
    "LAC": "Los Angeles Chargers",
    "LV": "Las Vegas Raiders",
    "MIA": "Miami Dolphins",
    "MIN": "Minnesota Vikings",
    "NE": "New England Patriots",
    "NO": "New Orleans Saints",
    "NYG": "New York Giants",
    "NYJ": "New York Jets",
    "PHI": "Philadelphia Eagles",
    "PIT": "Pittsburgh Steelers",
    "SEA": "Seattle Seahawks",
    "SF": "San Francisco 49ers",
    "TB": "Tampa Bay Buccaneers",
    "TEN": "Tennessee Titans",
    "WAS": "Washington Commanders",
}


# load scheduled predictions
if not API_KEY:
    raise RuntimeError(
        "Set ODDS_API_KEY before running this script."
    )

with PREDICTIONS.open(newline="", encoding="utf-8") as file:
    predictions = list(csv.DictReader(file))

if not predictions:
    raise ValueError("Prediction CSV is empty.")


# fetch sportsbook odds
params = urlencode({
    "apiKey": API_KEY,
    "regions": "us",
    "markets": "h2h,spreads,totals",
    "oddsFormat": "american",
})

try:
    with urlopen(f"{API_URL}?{params}", timeout=30) as response:
        events = json.load(response)

        print(
            "API credits remaining:",
            response.headers.get(
                "x-requests-remaining", "unknown"
            ),
        )
except HTTPError as error:
    raise RuntimeError(
        f"Odds API request failed: HTTP {error.code}"
    ) from error
except URLError as error:
    raise RuntimeError(
        f"Could not reach odds provider: {error.reason}"
    ) from error

print(f"Loaded {len(events)} NFL odds events.")


# select sportsbook markets
def get_market(bookmaker, market_key):
    return next(
        (
            market
            for market in bookmaker.get("markets", [])
            if market.get("key") == market_key
        ),
        None,
    )


def get_outcome(market, name):
    if not market:
        return None

    return next(
        (
            outcome
            for outcome in market.get("outcomes", [])
            if outcome.get("name") == name
        ),
        None,
    )


def get_price(outcome):
    return outcome.get("price") if outcome else None


def get_point(outcome):
    return outcome.get("point") if outcome else None


def select_bookmaker(event):
    bookmakers = event.get("bookmakers", [])

    if not bookmakers:
        return None

    return next(
        (
            book
            for book in bookmakers
            if book.get("key") == "draftkings"
        ),
        bookmakers[0],
    )


# match odds to intercepted games
output = {}

for game in predictions:
    home_name = TEAMS[game["home_team"]]
    away_name = TEAMS[game["away_team"]]

    matching = []

    for event in events:
        kickoff = datetime.fromisoformat(
            event["commence_time"].replace("Z", "+00:00")
        )

        eastern_date = kickoff.astimezone(
            ZoneInfo("America/New_York")
        ).date().isoformat()

        if (
            event["home_team"] == home_name
            and event["away_team"] == away_name
            and eastern_date == game["game_date"]
        ):
            matching.append(event)

    if len(matching) != 1:
        print(
            f"No unique odds match: "
            f"{game['away_team']} @ {game['home_team']}"
        )
        continue

    event = matching[0]
    bookmaker = select_bookmaker(event)

    if bookmaker is None:
        continue

    moneyline = get_market(bookmaker, "h2h")
    spreads = get_market(bookmaker, "spreads")
    totals = get_market(bookmaker, "totals")

    home_ml = get_outcome(moneyline, home_name)
    away_ml = get_outcome(moneyline, away_name)

    home_spread = get_outcome(spreads, home_name)
    away_spread = get_outcome(spreads, away_name)

    over = get_outcome(totals, "Over")
    under = get_outcome(totals, "Under")

    output[game["game_id"]] = {
        "bookmaker": bookmaker["title"],
        "last_update": bookmaker.get("last_update"),
        "commence_time": event["commence_time"],
        "home_moneyline": get_price(home_ml),
        "away_moneyline": get_price(away_ml),
        "home_spread": get_point(home_spread),
        "away_spread": get_point(away_spread),
        "over_under": get_point(over) or get_point(under),
    }


# save exported odds
payload = {
    "exported_at": datetime.now().astimezone().isoformat(),
    "games": output,
}

OUTPUT.parent.mkdir(parents=True, exist_ok=True)

OUTPUT.write_text(
    json.dumps(payload, indent=2),
    encoding="utf-8",
)

print(f"Matched {len(output)} of {len(predictions)} games.")
print(f"SUCCESS: Saved {OUTPUT}")
