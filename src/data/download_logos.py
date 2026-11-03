from pathlib import Path

import nflreadpy as nfl
import requests


# configuration
ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "frontend" / "public" / "logos"
OUTPUT.mkdir(parents=True, exist_ok=True)


# load nfl team information
teams = nfl.load_teams()

print(f"Loaded {teams.height} team records.")

for row in teams.to_dicts():
    abbreviation = row.get("team_abbr")
    logo_url = row.get("team_logo_espn")

    if not abbreviation or not logo_url:
        continue

    # match intercepted team abbreviations
    if abbreviation == "LAR":
        abbreviation = "LA"

    path = OUTPUT / f"{abbreviation}.png"

    try:
        response = requests.get(logo_url, timeout=15)
        response.raise_for_status()

        path.write_bytes(response.content)

        print(f"Saved {abbreviation}.png")

    except requests.RequestException as error:
        print(f"Failed {abbreviation}: {error}")

print(f"\nSUCCESS: Logos saved to {OUTPUT}")