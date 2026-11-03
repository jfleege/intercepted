
from pathlib import Path

import nflreadpy as nfl
import polars as pl

# configuration
ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "processed"
REPORTS = ROOT / "data" / "diagnostics"
REPORTS.mkdir(parents=True, exist_ok=True)

SEASONS = list(range(2019, 2027))

# load existing datasets
weekly = pl.concat([
    pl.read_parquet(
        DATA / f"weekly_team_stats_{s}.parquet"
    )
    for s in SEASONS
])

blended = pl.read_parquet(
    DATA / "blended_team_stats_2019_2026.parquet"
)

matchups = pl.read_parquet(
    DATA / "ml_matchups_v2_2019_2026.parquet"
)

schedules = nfl.load_schedules(SEASONS)

games = (
    schedules.filter(
        (pl.col("game_type") == "REG")
        & pl.col("home_score").is_not_null()
        & pl.col("away_score").is_not_null()
    )
    .select([
        "game_id", "season", "week",
        "home_team", "away_team",
        "home_score", "away_score"
    ])
)


# check primary-key uniqueness

print("\n=== 1. DUPLICATE CHECKS ===")

for name, frame, keys in [
    ("Weekly", weekly, ["game_id", "team"]),
    ("Blended", blended, ["game_id", "team"]),
    ("Matchups", matchups, ["game_id"]),
    ("Schedules", games, ["game_id"])
]:
    duplicates = (
        frame.group_by(keys)
        .len()
        .filter(pl.col("len") > 1)
    )

    print(f"{name}: {duplicates.height} duplicate keys")

    if not duplicates.is_empty():
        print(duplicates.head(10))



# identify missing matchups

print("\n=== 2. MISSING MATCHUPS ===")

# Our binary model excludes tied games.
eligible = games.filter(
    pl.col("home_score") != pl.col("away_score")
)

missing = eligible.join(
    matchups.select("game_id"),
    on="game_id",
    how="anti"
)

# determine which teams have matching weekly data.
available = weekly.select(
    "game_id", "team"
).unique()

missing = (
    missing
    .join(
        available.rename({
            "team": "home_team"
        }).with_columns(
            pl.lit(True).alias("home_has_stats")
        ),
        on=["game_id", "home_team"],
        how="left"
    )
    .join(
        available.rename({
            "team": "away_team"
        }).with_columns(
            pl.lit(True).alias("away_has_stats")
        ),
        on=["game_id", "away_team"],
        how="left"
    )
    .with_columns(
        pl.col("home_has_stats").fill_null(False),
        pl.col("away_has_stats").fill_null(False)
    )
)

print("\nEligible vs. available matchups:")

summary = (
    eligible.group_by("season")
    .agg(pl.len().alias("eligible_games"))
    .join(
        matchups.group_by("season")
        .agg(pl.len().alias("model_games")),
        on="season",
        how="left"
    )
    .with_columns(
        (
            pl.col("eligible_games")
            - pl.col("model_games").fill_null(0)
        ).alias("missing_games")
    )
    .sort("season")
)

print(summary)

print("\nMissing matchups:")
print(
    missing.select([
        "season", "week", "game_id",
        "home_team", "away_team",
        "home_has_stats", "away_has_stats"
    ])
)

missing.write_csv(
    REPORTS / "missing_matchups.csv"
)

# inspect chronological ordering

print("\n=== 3. CHRONOLOGY AUDIT ===")

# prefer the actual schedule date to game_id ordering.
if "gameday" in schedules.columns:
    date_col = "gameday"
elif "game_date" in schedules.columns:
    date_col = "game_date"
else:
    date_col = None

if date_col is None:
    print("WARNING: No schedule date column found.")
