
from pathlib import Path

import polars as pl


# configuration
ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "processed"
DATA_DIR.mkdir(parents=True, exist_ok=True)

SEASONS = list(range(2019, 2027))

CURRENT_WEIGHT_CAP = 0.70
TRANSITION = 4.0

# each entry contains:
# numerator, denominator, neutral prior, preseason strength,
# current-season smoothing strength, and estimation method.
#
# rate: blend previous-season and current-season rates.
# sparse: smooth current-season counts using the preseason rate.
METRICS = {
    "off_pass_epa": (
        "off_pass_total_epa", "off_pass_plays",
        0.0, 250, 0, "rate"
    ),
    "off_run_epa": (
        "off_run_total_epa", "off_run_plays",
        0.0, 200, 0, "rate"
    ),
    "def_pass_epa": (
        "def_pass_total_epa_allowed", "def_pass_plays",
        0.0, 250, 0, "rate"
    ),
    "def_run_epa": (
        "def_run_total_epa_allowed", "def_run_plays",
        0.0, 200, 0, "rate"
    ),
    "off_pass_success": (
        "off_pass_successes", "off_pass_success_plays",
        0.45, 250, 0, "rate"
    ),
    "off_run_success": (
        "off_run_successes", "off_run_success_plays",
        0.45, 200, 0, "rate"
    ),
    "def_pass_success_allowed": (
        "def_pass_successes_allowed",
        "def_pass_success_plays",
        0.45, 250, 0, "rate"
    ),
    "def_run_success_allowed": (
        "def_run_successes_allowed",
        "def_run_success_plays",
        0.45, 200, 0, "rate"
    ),
    "interception_rate": (
        "interceptions_thrown", "off_pass_plays",
        0.025, 200, 200, "sparse"
    ),
    "def_interception_rate": (
        "def_interceptions", "def_pass_plays",
        0.025, 200, 200, "sparse"
    ),
    "off_fumble_rate": (
        "off_fumble_plays", "off_scrimmage_plays",
        0.02, 300, 300, "sparse"
    ),
    "off_fumble_lost_rate": (
        "off_fumbles_lost", "off_scrimmage_plays",
        0.01, 300, 300, "sparse"
    ),
    "def_fumble_rate": (
        "opponent_fumble_plays", "def_scrimmage_plays",
        0.02, 300, 300, "sparse"
    ),
    "def_fumble_takeaway_rate": (
        "def_fumble_takeaways", "def_scrimmage_plays",
        0.01, 300, 300, "sparse"
    ),
    "fg_pct": (
        "fg_made", "fg_attempts",
        0.82, 20, 10, "sparse"
    ),
    "fg_50_plus_pct": (
        "fg_50_plus_made", "fg_50_plus_attempts",
        0.65, 12, 8, "sparse"
    ),
    "pat_pct": (
        "pat_made", "pat_att",
        0.94, 25, 15, "sparse"
    ),
    "fg_avg_distance": (
        "fg_attempt_distance", "fg_attempts",
        38.0, 15, 10, "sparse"
    ),
}


# load expanded team-game statistics
frames = [
    pl.read_parquet(
        DATA_DIR / f"expanded_team_stats_{season}.parquet"
    )
    for season in SEASONS
]

df = pl.concat(frames)

assert df["game_id"].n_unique() * 2 == df.height, (
    "Expected exactly two team records per game."
)

assert df.select(
    pl.struct(["game_id", "team"]).n_unique()
).item() == df.height, (
    "Duplicate team-game records found."
)


# calculate opportunity counts
df = df.with_columns(
    (
        pl.col("off_pass_plays")
        + pl.col("off_run_plays")
    ).alias("off_scrimmage_plays"),

    (
        pl.col("def_pass_plays")
        + pl.col("def_run_plays")
    ).alias("def_scrimmage_plays"),
)

# validate kicking classifications
checks = [
    (
        "fg_attempts",
        ["fg_made", "fg_missed", "fg_blocked"]
    ),
    (
        "pat_att",
        ["pat_made", "pat_missed", "pat_blocked"]
    ),
]

for attempts, outcomes in checks:
    invalid = df.filter(
        pl.col(attempts)
        != pl.sum_horizontal([
            pl.col(name) for name in outcomes
        ])
    )

    assert invalid.is_empty(), (
        f"Invalid kicking classifications: {attempts}"
    )

print("PASS: Kicking classifications validated.")


# fill missing kicking totals
kicking_totals = [
    "fg_attempt_distance",
    "fg_made_distance",
]

df = df.with_columns(
    [
        pl.col(name).fill_null(0)
        for name in kicking_totals
    ]
)

df = df.sort([
    "team", "season", "week", "game_id"
])


