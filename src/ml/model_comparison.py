"""Research only: nested temporal evaluation; never write production models or predictions."""
import json
import os
from pathlib import Path
import hashlib
from datetime import datetime, timezone
import joblib
import numpy as np
import polars as pl
from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss
from src.ml.model_comparison_data import df, MODEL_COLUMNS, ROOT

OUT = ROOT / "research/week6"
OUT.mkdir(parents=True, exist_ok=True)
# Fix both training and evaluation boundaries before examining candidate results.
df = df.filter((pl.col("season") < 2026) | ((pl.col("season") == 2026) & (pl.col("week") <= 6)))
context_cols = ["rest_diff", "home_short_week", "away_short_week",
                "home_extended_rest", "away_extended_rest", "neutral_site", "division_game"]
context = pl.read_parquet(ROOT / "data/processed/game_context_2019_2026.parquet")
df = df.join(context.select("game_id", *context_cols), on="game_id", how="left", validate="1:1")
base = MODEL_COLUMNS["v4_qb_plus"]
columns = {"QB retuned": base, "QB + context": base + context_cols, "Gradient boosted": base + context_cols}
grids = {
    "QB retuned": [{"C": c} for c in [0.001, 0.01, 0.03, 0.1, 1.0]],
    "QB + context": [{"C": c} for c in [0.001, 0.01, 0.03, 0.1, 1.0]],
    "Gradient boosted": [{"leaves": l, "l2": r} for l in [3, 7] for r in [1., 10.]],
}
X = {name: df.select(cs).cast(pl.Float64).to_numpy() for name, cs in columns.items()}
y = df["home_win"].to_numpy().astype(int)
seasons, weeks = df["season"].to_numpy(), df["week"].to_numpy()
assert not any(np.isinf(a).any() for a in X.values())

def make(name, params):
    clf = (HistGradientBoostingClassifier(max_iter=150, learning_rate=.05,
           max_leaf_nodes=params["leaves"], min_samples_leaf=30,
           l2_regularization=params["l2"], early_stopping=False, random_state=42)
           if name == "Gradient boosted" else
           LogisticRegression(C=params["C"], max_iter=2000, random_state=42))
    return Pipeline([("imputer", SimpleImputer(strategy="median", keep_empty_features=True)),
                     ("scaler", StandardScaler()), ("classifier", clf)])

def metrics(actual, p):
    assert len(actual) and np.isfinite(p).all()
    return {"games": len(actual), "correct": int(((p >= .5) == actual).sum()),
            "accuracy": float(accuracy_score(actual, p >= .5)),
            "brier": float(brier_score_loss(actual, p)),
            "log_loss": float(log_loss(actual, p, labels=[0, 1]))}

rankings = []
def select(name, outer):
    # Only seasons earlier than outer are used to choose settings.
    options = []
    for params in grids[name]:
        truth, probs = [], []
        for inner in range(2021, outer):
            train, test = seasons < inner, seasons == inner
            model = make(name, params).fit(X[name][train], y[train])
            truth.extend(y[test])
            probs.extend(model.predict_proba(X[name][test])[:, 1])
        m = metrics(np.array(truth), np.array(probs))
        options.append((params, m))
        rankings.append({"model": name, "outer": outer, "params": params, **m})
    # Optimize historical held-out accuracy; use Brier to break ties.
    return min(options, key=lambda p: (-p[1]["accuracy"], p[1]["brier"]))[0]

rows, predictions, choices = [], [], {}
# Historical evaluation matches the existing benchmark years; 2025 is a separate check.
for name in columns:
    historical_p, historical_y = [], []
    for outer in [2022, 2023, 2024, 2025]:
        params = select(name, outer)
        train, test = seasons < outer, seasons == outer
        fitted = make(name, params).fit(X[name][train], y[train])
        p = fitted.predict_proba(X[name][test])[:, 1]
        rows.append({"model": name, "split": str(outer), "params": params, **metrics(y[test], p)})
        if outer <= 2024:
            historical_p.extend(p)
            historical_y.extend(y[test])
    rows.append({"model": name, "split": "historical_2022_2024",
                 **metrics(np.array(historical_y), np.array(historical_p))})
    params = select(name, 2026)
    choices[name] = params
    train = (seasons < 2026) | ((seasons == 2026) & (weeks < 6))
    test = (seasons == 2026) & (weeks == 6)
    assert not np.any(train & test)
    fitted = make(name, params).fit(X[name][train], y[train])
    rows.append({"model": name, "split": "training_through_2026_W5", "params": params,
                 **metrics(y[train], fitted.predict_proba(X[name][train])[:, 1])})
    p = fitted.predict_proba(X[name][test])[:, 1]
    rows.append({"model": name, "split": "week6_retrospective", "params": params, **metrics(y[test], p)})
    for game, prob in zip(df.filter(pl.Series(test)).select("game_id", "home_team", "away_team", "home_win").to_dicts(), p):
        predictions.append({"model": name, **game, "home_probability": float(prob),
                            "pick": game["home_team"] if prob >= .5 else game["away_team"],
                            "correct": bool((prob >= .5) == game["home_win"])})
    joblib.dump(fitted, OUT / (name.lower().replace(" ", "_").replace("+", "plus") + ".joblib"))

