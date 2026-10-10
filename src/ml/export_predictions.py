
import csv
import json
from pathlib import Path


# configuration
ROOT = Path(__file__).resolve().parents[2]

SOURCE = (
    ROOT
    / "data"
    / "predictions"
    / "predictions_2026_week_6.csv"
)

OUTPUT = (
    ROOT
    / "frontend"
    / "public"
    / "predictions.json"
)

FLOAT_FIELDS = [
    "home_win_prob_v4_a",
    "away_win_prob_v4_a",
    "home_win_prob_v4_qb_plus",
    "away_win_prob_v4_qb_plus",
    "qb_probability_impact",
    "predicted_winner_probability",
]

INTEGER_FIELDS = [
    "season",
    "week",
    "home_team_latest_week",
    "away_team_latest_week",
]


# load csv predictions
with SOURCE.open(newline="", encoding="utf-8") as file:
    games = list(csv.DictReader(file))

if not games:
    raise ValueError("Prediction CSV is empty.")

for game in games:
    for name in FLOAT_FIELDS:
        game[name] = float(game[name])

    for name in INTEGER_FIELDS:
        value = game.get(name)
        game[name] = int(value) if value else None

    for name in [
        "home_projected_qb_name",
        "away_projected_qb_name",
    ]:
        game[name] = game.get(name) or None


# create json response
data = {
    "season": games[0]["season"],
    "week": games[0]["week"],
    "count": len(games),
    "model": "v4_qb_plus",
    "games": games,
}

OUTPUT.parent.mkdir(parents=True, exist_ok=True)

OUTPUT.write_text(
    json.dumps(data, indent=2),
    encoding="utf-8",
)

print(f"PASS: Exported {len(games)} games.")
print(f"SUCCESS: Saved {OUTPUT}")
