
from pathlib import Path
from itertools import product

import numpy as np
import polars as pl

from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    log_loss,
)

# configuration

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "processed"
OUTPUT_DIR = ROOT / "data" / "diagnostics"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

FIRST_TRAIN_SEASON = 2019
FIRST_INNER_SEASON = 2021
OUTER_SEASONS = [2022, 2023, 2024]

# existing V3 configuration
REFERENCE_CAP = 0.70
REFERENCE_TRANSITION = 4

# candidate configurations
CAPS = [0.60, 0.70, 0.80, 0.90]
TRANSITIONS = [2, 4, 6]

CANDIDATES = list(product(CAPS, TRANSITIONS))
REFERENCE = (REFERENCE_CAP, REFERENCE_TRANSITION)

assert REFERENCE in CANDIDATES

# load data
blended = pl.read_parquet(
    DATA_DIR / "blended_team_stats_2019_2026.parquet"
)

matchups = pl.read_parquet(
    DATA_DIR / "ml_matchups_v2_2019_2026.parquet"
)

# these cumulative fields contain only prior-game data.
feature_columns = [
    "games_played_prior",
    "prior_off_total_epa",
    "prior_off_plays",
    "prior_def_total_epa",
    "prior_def_plays",
    "preseason_off_epa",
    "preseason_def_epa",
]

# matchup identifiers have already been standardized
# in matchup_features_v2.py (including OAK -> LV).
games = matchups.select([
    "game_id",
    "season",
    "week",
    "home_team",
    "away_team",
    "home_win",
])

home = blended.select(
    "game_id",
    pl.col("team").alias("home_team"),
    *[
        pl.col(c).alias(f"home_{c}")
        for c in feature_columns
    ],
)

away = blended.select(
    "game_id",
    pl.col("team").alias("away_team"),
    *[
        pl.col(c).alias(f"away_{c}")
        for c in feature_columns
    ],
)

df = (
    games
    .join(home, on=["game_id", "home_team"], how="inner")
    .join(away, on=["game_id", "away_team"], how="inner")
    .sort(["season", "week", "game_id"])
)

assert df.height == games.height, (
    "Some games failed to join to their team features."
)
assert df["game_id"].n_unique() == df.height
assert df["home_win"].is_in([0, 1]).all()

print(f"Loaded {df.height} matchups.")
print(f"Testing {len(CANDIDATES)} configurations.")

# convert data once to NumPy arrays
seasons = df["season"].to_numpy()
weeks = df["week"].to_numpy()
outcomes = df["home_win"].to_numpy().astype(int)

def column(name):
    values = df[name].to_numpy()
    return np.asarray(values, dtype=float)
  
# reconstruct candidate matchup features
def team_epa(prefix, cap, transition):
    n = column(f"{prefix}_games_played_prior")

    current_weight = np.minimum(
        cap,
        n / (n + transition)
    )
    preseason_weight = 1.0 - current_weight

    preseason_off = column(
        f"{prefix}_preseason_off_epa"
    )
    preseason_def = column(
        f"{prefix}_preseason_def_epa"
    )

    off_total = column(
        f"{prefix}_prior_off_total_epa"
    )
    off_plays = column(
        f"{prefix}_prior_off_plays"
    )

    def_total = column(
        f"{prefix}_prior_def_total_epa"
    )
    def_plays = column(
        f"{prefix}_prior_def_plays"
    )

    # week 1 has zero prior plays.
    # use zero for the current-season component
    # when its weight is also zero.
    current_off = np.divide(
        off_total,
        off_plays,
        out=np.zeros_like(off_total),
        where=off_plays > 0,
    )

    current_def = np.divide(
        def_total,
        def_plays,
        out=np.zeros_like(def_total),
        where=def_plays > 0,
    )

    blended_off = (
        current_weight * current_off
        + preseason_weight * preseason_off
    )

    blended_def = (
        current_weight * current_def
        + preseason_weight * preseason_def
    )

    return blended_off, blended_def


def build_features(cap, transition):
    home_off, home_def = team_epa(
        "home", cap, transition
    )

    away_off, away_def = team_epa(
        "away", cap, transition
    )

    X = np.column_stack([
        home_off - away_off,
        home_def - away_def,
    ])

    assert np.isfinite(X).all(), (
        f"Invalid features for {cap}, {transition}"
    )

    return X


# cache feature matrices so that the same
# configuration isn't repeatedly reconstructed.
FEATURES = {
    (cap, transition): build_features(cap, transition)
    for cap, transition in CANDIDATES
}

# modeling and evaluation
def make_model():
    return Pipeline([
        ("scaler", StandardScaler()),
        ("classifier", LogisticRegression(
            max_iter=1000,
            random_state=42,
        )),
    ])


def forecast(configuration, train_mask, test_mask):
    X = FEATURES[configuration]

    assert train_mask.sum() > 0
    assert test_mask.sum() > 0

    model = make_model()

    model.fit(
        X[train_mask],
        outcomes[train_mask]
    )

    return model.predict_proba(
        X[test_mask]
    )[:, 1]


def metrics(y, p):
    return {
        "games": len(y),
        "accuracy": accuracy_score(
            y, (p >= 0.5).astype(int)
        ),
        "brier": brier_score_loss(y, p),
        "log_loss": log_loss(
            y, p, labels=[0, 1]
        ),
    }