# Frozen production weights get the same rebuilt features for the Week 6 comparison.
test = (seasons == 2026) & (weeks == 6)
production = joblib.load(ROOT / "models/v4_qb_plus.joblib")
p = production.predict_proba(X["QB retuned"][test])[:, 1]
rows.append({"model": "Production QB+ rebuilt inputs", "split": "week6_retrospective", **metrics(y[test], p)})
for game, prob in zip(df.filter(pl.Series(test)).select("game_id", "home_team", "away_team", "home_win").to_dicts(), p):
    predictions.append({"model": "Production QB+ rebuilt inputs", **game, "home_probability": float(prob),
                        "pick": game["home_team"] if prob >= .5 else game["away_team"],
                        "correct": bool((prob >= .5) == game["home_win"])})
df.write_parquet(OUT / "evaluation_features.parquet")
fingerprint = hashlib.sha256((OUT / "evaluation_features.parquet").read_bytes()).hexdigest()
report = {"generated_at": datetime.now(timezone.utc).isoformat(), "commit": os.getenv("GITHUB_SHA"),
          "features_sha256": fingerprint, "feature_columns": columns, "selected_settings": choices,
          "results": rows, "predictions": predictions,
          "limitations": [
              "Retrospective Week 6 reconstruction, not forecasts actually issued before kickoff.",
              "Upstream historical statistics may have been corrected since the games.",
              "QB selection uses previous-game passer proxy consistently; sourced starter overrides are not applied.",
              "Week 6 outcomes are used only for grading, never fitting or selecting settings.",
              "2022-2024 has been used for prior model research; 2025 and future prospective weeks matter too.",
              "No guarantee that any model exceeds 66.3%; do not merge based on training accuracy."
          ]}
(OUT / "comparison.json").write_text(json.dumps(report, indent=2, allow_nan=False))
lines = ["# Week 6 model comparison", "", "Research only; no production replacement.", "",
         "| Model | Training accuracy | 2022–2024 held-out | 2025 held-out | Week 6 | Week 6 Brier |",
         "|---|---:|---:|---:|---:|---:|"]
for name in columns:
    lookup = {r["split"]: r for r in rows if r["model"] == name}
    tr, hi, va, w = [lookup[k] for k in ["training_through_2026_W5", "historical_2022_2024", "2025", "week6_retrospective"]]
    lines.append(f'| {name} | {tr["accuracy"]:.2%} | {hi["accuracy"]:.2%} ({hi["games"]}) | {va["accuracy"]:.2%} | {w["correct"]}/{w["games"]} ({w["accuracy"]:.2%}) | {w["brier"]:.4f} |')
lines += ["", "Existing archived benchmark: 66.2977% on 813 games (2022–2024).", "",
          *["- " + s for s in report["limitations"]], "", "## Game-by-game", "",
          "| Game | Model | Pick | Home probability | Correct |", "|---|---|---|---:|---|"]
for r in predictions:
    lines.append(f'| {r["game_id"]} | {r["model"]} | {r["pick"]} | {r["home_probability"]:.2%} | {r["correct"]} |')
summary = "\n".join(lines) + "\n"
(OUT / "REPORT.md").write_text(summary)
(OUT / "tuning.json").write_text(json.dumps(rankings, indent=2))
if os.getenv("GITHUB_STEP_SUMMARY"):
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
        f.write(summary)
print(summary)
print("COMPARISON_JSON=" + json.dumps(report, allow_nan=False))
