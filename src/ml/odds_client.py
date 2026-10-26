"""Small server-side Odds API client; credentials never enter saved JSON or errors."""
import argparse
import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen
from src.ml.refresh_performance import ROOT, utcnow, write_json

TEAMS = {'ARI': 'Arizona Cardinals', 'ATL': 'Atlanta Falcons', 'BAL': 'Baltimore Ravens', 'BUF': 'Buffalo Bills', 'CAR': 'Carolina Panthers', 'CHI': 'Chicago Bears', 'CIN': 'Cincinnati Bengals', 'CLE': 'Cleveland Browns', 'DAL': 'Dallas Cowboys', 'DEN': 'Denver Broncos', 'DET': 'Detroit Lions', 'GB': 'Green Bay Packers', 'HOU': 'Houston Texans', 'IND': 'Indianapolis Colts', 'JAX': 'Jacksonville Jaguars', 'KC': 'Kansas City Chiefs', 'LA': 'Los Angeles Rams', 'LAC': 'Los Angeles Chargers', 'LV': 'Las Vegas Raiders', 'MIA': 'Miami Dolphins', 'MIN': 'Minnesota Vikings', 'NE': 'New England Patriots', 'NO': 'New Orleans Saints', 'NYG': 'New York Giants', 'NYJ': 'New York Jets', 'PHI': 'Philadelphia Eagles', 'PIT': 'Pittsburgh Steelers', 'SEA': 'Seattle Seahawks', 'SF': 'San Francisco 49ers', 'TB': 'Tampa Bay Buccaneers', 'TEN': 'Tennessee Titans', 'WAS': 'Washington Commanders'}

USAGE_PATH = "frontend/public/odds_usage.json"

class OddsError(RuntimeError):
    pass


def nonnegative(value):
    try:
        number = int(value)
        return number if number >= 0 and str(number) == str(value) else None
    except (ValueError, TypeError):
        return None


def record_usage(headers, kind, root=ROOT, now=None):
    usage = {"schema_version": 1, "provider": "The Odds API", "observed_at": now or utcnow(),
             "remaining": nonnegative(headers.get("x-requests-remaining")),
             "used": nonnegative(headers.get("x-requests-used")),
             "last_cost": nonnegative(headers.get("x-requests-last")), "request_kind": kind}
    write_json(root / USAGE_PATH, usage)
    return usage


class OddsClient:
    def __init__(self, key, root=ROOT, opener=urlopen, now=utcnow):
        if not key:
            raise OddsError("ODDS_API_KEY is unavailable; keeping saved quotes.")
        self.key, self.root, self.opener, self.now = key, root, opener, now

    def request(self, path, params=None, kind="props"):
        query = urlencode({**(params or {}), "apiKey": self.key})
        try:
            with self.opener("https://api.the-odds-api.com/v4/" + path + "?" + query, timeout=30) as response:
                usage = record_usage(response.headers, kind, self.root, self.now())
                data = json.load(response)
                return data, usage
        except HTTPError as error:
            record_usage(error.headers or {}, kind, self.root, self.now())
            raise OddsError(f"Odds API returned HTTP {error.code}; no automatic retry.") from None
        except (URLError, TimeoutError, OSError, ValueError):
            raise OddsError("Odds API response unavailable or invalid; no automatic retry.") from None

    def balance(self):
        # Provider-documented zero-credit endpoint. Never request odds to inspect usage.
        return self.request("sports/", kind="balance")[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--status", action="store_true", required=True)
    parser.parse_args()
    try:
        usage = OddsClient(os.getenv("ODDS_API_KEY")).balance()
        print(json.dumps(usage))
    except OddsError as error:
        print(str(error))


if __name__ == "__main__":
    main()
