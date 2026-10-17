"""Archive forecasts, ingest nflverse results, and export auditable performance."""

import argparse
import csv
import hashlib
import io
import json
import math
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
MODELS = ("v4_a", "v4_qb_plus")
PREDICTIONS = "frontend/public/predictions.json"
METADATA = "models/model_metadata.json"
ALIASES = {"LAR": "LA", "WSH": "WAS", "JAC": "JAX", "OAK": "LV", "SD": "LAC", "STL": "LA"}


def utcnow():
    return datetime.now(timezone.utc).isoformat()


def stamp(value):
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Forecast timestamps must include a timezone")
    return parsed.astimezone(timezone.utc)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n"
    if not path.exists() or path.read_text() != text:
        temporary = path.with_suffix(".tmp")
        temporary.write_text(text)
        temporary.replace(path)


def git(*args, root=ROOT):
    return subprocess.check_output(["git", *args], cwd=root, text=True).strip()


def archive(payload, metadata, observed_at, source, root=ROOT, model_hashes=None):
    """Content-addressed snapshots are create-only; identical reruns are no-ops."""
    stamp(observed_at)
    games = payload.get("games", [])
    if not games or len({g["game_id"] for g in games}) != len(games):
        raise ValueError("Forecast slate is empty or contains duplicate games")
    records = []
    for game in games:
        record = {key: game[key] for key in ("game_id", "season", "week", "game_date", "home_team", "away_team")}
        record["probabilities"] = {}
        for model in MODELS:
            p = game.get(f"home_win_prob_{model}")
            if isinstance(p, bool) or not isinstance(p, (int, float)) or not math.isfinite(p) or not 0 <= p <= 1:
                raise ValueError(f"Invalid probability: {game['game_id']} {model}")
            away = game.get(f"away_win_prob_{model}")
            if away is not None and abs(p + float(away) - 1) > 1e-8:
                raise ValueError("Home and away probabilities must sum to one")
            record["probabilities"][model] = p
        records.append(record)
    # metadata and artifact hashes identify the actual saved model, not only its name.
    identity = {"metadata": metadata, "artifact_git_blob_ids": model_hashes or {}}
    core = {"games": sorted(records, key=lambda g: g["game_id"]), "model_identity": identity}
    snapshot_id = digest(core)
    path = root / "data/tracking/forecasts" / f"{snapshot_id}.json"
    snapshot = {"schema_version": 1, "snapshot_id": snapshot_id, "observed_at": observed_at,
                "provenance": source, **core}
    if path.exists():
        existing = json.loads(path.read_text())
        if {key: existing[key] for key in core} != core:
            raise ValueError("Archive identity collision")
        if stamp(existing["observed_at"]) <= stamp(observed_at):
            return existing
        # preserve the original file while retaining newly discovered earlier evidence.
        snapshot_id = digest({"core": core, "earlier_evidence": observed_at, "source": source})
        path = path.with_name(f"{snapshot_id}.json")
        snapshot["snapshot_id"] = snapshot_id
        if path.exists():
            return json.loads(path.read_text())
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x") as file:
        json.dump(snapshot, file, indent=2, sort_keys=True, allow_nan=False)
        file.write("\n")
    return snapshot


def import_git_history(root=ROOT):
    """Recover only bytes proven present in this branch's committed history."""
    history = git("log", "--reverse", "--format=%H", "HEAD", "--", PREDICTIONS, root=root).splitlines()
    for revision in history:
        try:
            payload = json.loads(git("show", f"{revision}:{PREDICTIONS}", root=root))
            metadata = json.loads(git("show", f"{revision}:{METADATA}", root=root))
            observed = git("show", "-s", "--format=%cI", revision, root=root)
            hashes = {model: git("rev-parse", f"{revision}:models/{model}.joblib", root=root) for model in MODELS}
            archive(payload, metadata, observed, {"kind": "git_commit", "commit": revision,
                    "note": "Repository commit time is evidence of saved bytes, not independent timestamp certification."}, root, hashes)
        except (subprocess.CalledProcessError, ValueError, KeyError) as error:
            raise RuntimeError(f"Could not import forecast commit {revision}") from error


