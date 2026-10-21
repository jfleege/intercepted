
from datetime import datetime, timezone
import json

import joblib
import numpy as np
import polars as pl

from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


from src.ml.training_data import ROOT, MODEL_COLUMNS, C_VALUE, load_training_data

MODEL_DIR = ROOT / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)
df = load_training_data()

# train and save models
training_results = []

for model_name, columns in MODEL_COLUMNS.items():
    X_train = df.select(columns).to_numpy()
    y_train = df["home_win"].to_numpy().astype(int)

    pipeline = Pipeline([
        ("imputer", SimpleImputer(
            strategy="median",
        )),
        ("scaler", StandardScaler()),
        ("classifier", LogisticRegression(
            C=C_VALUE,
            max_iter=1000,
            random_state=42,
        )),
    ])

    pipeline.fit(X_train, y_train)

    probabilities = pipeline.predict_proba(
        X_train
    )[:, 1]

    assert np.isfinite(probabilities).all()
    assert ((probabilities >= 0) & (probabilities <= 1)).all()

    model_path = MODEL_DIR / f"{model_name}.joblib"

    joblib.dump(pipeline, model_path)

    training_results.append({
        "model": model_name,
        "features": len(columns),
        "training_games": len(y_train),
        "training_accuracy": float(
            np.mean((probabilities >= 0.5) == y_train)
        ),
    })

    print(
        f"\nSaved {model_name}: "
        f"{len(columns)} features, "
        f"{len(y_train):,} training games."
    )


# save model metadata
latest_season = int(df["season"].max())

latest_week = int(
    df.filter(
        pl.col("season") == latest_season
    )["week"].max()
)

metadata = {
    "created_at_utc": datetime.now(
        timezone.utc
    ).isoformat(),
    "algorithm": "logistic_regression",
    "regularization_c": C_VALUE,
    "training_games": df.height,
    "first_training_season": int(df["season"].min()),
    "latest_training_season": latest_season,
    "latest_training_week": latest_week,
    "models": {
        name: {
            "file": f"{name}.joblib",
            "features": columns,
            "feature_count": len(columns),
        }
        for name, columns in MODEL_COLUMNS.items()
    },
}

metadata_path = MODEL_DIR / "model_metadata.json"

metadata_path.write_text(
    json.dumps(metadata, indent=2)
)

print("\nMODEL TRAINING SUMMARY")
print(pl.DataFrame(training_results))

print("\nTraining data cutoff:")
print(f"Season: {latest_season}")
print(f"Latest week represented: {latest_week}")

print("\nSUCCESS: Production models saved.")
print(f"Metadata: {metadata_path.name}")