# calculate previous-season totals
stat_columns = sorted(set(
    column
    for numerator, denominator, *_ in METRICS.values()
    for column in [numerator, denominator]
))

previous = (
    df.group_by(["team", "season"])
    .agg([
        pl.col(name).sum().alias(f"prev_{name}")
        for name in stat_columns
    ])
    .with_columns(
        (pl.col("season") + 1).alias("season")
    )
)

df = df.join(
    previous,
    on=["team", "season"],
    how="left",
)

# calculate cumulative prior-game totals
groups = ["team", "season"]

df = df.with_columns(
    (
        pl.col("game_id").cum_count().over(groups) - 1
    ).alias("games_played_prior"),

    *[
        (
            pl.col(name)
            .cum_sum()
            .shift(1)
            .over(groups)
            .fill_null(0)
        ).alias(f"prior_{name}")
        for name in stat_columns
    ],
)

df = df.with_columns(
    pl.min_horizontal(
        pl.lit(CURRENT_WEIGHT_CAP),
        (
            pl.col("games_played_prior")
            / (
                pl.col("games_played_prior")
                + TRANSITION
            )
        ),
    ).alias("current_weight")
)


# construct smoothed pregame features
feature_names = []

for name, spec in METRICS.items():
    (
        numerator,
        denominator,
        neutral,
        preseason_strength,
        current_strength,
        method,
    ) = spec

    prev_n = pl.col(f"prev_{numerator}").fill_null(0)
    prev_d = pl.col(f"prev_{denominator}").fill_null(0)

    current_n = pl.col(f"prior_{numerator}")
    current_d = pl.col(f"prior_{denominator}")

    # shrink last season toward a fixed neutral estimate.
    preseason = (
        (prev_n + preseason_strength * neutral)
        / (prev_d + preseason_strength)
    )

    preseason_name = f"preseason_{name}"
    feature_name = f"v4_{name}"

    df = df.with_columns(
        preseason.alias(preseason_name)
    )

    if method == "rate":
        current_rate = (
            pl.when(current_d > 0)
            .then(current_n / current_d)
            .otherwise(pl.col(preseason_name))
        )

        estimate = (
            pl.col("current_weight") * current_rate
            + (
                1 - pl.col("current_weight")
            ) * pl.col(preseason_name)
        )

    else:
        # apply stronger sample-size smoothing to sparse events.
        estimate = (
            (
                current_n
                + current_strength * pl.col(preseason_name)
            )
            / (current_d + current_strength)
        )

    df = df.with_columns(
        estimate.alias(feature_name)
    )

    feature_names.append(feature_name)


# validate pregame features
first_games = df.filter(
    pl.col("games_played_prior") == 0
)

assert first_games.select(
    (pl.col("current_weight") == 0).all()
).item()

for name in stat_columns:
    assert first_games.select(
        (pl.col(f"prior_{name}") == 0).all()
    ).item(), (
        f"First-game leakage detected: {name}"
    )

for name in METRICS:
    difference = (
        pl.col(f"v4_{name}")
        - pl.col(f"preseason_{name}")
    ).abs()

    assert first_games.select(
        (difference < 1e-9).all()
    ).item(), (
        f"First-game feature mismatch: {name}"
    )

assert df.select(
    pl.all_horizontal([
        pl.col(name).is_finite()
        for name in feature_names
    ]).all()
).item(), "Invalid V4 feature values."

# probability-like statistics must remain in [0, 1].
for name in METRICS:
    if name.endswith("pct") or name.endswith("rate") or (
        "success" in name
    ):
        assert df.select(
            pl.col(f"v4_{name}")
            .is_between(0, 1)
            .all()
        ).item(), (
            f"Invalid probability feature: {name}"
        )

print("PASS: V4 pregame features validated.")


# save V4 features
output = df.select([
    "game_id",
    "season",
    "week",
    "team",
    "games_played_prior",
    "current_weight",
    *feature_names,
])

output_path = (
    DATA_DIR / "pregame_features_v4_2019_2026.parquet"
)

output.write_parquet(output_path)

print(f"\nSUCCESS: Saved {output.height} team-game records.")
print(f"Features per team: {len(feature_names)}")
print(f"Output: {output_path.name}")

print("\nDallas Cowboys — 2026:")
print(
    output.filter(
        (pl.col("season") == 2026)
        & (pl.col("team") == "DAL")
    )
    .sort("week")
    .select([
        "week",
        "games_played_prior",
        "current_weight",
        "v4_off_pass_epa",
        "v4_off_run_epa",
        "v4_interception_rate",
        "v4_fg_pct",
        "v4_pat_pct",
    ])
    .head(5)
)