def kickoff(row):
    if not row.get("gameday") or not row.get("gametime"):
        return None
    try:
        # nflverse gametime is US Eastern, including daylight saving time.
        return datetime.fromisoformat(f"{str(row['gameday'])[:10]}T{row['gametime']}").replace(
            tzinfo=ZoneInfo("America/New_York")).astimezone(timezone.utc).isoformat()
    except ValueError:
        return None


def normalize_result(row, now):
    start = kickoff(row)
    home, away = row.get("home_score"), row.get("away_score")
    # schedules publish result only for completed games; don't treat live 0-0 as final.
    final = row.get("result") is not None and home is not None and away is not None
    if final and (not start or stamp(start) >= stamp(now)):
        final = False
    if final and any(not math.isfinite(float(s)) or float(s) < 0 or float(s) != int(s) for s in (home, away)):
        raise ValueError("Invalid final scores")
    status = str(row.get("status", "")).lower()
    state = "cancelled" if status in ("cancelled", "canceled") else "final" if final else "pending"
    return {"game_id": row["game_id"], "season": int(row["season"]), "week": int(row["week"]),
            "game_date": str(row["gameday"])[:10], "home_team": ALIASES.get(row["home_team"], row["home_team"]),
            "away_team": ALIASES.get(row["away_team"], row["away_team"]), "kickoff": start, "status": state,
            "home_score": int(home) if state == "final" else None,
            "away_score": int(away) if state == "final" else None, "source": "nflverse schedules"}


def eligibility(snapshot, game, result):
    if not result or not result.get("kickoff"):
        return "unverified", "Kickoff time unavailable"
    if (game["home_team"], game["away_team"]) != (result["home_team"], result["away_team"]):
        raise ValueError(f"Team identity mismatch for {game['game_id']}")
    metadata = snapshot["model_identity"]["metadata"]
    cutoff = (metadata.get("latest_training_season", 9999), metadata.get("latest_training_week", 9999))
    if cutoff >= (game["season"], game["week"]):
        return "unverified", "Training cutoff reaches target week"
    trained = metadata.get("created_at_utc")
    if not trained or stamp(trained) > stamp(snapshot["observed_at"]):
        return "unverified", "Model timestamp does not precede archive evidence"
    if stamp(snapshot["observed_at"]) >= stamp(result["kickoff"]):
        return "retrospective", "First saved evidence is after kickoff"
    return "verified", "Saved before kickoff with an earlier training cutoff"


def graded_row(snapshot, game, result, model):
    eligible, reason = eligibility(snapshot, game, result)
    p = game["probabilities"][model]
    status = result["status"] if result else "pending"
    tied = status == "final" and result["home_score"] == result["away_score"]
    y = int(result["home_score"] > result["away_score"]) if status == "final" and not tied else None
    correct = ((p >= .5) == bool(y)) if y is not None else None
    clipped = min(1 - 1e-15, max(1e-15, p))
    metadata = snapshot["model_identity"]["metadata"]
    return {**{key: game[key] for key in ("game_id", "season", "week", "game_date", "home_team", "away_team")},
            "model": model, "model_version": digest(snapshot["model_identity"])[:12],
            "training_cutoff": f"{metadata.get('latest_training_season')} W{metadata.get('latest_training_week')}",
            "snapshot_id": snapshot["snapshot_id"], "saved_at": snapshot["observed_at"],
            "provenance": snapshot["provenance"], "eligibility": eligible, "eligibility_reason": reason,
            "kickoff": result.get("kickoff") if result else None, "probability": p,
            "pick": game["home_team"] if p >= .5 else game["away_team"], "status": status,
            "grade": "tie" if tied else "correct" if correct else "incorrect" if correct is False else status,
            "home_score": result.get("home_score") if result else None,
            "away_score": result.get("away_score") if result else None, "outcome": y,
            "brier": (p - y) ** 2 if y is not None else None,
            "log_loss": -(y * math.log(clipped) + (1 - y) * math.log(1 - clipped)) if y is not None else None}