# inner walk-forward selection
def select_configuration(outer_year):
    records = []

    inner_years = list(range(
        FIRST_INNER_SEASON,
        outer_year
    ))

    for configuration in CANDIDATES:
        errors = []
        games_evaluated = 0

        for inner_year in inner_years:
            train_mask = (
                (seasons >= FIRST_TRAIN_SEASON)
                & (seasons < inner_year)
            )

            test_mask = seasons == inner_year

            predictions = forecast(
                configuration,
                train_mask,
                test_mask
            )

            actual = outcomes[test_mask]

            # accumulate per-game squared errors.
            # this weights each inner fold by its
            # actual number of games.
            errors.extend(
                (predictions - actual) ** 2
            )

            games_evaluated += len(actual)

        records.append({
            "evaluation_season": outer_year,
            "cap": configuration[0],
            "transition": configuration[1],
            "inner_games": games_evaluated,
            "inner_brier": float(np.mean(errors)),
        })

    ranking = pl.DataFrame(records).sort([
        "inner_brier",
        "cap",
        "transition"
    ])

    winner = ranking.row(0, named=True)

    selected = (
        float(winner["cap"]),
        int(winner["transition"])
    )

    return selected, ranking

# outer walk-forward evaluation
all_predictions = []
all_rankings = []
summary = []

for outer_year in OUTER_SEASONS:
    print(f"\n{'=' * 56}")
    print(f"EVALUATING {outer_year}")
    print(f"{'=' * 56}")

    # only earlier seasons determine the weights.
    selected, ranking = select_configuration(
        outer_year
    )

    all_rankings.append(ranking)

    print("\nTop configurations from earlier seasons:")
    print(ranking.head(5))

    print(
        f"\nSelected: cap={selected[0]:.0%}, "
        f"transition={selected[1]}"
    )

    train_mask = (
        (seasons >= FIRST_TRAIN_SEASON)
        & (seasons < outer_year)
    )

    test_mask = seasons == outer_year
    actual = outcomes[test_mask]

    # model with historically selected parameters
    selected_p = forecast(
        selected,
        train_mask,
        test_mask
    )

    # fixed V3 reference, trained on identical games
    reference_p = forecast(
        REFERENCE,
        train_mask,
        test_mask
    )

    selected_result = metrics(actual, selected_p)
    reference_result = metrics(actual, reference_p)

    print(
        f"\nSelected Brier: "
        f"{selected_result['brier']:.4f}"
    )
    print(
        f"Reference Brier: "
        f"{reference_result['brier']:.4f}"
    )

    print(
        f"Selected accuracy: "
        f"{selected_result['accuracy']:.1%}"
    )
    print(
        f"Reference accuracy: "
        f"{reference_result['accuracy']:.1%}"
    )

    summary.append({
        "season": outer_year,
        "games": len(actual),
        "selected_cap": selected[0],
        "selected_transition": selected[1],
        "selected_accuracy": selected_result["accuracy"],
        "reference_accuracy": reference_result["accuracy"],
        "selected_brier": selected_result["brier"],
        "reference_brier": reference_result["brier"],
        "selected_log_loss": selected_result["log_loss"],
        "reference_log_loss": reference_result["log_loss"],
    })

    season_games = df.filter(
        pl.col("season") == outer_year
    ).select([
        "game_id",
        "season",
        "week",
        "home_team",
        "away_team",
        "home_win",
    ])

    season_games = season_games.with_columns(
        pl.Series(
            "selected_probability",
            selected_p
        ),
        pl.Series(
            "reference_probability",
            reference_p
        ),
        pl.lit(selected[0]).alias(
            "selected_cap"
        ),
        pl.lit(selected[1]).alias(
            "selected_transition"
        ),
    )

    all_predictions.append(season_games)

# combined evaluation
summary_df = pl.DataFrame(summary)

predictions_df = pl.concat(
    all_predictions
).sort(["season", "week", "game_id"])

rankings_df = pl.concat(all_rankings)

y_all = predictions_df["home_win"].to_numpy()

selected_all = predictions_df[
    "selected_probability"
].to_numpy()

reference_all = predictions_df[
    "reference_probability"
].to_numpy()

selected_total = metrics(y_all, selected_all)
reference_total = metrics(y_all, reference_all)

print(f"\n{'=' * 56}")
print("COMBINED OUT-OF-SAMPLE PERFORMANCE")
print(f"{'=' * 56}")

print("\nNested-selected configuration:")
print(selected_total)

print("\nFixed V3 reference (70%, transition=4):")
print(reference_total)

print("\nSeason-by-season summary:")
print(summary_df)

# save diagnostics
summary_df.write_csv(
    OUTPUT_DIR / "weight_experiments_summary.csv"
)

predictions_df.write_csv(
    OUTPUT_DIR / "weight_experiments_predictions.csv"
)

rankings_df.write_csv(
    OUTPUT_DIR / "weight_experiments_rankings.csv"
)

print("\nSUCCESS: Weight experiments completed.")
print(
    f"Saved {predictions_df.height} "
    "out-of-sample predictions."
)
