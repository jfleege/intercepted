"""Schedule facts shared by the contextual model's serving path."""
from datetime import date
import math

DIVISIONS = [
    ["BUF", "MIA", "NE", "NYJ"], ["BAL", "CIN", "CLE", "PIT"],
    ["HOU", "IND", "JAX", "TEN"], ["DEN", "KC", "LAC", "LV"],
    ["DAL", "NYG", "PHI", "WAS"], ["CHI", "DET", "GB", "MIN"],
    ["ATL", "CAR", "NO", "TB"], ["ARI", "LA", "SF", "SEA"],
]
CONTEXT_COLUMNS = ["rest_diff", "home_short_week", "away_short_week",
                   "home_extended_rest", "away_extended_rest", "neutral_site", "division_game"]
def context_features(game, rows):
    rest = {}
    day = date.fromisoformat(str(game["gameday"])[:10])
    for side in ("home", "away"):
        team = game[f"{side}_team"]
        prior = [date.fromisoformat(str(r["gameday"])[:10]) for r in rows
                 if r["season"] == game["season"] and r.get("game_type") == "REG"
                 and r["week"] < game["week"] and team in (r["home_team"], r["away_team"])
                 and date.fromisoformat(str(r["gameday"])[:10]) < day]
        days = (day - max(prior)).days if prior else math.nan
        rest[side] = days
    return {"rest_diff": rest["home"] - rest["away"],
            **{f"{side}_short_week": float(rest[side] <= 6) for side in rest},
            **{f"{side}_extended_rest": float(rest[side] >= 10) for side in rest},
            "neutral_site": float(str(game.get("location", "")).lower() == "neutral"),
            "division_game": float(any(game["home_team"] in d and game["away_team"] in d for d in DIVISIONS))}