def summary(rows):
    decided = [r for r in rows if r["outcome"] is not None]
    correct = sum(r["grade"] == "correct" for r in decided)
    n = len(decided)
    return {"games": n, "correct": correct, "incorrect": n - correct,
            "ties": sum(r["grade"] == "tie" for r in rows),
            "pending": sum(r["status"] == "pending" for r in rows),
            "cancelled": sum(r["status"] == "cancelled" for r in rows),
            "accuracy": correct / n if n else None,
            "brier": sum(r["brier"] for r in decided) / n if n else None,
            "log_loss": sum(r["log_loss"] for r in decided) / n if n else None}


def metrics(rows):
    decided = sorted((r for r in rows if r["outcome"] is not None), key=lambda r: (r.get("kickoff") or r["game_date"], r["game_id"]))
    # group simultaneous kickoffs; ordering inside a group uses game ID, not outcome.
    trend, accumulated = [], []
    for row in decided:
        accumulated.append(row)
        s = summary(accumulated)
        trend.append({"game_id": row["game_id"], "label": f"{row['away_team']} @ {row['home_team']}",
                      "date": row["game_date"], "game_number": len(accumulated), "correct": row["grade"] == "correct",
                      "game_brier": row["brier"], "accuracy": s["accuracy"], "brier": s["brier"], "log_loss": s["log_loss"]})
    weekly = []
    for season, week in sorted({(r["season"], r["week"]) for r in rows}):
        weekly.append({"season": season, "week": week, **summary([r for r in rows if (r["season"], r["week"]) == (season, week)])})
    calibration = []
    for index in range(10):
        group = [r for r in decided if min(9, int(r["probability"] * 10)) == index]
        n = len(group)
        if not n:
            continue
        observed = sum(r["outcome"] for r in group) / n
        z = 1.96
        center = (observed + z*z/(2*n))/(1+z*z/n)
        radius = z*math.sqrt(observed*(1-observed)/n+z*z/(4*n*n))/(1+z*z/n)
        calibration.append({"bin": f"{index*10}–{(index+1)*10}%", "games": n,
                            "predicted": sum(r["probability"] for r in group)/n, "observed": observed,
                            "lower": center-radius, "upper": center+radius})
    return {"summary": summary(rows), "trend": trend, "weekly": weekly, "calibration": calibration}


def backtest(root=ROOT):
    rows = []
    path = root / "data/diagnostics/qb_experiments_predictions.csv"
    if not path.exists():
        return rows
    seen = set()
    for source in csv.DictReader(io.StringIO(path.read_text())):
        if source["game_id"] in seen:
            raise ValueError("Duplicate backtest game")
        seen.add(source["game_id"])
        season, week = int(source["season"]), int(source["week"])
        for model in MODELS:
            p, y = float(source[f"prob_{model}"]), int(source["home_win"])
            if not 0 <= p <= 1 or y not in (0, 1):
                raise ValueError("Invalid backtest row")
            correct = (p >= .5) == bool(y)
            q = min(1-1e-15, max(1e-15, p))
            rows.append({"game_id": source["game_id"], "season": season, "week": week,
                         "game_date": f"{season} W{week:02d}", "home_team": source["home_team"], "away_team": source["away_team"],
                         "model": model, "model_version": "walk-forward-selected-C", "training_cutoff": f"Before {season}",
                         "snapshot_id": "historical-experiment", "saved_at": None, "kickoff": None,
                         "eligibility": "backtest", "eligibility_reason": "Historical walk-forward experiment; C selected on earlier seasons",
                         "probability": p, "pick": source["home_team"] if p >= .5 else source["away_team"],
                         "status": "final", "grade": "correct" if correct else "incorrect", "home_score": None, "away_score": None,
                         "outcome": y, "brier": (p-y)**2, "log_loss": -(y*math.log(q)+(1-y)*math.log(1-q))})
    return rows


