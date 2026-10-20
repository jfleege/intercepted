"""Export navigable weeks from immutable archives; never reconstruct old model predictions."""
import json
from src.ml.refresh_performance import ROOT, eligibility, stamp, utcnow, write_json
from src.ml.model_registry import MODELS, LABELS

def export_history(root=ROOT):
    archive = root / "data/tracking/forecasts"
    snapshots = sorted((json.loads(p.read_text()) for p in archive.glob("*.json")),
                       key=lambda s: (stamp(s["observed_at"]), s["snapshot_id"]))
    results_path = root / "data/tracking/results.json"
    results = json.loads(results_path.read_text())["games"] if results_path.exists() else {}
    chosen, info = {}, {}
    for snapshot in snapshots:
        for game in snapshot["games"]:
            result = results.get(game["game_id"])
            for model in game["probabilities"]:
                if model not in MODELS or eligibility(snapshot, game, result, model)[0] != "verified":
                    continue
                key = (game["game_id"], model)
                # Last timestamped pregame revision, separately for each model.
                chosen[key] = (game, snapshot)
                info[game["game_id"]] = game
    weeks = []
    for season, week in sorted({(g["season"], g["week"]) for g in info.values()}, reverse=True):
        records = []
        for game_id, original in sorted(info.items()):
            if (original["season"], original["week"]) != (season, week):
                continue
            record = {k: original[k] for k in ("game_id", "season", "week", "game_date", "home_team", "away_team")}
            record["model_evidence"] = {}
            for model in MODELS:
                if (game_id, model) not in chosen:
                    continue
                game, snapshot = chosen[(game_id, model)]
                p = game["probabilities"][model]
                record[f"home_win_prob_{model}"] = p
                record[f"away_win_prob_{model}"] = 1 - p
                record["model_evidence"][model] = {"saved_at": snapshot["observed_at"], "snapshot_id": snapshot["snapshot_id"]}
                for side in ("home", "away"):
                    for field in ("projected_qb_name", "projected_qb_id", "qb_selection"):
                        key = f"{side}_{field}"
                        if key in game:
                            record[key] = game[key]
            result = results.get(game_id, {})
            record["result"] = {k: result.get(k) for k in ("status", "home_score", "away_score", "kickoff")}
            records.append(record)
        available = [m for m in MODELS if records and all(f"home_win_prob_{m}" in g for g in records)]
        filename = f"predictions/{season}-week-{week}.json"
        payload = {"season": season, "week": week, "count": len(records), "games": records,
                   "models": available, "archived": True,
                   "policy": "Latest saved pregame revision per model. Performance retains the first verified forecast."}
        write_json(root / "frontend/public" / filename, payload)
        weeks.append({"season": season, "week": week, "count": len(records), "file": filename, "models": available})
    index = {"weeks": weeks, "labels": LABELS}
    write_json(root / "frontend/public/prediction_weeks.json", index)
    return index

if __name__ == "__main__":
    print(export_history())