else:
    dates = schedules.select([
        "game_id", date_col
    ]).unique(subset=["game_id"])

    dates = dates.with_columns(
        pl.col(date_col)
        .cast(pl.String)
        .str.slice(0, 10)
        .str.strptime(pl.Date, "%Y-%m-%d", strict=False)
        .alias("kickoff_date")
    ).select([
        "game_id", "kickoff_date"
    ])

    dated = weekly.join(
        dates,
        on="game_id",
        how="left"
    )

    missing_dates = dated.filter(
        pl.col("kickoff_date").is_null()
    )

    print(
        f"Team-game rows lacking dates: "
        f"{missing_dates.height}"
    )

    # compare the existing week/game_id ordering
    # against the chronological date ordering.
    by_week = (
        dated.sort([
            "team", "season", "week", "game_id"
        ])
        .with_columns(
            pl.int_range(pl.len())
            .over(["team", "season"])
            .alias("week_order")
        )
    )

    by_date = (
        dated.sort([
            "team", "season",
            "kickoff_date", "game_id"
        ])
        .with_columns(
            pl.int_range(pl.len())
            .over(["team", "season"])
            .alias("date_order")
        )
        .select([
            "game_id", "team", "date_order"
        ])
    )

    discrepancies = (
        by_week.join(
            by_date,
            on=["game_id", "team"],
            how="inner"
        )
        .filter(
            pl.col("week_order")
            != pl.col("date_order")
        )
    )

    print(
        f"Team-game ordering discrepancies: "
        f"{discrepancies.height}"
    )

    if not discrepancies.is_empty():
        print(
            discrepancies.select([
                "season", "week", "team",
                "game_id", "kickoff_date",
                "week_order", "date_order"
            ]).head(20)
        )

    discrepancies.write_csv(
        REPORTS / "chronology_discrepancies.csv"
    )

# verify pre-game totals and weighting

print("\n=== 4. FEATURE INTEGRITY ===")

# independently reconstruct cumulative statistics
# from weekly team-game records.

source = weekly.sort([
    "team", "season", "week", "game_id"
])

groups = ["team", "season"]

source = source.with_columns(
    (
        pl.col("off_total_epa")
        .cum_sum().shift(1).over(groups)
        .fill_null(0)
    ).alias("expected_off_total"),

    (
        pl.col("off_plays")
        .cum_sum().shift(1).over(groups)
        .fill_null(0)
    ).alias("expected_off_plays"),

    (
        pl.col("def_total_epa")
        .cum_sum().shift(1).over(groups)
        .fill_null(0)
    ).alias("expected_def_total"),

    (
        pl.col("def_plays")
        .cum_sum().shift(1).over(groups)
        .fill_null(0)
    ).alias("expected_def_plays")
)

checks = blended.join(
    source.select([
        "game_id", "team",
        "expected_off_total",
        "expected_off_plays",
        "expected_def_total",
        "expected_def_plays"
    ]),
    on=["game_id", "team"],
    how="left"
)

# check cumulative totals against saved features.
tolerance = 1e-8

comparisons = [
    ("prior_off_total_epa", "expected_off_total"),
    ("prior_off_plays", "expected_off_plays"),
    ("prior_def_total_epa", "expected_def_total"),
    ("prior_def_plays", "expected_def_plays")
]

for actual, expected in comparisons:
    failures = checks.filter(
        pl.col(expected).is_null()
        | pl.col(actual).is_null()
        | (
            (pl.col(actual) - pl.col(expected))
            .abs() > tolerance
        )
    )

    print(f"{actual}: {failures.height} mismatches")

    if not failures.is_empty():
        print(
            failures.select([
                "season", "week", "team",
                "game_id", actual, expected
            ]).head(10)
        )

# verify 70% maximum current-season weight
invalid_weights = blended.filter(
    (pl.col("current_weight") < 0)
    | (pl.col("current_weight") > 0.70000001)
    | (
        (
            pl.col("current_weight")
            + pl.col("preseason_weight")
            - 1
        ).abs() > tolerance
    )
)

print(
    f"Invalid weighting records: "
    f"{invalid_weights.height}"
)

print("\nAudit completed.")
print(f"Reports saved to: {REPORTS}")