def build_export(snapshots, results, root=ROOT):
    # freeze the first verified pregame snapshot per game and model.
    all_rows = []
    for snapshot in snapshots:
        for game in snapshot["games"]:
            for model in MODELS:
                all_rows.append(graded_row(snapshot, game, results.get(game["game_id"]), model))
    chosen = {}
    for row in sorted(all_rows, key=lambda r: (stamp(r["saved_at"]), r["snapshot_id"])):
        key = (row["game_id"], row["model"])
        if key not in chosen or (chosen[key]["eligibility"] != "verified" and row["eligibility"] == "verified"):
            chosen[key] = row
    datasets = {"verified": [], "retrospective": [], "backtest": backtest(root)}
    for row in chosen.values():
        datasets["verified" if row["eligibility"] == "verified" else "retrospective"].append(row)
    output = {}
    for name, rows in datasets.items():
        output[name] = {model: {"rows": sorted([r for r in rows if r["model"] == model], key=lambda r: (r["game_date"], r["game_id"])),
                                **metrics([r for r in rows if r["model"] == model])} for model in MODELS}
    return {"schema_version": 1, "updated_at": utcnow(), "source": "nflverse schedules / repository forecast archive",
            "policy": "First verified pregame snapshot per game and model; ties excluded from binary metrics; historical experiments separate.",
            "snapshot_count": len(snapshots), "datasets": output}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--import-git-history", action="store_true")
    parser.add_argument("--schedule-json", type=Path, help="Local nflverse schedule rows for offline validation")
    args = parser.parse_args()
    if args.import_git_history:
        import_git_history()
    metadata = json.loads((ROOT / METADATA).read_text())
    hashes = {model: git("hash-object", f"models/{model}.joblib") for model in MODELS}
    archive(json.loads((ROOT / PREDICTIONS).read_text()), metadata, utcnow(), {"kind": "refresh", "commit": git("rev-parse", "HEAD")}, model_hashes=hashes)
    snapshots = [json.loads(p.read_text()) for p in sorted((ROOT / "data/tracking/forecasts").glob("*.json"))]
    ids = {g["game_id"] for s in snapshots for g in s["games"]}
    seasons = sorted({g["season"] for s in snapshots for g in s["games"]})
    if args.schedule_json:
        schedule = json.loads(args.schedule_json.read_text())
    else:
        import nflreadpy as nfl
        schedule = nfl.load_schedules(seasons).to_dicts()
    now = utcnow()
    records = [normalize_result(r, now) for r in schedule if r["game_id"] in ids]
    if len({r["game_id"] for r in records}) != len(records):
        raise ValueError("Duplicate schedule games")
    missing = ids - {r["game_id"] for r in records}
    if missing:
        raise ValueError(f"Schedule is missing archived games: {sorted(missing)}")
    history_path = ROOT / "data/tracking/results.json"
    history = json.loads(history_path.read_text()) if history_path.exists() else {"games": {}, "revisions": []}
    for record in records:
        previous = history["games"].get(record["game_id"])
        if previous != record:
            if previous and previous["status"] == "final" and record["status"] != "final":
                raise ValueError("Completed result disappeared from source; refusing to erase it")
            history["revisions"].append({"observed_at": now, "previous": previous, "result": record})
            history["games"][record["game_id"]] = record
    write_json(history_path, history)
    export = build_export(snapshots, history["games"])
    write_json(ROOT / "frontend/public/performance.json", export)
    print(f"Saved {len(snapshots)} forecast snapshots and {len(records)} game results.")
    for name in export["datasets"]:
        print(name, {model: export["datasets"][name][model]["summary"]["games"] for model in MODELS})


if __name__ == "__main__":
    main()
