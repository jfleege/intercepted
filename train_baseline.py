
from pathlib import Path

import numpy as np
import polars as pl

from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    log_loss
)

# load the matchup dataset
df = pl.read_parquet(
    "data/processed/ml_matchups_2018_2026.parquet"
)

# exclude tied games for binary classification
df = df.filter(
    pl.col("home_score") != pl.col("away_score")
)

# 2. create home-minus-away features
metrics = [
    "off_epa_last3",
    "def_epa_last3",
    "success_last3",
    "off_epa_season_prior"
]

for metric in metrics:
    df = df.with_columns(
        (
            pl.col(f"home_{metric}")
            - pl.col(f"away_{metric}")
        ).alias(f"diff_{metric}")
    )

features = [f"diff_{metric}" for metric in metrics]

# 3. split chronologically by season
train = df.filter(pl.col("season").is_between(2018, 2023))
val = df.filter(pl.col("season") == 2024)
test = df.filter(pl.col("season") == 2025)

assert all(part.height > 0 for part in [train, val, test])

def get_xy(frame):
    X = frame.select(features).to_numpy()
    y = frame["home_win"].to_numpy()
    return X, y

X_train, y_train = get_xy(train)
X_val, y_val = get_xy(val)
X_test, y_test = get_xy(test)

# 4. train logistic regression
model = Pipeline([
    ("imputer", SimpleImputer(strategy="median")),
    ("scaler", StandardScaler()),
    ("classifier", LogisticRegression(
        max_iter=1000,
        random_state=42
    ))
])

model.fit(X_train, y_train)

# 5. evaluate probability predictions
def evaluate(name, X, y):
    probabilities = model.predict_proba(X)[:, 1]
    predictions = (probabilities >= 0.5).astype(int)

    print(f"\n{name}")
    print(f"Games: {len(y)}")
    print(f"Accuracy: {accuracy_score(y, predictions):.3f}")
    print(f"Brier score: {brier_score_loss(y, probabilities):.3f}")
    print(f"Log loss: {log_loss(y, probabilities, labels=[0, 1]):.3f}")

evaluate("2024 Validation", X_val, y_val)
evaluate("2025 Test", X_test, y_test)

# 6. save the trained model
import joblib

output = Path("models")
output.mkdir(exist_ok=True)

joblib.dump(
    {"model": model, "features": features},
    output / "baseline_logistic.joblib"
)

print("\nBaseline model saved successfully.")
