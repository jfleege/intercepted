
from argparse import ArgumentParser
from datetime import date
from pathlib import Path
import json

import joblib
import numpy as np
import polars as pl


# configuration
ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "processed"
MODEL_DIR = ROOT / "models"
PREDICTION_DIR = ROOT / "data" / "predictions"
PREDICTION_DIR.mkdir(parents=True, exist_ok=True)


# load requested matchups
parser = ArgumentParser()
parser.add_argument("--season", type=int, default=2026)
parser.add_argument("--week", type=int, default=6)
parser.add_argument(
    "--as-of",
    type=date.fromisoformat,
    default=date(2026, 10, 9),
)
args = parser.parse_args()

metadata = json.loads(
    (MODEL_DIR / "model_metadata.json").read_text()
)

features_path = (
    DATA_DIR
    / f"upcoming_features_{args.season}_week_{args.week}.parquet"
)

games = pl.read_parquet(features_path).sort([
    "game_date",
    "game_id",
])

if games.is_empty():
    raise ValueError("No games available for prediction")

if games["game_id"].n_unique() != games.height:
    raise ValueError("Duplicate game IDs in prediction input")

if not games.select(
    (pl.col("game_date") > args.as_of).all()
).item():
    raise ValueError(
        "Games on or before the forecast date must not be predicted"
    )

if metadata["latest_training_season"] > args.season:
    raise ValueError(
        "Saved model was trained on seasons after the target season"
    )

if (
    metadata["latest_training_season"] == args.season
    and metadata["latest_training_week"] >= args.week
):
    raise ValueError(
        "Saved model was trained on the target week or later"
    )

print(
    f"Loaded {games.height} matchups "
    f"for {args.season} Week {args.week}."
)

print(f"Forecast date: {args.as_of}")

print(
    "Model training cutoff: "
    f"{metadata['latest_training_season']} "
    f"Week {metadata['latest_training_week']}"
)


# predict with saved model pipelines
probabilities = {}

for model_name in ("v4_a", "v4_qb_plus"):
    specification = metadata["models"][model_name]
    columns = specification["features"]

    missing = [
        name
        for name in columns
        if name not in games.columns
    ]

    if missing:
        raise ValueError(
            f"Missing {model_name} features: {missing}"
        )

    matrix = (
        games.select(columns)
        .to_numpy()
        .astype(float)
    )

    if np.isinf(matrix).any():
        raise ValueError(
            f"Infinite feature values for {model_name}"
        )

    if model_name == "v4_a" and not np.isfinite(matrix).all():
        raise ValueError(
            "V4-A must not contain missing features"
        )

    pipeline = joblib.load(
        MODEL_DIR / specification["file"]
    )

    n_features = (
        pipeline.named_steps["classifier"].n_features_in_
    )

    if n_features != len(columns):
        raise ValueError(
            f"Feature-count mismatch for {model_name}"
        )

    predicted = pipeline.predict_proba(matrix)

    classes = list(
        pipeline.named_steps["classifier"].classes_
    )

    if 1 not in classes:
        raise ValueError(
            f"Model {model_name} has no home-win class"
        )

    home_probability = predicted[
        :, classes.index(1)
    ]

    if not np.isfinite(home_probability).all():
        raise ValueError(
            f"Invalid predictions from {model_name}"
        )

    if not (
        (home_probability >= 0)
        & (home_probability <= 1)
    ).all():
        raise ValueError(
            f"Probabilities outside [0, 1] from {model_name}"
        )

    probabilities[model_name] = home_probability


# build game-level prediction output
output = games.select([
    "game_id",
    "season",
    "week",
    "game_date",
    "home_team",
    "away_team",
    "home_projected_qb_name",
    "away_projected_qb_name",
    "home_team_latest_week",
    "away_team_latest_week",
]).with_columns([
    pl.Series(
        "home_win_prob_v4_a",
        probabilities["v4_a"],
    ),
    pl.Series(
        "home_win_prob_v4_qb_plus",
        probabilities["v4_qb_plus"],
    ),
])

output = output.with_columns([
    (
        1 - pl.col("home_win_prob_v4_a")
    ).alias("away_win_prob_v4_a"),

    (
        1 - pl.col("home_win_prob_v4_qb_plus")
    ).alias("away_win_prob_v4_qb_plus"),

    (
        pl.col("home_win_prob_v4_qb_plus")
        - pl.col("home_win_prob_v4_a")
    ).alias("qb_probability_impact"),

    pl.when(
        pl.col("home_win_prob_v4_qb_plus") >= 0.5
    )
    .then(pl.col("home_team"))
    .otherwise(pl.col("away_team"))
    .alias("predicted_winner"),
])

output = output.with_columns(
    pl.max_horizontal(
        "home_win_prob_v4_qb_plus",
        "away_win_prob_v4_qb_plus",
    ).alias("predicted_winner_probability")
)

assert output.height == games.height
assert output["game_id"].n_unique() == games.height

assert output.select(
    (
        pl.col("home_win_prob_v4_qb_plus")
        + pl.col("away_win_prob_v4_qb_plus")
        - 1
    ).abs().lt(1e-12).all()
).item()


# save and display forecasts
path = (
    PREDICTION_DIR
    / f"predictions_{args.season}_week_{args.week}.csv"
)

output.write_csv(path)

print("\nINTERCEPTED PREDICTIONS")

print(
    output.select([
        "away_team",
        "home_team",
        "predicted_winner",
        "predicted_winner_probability",
        "home_win_prob_v4_a",
        "home_win_prob_v4_qb_plus",
        "qb_probability_impact",
    ]).with_columns(
        pl.col(pl.Float64).round(3)
    )
)

print(
    f"\nPASS: Generated predictions "
    f"for {output.height} games."
)

print(f"SUCCESS: Saved {path}")

print(
    "NOTE: Forecasts use the staged matchup data; "
    "refresh inputs for a new forecast date."
)
