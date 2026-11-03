
from pathlib import Path

import joblib
import numpy as np
import polars as pl
import matplotlib.pyplot as plt

from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    log_loss
)

# configuration
DATA_DIR = Path("data/processed")
MODEL_DIR = Path("models")
OUTPUT_DIR = Path("data/diagnostics")

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

SEASONS = [2024, 2025]

# load trained models
saved_v1 = joblib.load(
    MODEL_DIR / "baseline_logistic.joblib"
)

saved_v2 = joblib.load(
    MODEL_DIR / "baseline_logistic_v2.joblib"
)

model_v1 = saved_v1["model"]
model_v2 = saved_v2["model"]

features_v1 = saved_v1["features"]
features_v2 = saved_v2["features"]

# load historical matchup datasets
v1 = pl.read_parquet(
    DATA_DIR / "ml_matchups_2018_2026.parquet"
)

v2 = pl.read_parquet(
    DATA_DIR / "ml_matchups_v2_2019_2026.parquet"
)

# recreate home-minus-away feature differences
for feature in features_v1:
    metric = feature.removeprefix("diff_")

    v1 = v1.with_columns(
        (
            pl.col(f"home_{metric}")
            - pl.col(f"away_{metric}")
        ).alias(feature)
    )

for feature in features_v2:
    metric = feature.removeprefix("diff_")

    v2 = v2.with_columns(
        (
            pl.col(f"home_{metric}")
            - pl.col(f"away_{metric}")
        ).alias(feature)
    )

# exclude ties from binary win/loss evaluation
v1 = v1.filter(
    pl.col("home_score") != pl.col("away_score")
)

v2 = v2.filter(
    pl.col("home_score") != pl.col("away_score")
)

# generate predictions
def predict(frame, model, features):
    if frame.is_empty():
        return frame.with_columns(
            pl.lit(None, dtype=pl.Float64).alias("prob")
        )

    probabilities = model.predict_proba(
        frame.select(features).to_numpy()
    )[:, 1]

    return frame.with_columns(
        pl.Series("prob", probabilities)
    )


v1 = predict(v1, model_v1, features_v1)
v2 = predict(v2, model_v2, features_v2)

# evaluation metrics
def evaluate(frame):
    if frame.is_empty():
        return None

    y = frame["home_win"].to_numpy()
    p = frame["prob"].to_numpy()

    return {
        "games": len(y),
        "accuracy": accuracy_score(y, p >= 0.5),
        "brier": brier_score_loss(y, p),
        "log_loss": log_loss(y, p, labels=[0, 1])
    }


def print_metrics(name, frame):
    result = evaluate(frame)

    if result is None:
        print(f"{name}: No games")
        return

    print(f"\n{name}")
    print(f"Games: {result['games']}")
    print(f"Accuracy: {result['accuracy']:.3f}")
    print(f"Brier: {result['brier']:.3f}")
    print(f"Log loss: {result['log_loss']:.3f}")

# calibration calculations
def calibration_table(frame, bins=10):
    if frame.is_empty():
        return pl.DataFrame()

    y = frame["home_win"].to_numpy()
    p = frame["prob"].to_numpy()

    # ten probability intervals
    bin_ids = np.minimum(
        (p * bins).astype(int),
        bins - 1
    )

    records = []

    for i in range(bins):
        mask = bin_ids == i

        if mask.sum() == 0:
            continue

        records.append({
            "bin": i,
            "games": int(mask.sum()),
            "predicted": float(p[mask].mean()),
            "observed": float(y[mask].mean())
        })

    return pl.DataFrame(records)



def plot_calibration(frame, title, filename):
    table = calibration_table(frame)

    if table.is_empty():
        return

    fig, ax = plt.subplots(figsize=(7, 6))

    # perfect calibration reference
    ax.plot(
        [0, 1], [0, 1],
        linestyle="--",
        label="Perfect calibration"
    )

    # model calibration
    ax.plot(
        table["predicted"].to_numpy(),
        table["observed"].to_numpy(),
        marker="o",
        label="Model"
    )

    # annotate sample size for each bin
    for row in table.iter_rows(named=True):
        ax.annotate(
            f"n={row['games']}",
            (row["predicted"], row["observed"]),
            xytext=(5, 8),
            textcoords="offset points",
            fontsize=8
        )

    ax.set(
        xlabel="Average predicted home-win probability",
        ylabel="Observed home-win frequency",
        title=title,
        xlim=(0, 1),
        ylim=(0, 1)
    )

    ax.legend()
    ax.grid(alpha=0.25)

    fig.tight_layout()
    fig.savefig(OUTPUT_DIR / filename, dpi=200)
    plt.close(fig)


