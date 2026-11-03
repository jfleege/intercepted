
from pathlib import Path

import joblib
import numpy as np
import polars as pl

from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    log_loss
)

# configuration
DATA_DIR = Path("data/processed")
MODEL_DIR = Path("models")
MODEL_DIR.mkdir(exist_ok=True)

TRAIN_YEARS = list(range(2019, 2024))
VALIDATION_YEAR = 2024
TEST_YEAR = 2025

# load blended matchup dataset (V2)
df = pl.read_parquet(
    DATA_DIR / "ml_matchups_v2_2019_2026.parquet"
)

# construct home-minus-away differences
metrics = [
    "blended_off_epa",
    "blended_def_epa"
]

for metric in metrics:
    df = df.with_columns(
        (
            pl.col(f"home_{metric}")
            - pl.col(f"away_{metric}")
        ).alias(f"diff_{metric}")
    )

features_v2 = [f"diff_{m}" for m in metrics]

# split by season
train = df.filter(pl.col("season").is_in(TRAIN_YEARS))
val = df.filter(pl.col("season") == VALIDATION_YEAR)
test = df.filter(pl.col("season") == TEST_YEAR)

assert all(x.height > 0 for x in [train, val, test])

def get_xy(frame, features):
    return (
        frame.select(features).to_numpy(),
        frame["home_win"].to_numpy()
    )

X_train, y_train = get_xy(train, features_v2)
X_val, y_val = get_xy(val, features_v2)
X_test, y_test = get_xy(test, features_v2)

# train V2 logistic regression
model_v2 = Pipeline([
    ("scaler", StandardScaler()),
    ("classifier", LogisticRegression(
        max_iter=1000,
        random_state=42
    ))
])

model_v2.fit(X_train, y_train)

# evaluation helper
def evaluate(name, y_true, probabilities):
    predictions = (probabilities >= 0.5).astype(int)

    results = {
        "accuracy": accuracy_score(y_true, predictions),
        "brier": brier_score_loss(y_true, probabilities),
        "log_loss": log_loss(
            y_true, probabilities, labels=[0, 1]
        )
    }

    print(f"\n{name}")
    print(f"Games: {len(y_true)}")
    print(f"Accuracy: {results['accuracy']:.3f}")
    print(f"Brier score: {results['brier']:.3f}")
    print(f"Log loss: {results['log_loss']:.3f}")

    return results

# evaluate V2 on all available games
evaluate(
    "V2 — 2024 Validation (all eligible games)",
    y_val,
    model_v2.predict_proba(X_val)[:, 1]
)

evaluate(
    "V2 — 2025 Historical Diagnostic",
    y_test,
    model_v2.predict_proba(X_test)[:, 1]
)

# load original V1 model and matchup data
saved_v1 = joblib.load(
    MODEL_DIR / "baseline_logistic.joblib"
)

model_v1 = saved_v1["model"]
features_v1 = saved_v1["features"]

v1 = pl.read_parquet(
    DATA_DIR / "ml_matchups_2018_2026.parquet"
)

# recreate the difference features used in V1
for feature in features_v1:
    metric = feature.removeprefix("diff_")

    v1 = v1.with_columns(
        (
            pl.col(f"home_{metric}")
            - pl.col(f"away_{metric}")
        ).alias(feature)
    )

# compare V1 and V2 on identical games
def compare_models(season):
    old = v1.filter(pl.col("season") == season)
    new = df.filter(pl.col("season") == season)

    shared = old.select(
        ["game_id"] + features_v1
    ).join(
        new,
        on="game_id",
        how="inner"
    )

    assert shared.height > 0
    assert shared["game_id"].n_unique() == shared.height

    X_old = shared.select(features_v1).to_numpy()
    X_new = shared.select(features_v2).to_numpy()
    y = shared["home_win"].to_numpy()

    p_old = model_v1.predict_proba(X_old)[:, 1]
    p_new = model_v2.predict_proba(X_new)[:, 1]

    print(f"\n{'=' * 45}")
    print(f"HEAD-TO-HEAD COMPARISON — {season}")
    print(f"{'=' * 45}")

    evaluate("V1 — Shared Games", y, p_old)
    evaluate("V2 — Shared Games", y, p_new)

compare_models(2024)
compare_models(2025)

# save V2 model
joblib.dump(
    {
        "model": model_v2,
        "features": features_v2,
        "training_seasons": TRAIN_YEARS,
        "max_current_weight": 0.70,
        "prior_strength": 4.0
    },
    MODEL_DIR / "baseline_logistic_v2.joblib"
)

print("\nSUCCESS: V2 model saved.")
