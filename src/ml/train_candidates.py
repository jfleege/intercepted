"""Fit the already-selected research candidates for Week 7, using Week 6 only as training."""
import json
from datetime import datetime, timezone
import joblib
import numpy as np
import polars as pl
from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
from src.ml.candidate_training_data import df, MODEL_COLUMNS, ROOT
from src.features.model_context import CONTEXT_COLUMNS
from src.ml.refresh_performance import write_json

# Hyperparameters frozen from pre-Week-6 research; no tuning on Week 6 outcomes.
TARGET = (2026, 7)
training = df.filter((pl.col("season") < TARGET[0]) | (
    (pl.col("season") == TARGET[0]) & (pl.col("week") < TARGET[1])))
assert training.height and training.filter(
    (pl.col("season") == TARGET[0]) & (pl.col("week") == TARGET[1] - 1)).height == 14
context = pl.read_parquet(ROOT / "data/processed/game_context_2019_2026.parquet")
training = training.join(context.select("game_id", *CONTEXT_COLUMNS), on="game_id", how="left", validate="1:1")
metadata_path = ROOT / "models/model_metadata.json"
metadata = json.loads(metadata_path.read_text())
configs = {
    "v5_qb_plus": (MODEL_COLUMNS["v4_qb_plus"], LogisticRegression(C=.01, max_iter=2000, random_state=42)),
    "v5_boosted": (MODEL_COLUMNS["v4_qb_plus"] + CONTEXT_COLUMNS,
                   HistGradientBoostingClassifier(max_iter=150, learning_rate=.05,
                     max_leaf_nodes=3, min_samples_leaf=30, l2_regularization=10.,
                     early_stopping=False, random_state=42))
}
report = {}
for name, (columns, classifier) in configs.items():
    X = training.select(columns).cast(pl.Float64).to_numpy()
    y = training["home_win"].to_numpy().astype(int)
    assert not np.isinf(X).any()
    model = Pipeline([("imputer", SimpleImputer(strategy="median", keep_empty_features=True)),
                      ("scaler", StandardScaler()), ("classifier", classifier)])
    model.fit(X, y)
    joblib.dump(model, ROOT / "models" / f"{name}.joblib")
    detail = {"file": f"{name}.joblib", "features": columns, "feature_count": len(columns),
              "created_at_utc": datetime.now(timezone.utc).isoformat(),
              "latest_training_season": TARGET[0], "latest_training_week": TARGET[1] - 1,
              "training_games": training.height, "algorithm": type(classifier).__name__,
              "settings": classifier.get_params(), "purpose": "Prospective challenger; not validated as more accurate",
              "parameters_source": "Week 6 research; settings selected from seasons through 2025"}
    metadata["models"][name] = detail
    report[name] = {**detail, "training_accuracy": float((model.predict(X) == y).mean())}
write_json(metadata_path, metadata)
write_json(ROOT / "models/week7_training_report.json", report)
print(json.dumps(report, indent=2))