# evaluate performance by week
def weekly_performance(frame):
    records = []

    for week in sorted(frame["week"].unique().to_list()):
        subset = frame.filter(pl.col("week") == week)
        result = evaluate(subset)

        if result:
            records.append({
                "week": week,
                **result
            })

    return pl.DataFrame(records)


def plot_weekly_performance(frame, title, filename):
    weekly = weekly_performance(frame)

    if weekly.is_empty():
        return

    fig, ax = plt.subplots(figsize=(10, 5))

    ax.plot(
        weekly["week"].to_numpy(),
        weekly["brier"].to_numpy(),
        marker="o"
    )

    ax.axhline(
        y=0.25,
        linestyle="--",
        label="Constant 50% benchmark"
    )

    ax.set(
        xlabel="NFL Week",
        ylabel="Brier score (lower is better)",
        title=title
    )

    ax.set_xticks(weekly["week"].to_list())
    ax.legend()
    ax.grid(alpha=0.25)

    fig.tight_layout()
    fig.savefig(OUTPUT_DIR / filename, dpi=200)
    plt.close(fig)

# examine the largest prediction errors
def worst_predictions(frame, count=10):
    errors = frame.with_columns(
        (
            pl.col("prob") - pl.col("home_win")
        ).abs().alias("absolute_error")
    )

    return (
        errors.sort("absolute_error", descending=True)
        .select([
            "season",
            "week",
            "home_team",
            "away_team",
            "home_score",
            "away_score",
            "prob",
            "home_win",
            "absolute_error"
        ])
        .head(count)
    )

# compare V1 and V2 on identical games
for season in SEASONS:

    print(f"\n{'=' * 55}")
    print(f"SEASON: {season}")
    print(f"{'=' * 55}")

    old = v1.filter(pl.col("season") == season)
    new = v2.filter(pl.col("season") == season)

    # all eligible games for V2
    print_metrics("V2 — Full Season", new)

    # shared game identifiers
    common_ids = old.select("game_id").join(
        new.select("game_id"),
        on="game_id",
        how="inner"
    )

    old_shared = old.join(
        common_ids, on="game_id", how="inner"
    )

    new_shared = new.join(
        common_ids, on="game_id", how="inner"
    )

    print_metrics("V1 — Shared Games", old_shared)
    print_metrics("V2 — Shared Games", new_shared)

    # early games recovered by the preseason model
    recovered = new.join(
        old.select("game_id"),
        on="game_id",
        how="anti"
    )

    print_metrics("V2 — Additional Games", recovered)

    # evaluate groups of weeks
    for label, start, end in [
        ("Early season", 1, 4),
        ("Middle season", 5, 9),
        ("Late season", 10, 18)
    ]:
        subset = new.filter(
            pl.col("week").is_between(start, end)
        )

        print_metrics(f"V2 — {label}", subset)

    # save detailed predictions
    new.select([
        "game_id",
        "season",
        "week",
        "home_team",
        "away_team",
        "home_score",
        "away_score",
        "home_win",
        "prob"
    ]).write_csv(
        OUTPUT_DIR / f"predictions_v2_{season}.csv"
    )

    # generate calibration and weekly figures
    plot_calibration(
        new,
        f"V2 Calibration — {season}",
        f"calibration_{season}.png"
    )

    plot_weekly_performance(
        new,
        f"V2 Weekly Brier Score — {season}",
        f"weekly_brier_{season}.png"
    )

    # print largest prediction errors
    print(f"\nLargest prediction errors — {season}")
    print(worst_predictions(new))


print("\nSUCCESS: Model diagnostics completed.")
print(f"Output directory: {OUTPUT_DIR.resolve()}")
