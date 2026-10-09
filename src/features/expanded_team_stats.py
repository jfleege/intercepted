
from pathlib import Path

import nflreadpy as nfl
import polars as pl


# configuration
ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "data" / "processed"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

SEASONS = list(range(2019, 2027))

TEAM_RENAMES = {
    "OAK": "LV",
    "SD": "LAC",
    "STL": "LA",
}

REQUIRED_COLUMNS = [
    "game_id",
    "season",
    "week",
    "season_type",
    "play_type",
    "posteam",
    "defteam",
    "epa",
    "success",
    "interception",
    "fumble",
    "fumble_lost",
    "field_goal_result",
    "extra_point_result",
    "kick_distance",
]


# helper functions
def count_if(condition):
    return condition.fill_null(False).sum()


def epa_total(play_type):
    return (
        pl.when(pl.col("play_type") == play_type)
        .then(pl.col("epa"))
        .otherwise(None)
        .sum()
    )


def epa_plays(play_type):
    return count_if(
        (pl.col("play_type") == play_type)
        & pl.col("epa").is_not_null()
    )


def success_total(play_type):
    return (
        pl.when(pl.col("play_type") == play_type)
        .then(pl.col("success"))
        .otherwise(None)
        .sum()
    )


def success_plays(play_type):
    return count_if(
        (pl.col("play_type") == play_type)
        & pl.col("success").is_not_null()
    )


# process each season
for season in SEASONS:
    print(f"\nProcessing {season}...")

    pbp = nfl.load_pbp(season)

    missing = [
        name
        for name in REQUIRED_COLUMNS
        if name not in pbp.columns
    ]

    if missing:
        raise ValueError(
            f"{season}: missing required columns: {missing}"
        )

    pbp = (
        pbp.filter(
            pl.col("season_type") == "REG"
        )
        .with_columns(
            pl.col("posteam").replace(TEAM_RENAMES),
            pl.col("defteam").replace(TEAM_RENAMES),
        )
    )

    # normalize kicking results
    pbp = pbp.with_columns(
        pl.col("field_goal_result")
        .cast(pl.String)
        .str.to_lowercase()
        .alias("fg_result"),

        pl.col("extra_point_result")
        .cast(pl.String)
        .str.to_lowercase()
        .alias("pat_result"),

        pl.col("kick_distance")
        .cast(pl.Float64, strict=False)
        .alias("kick_distance_numeric"),
    )

    # offensive passing and rushing statistics
    scrimmage = pbp.filter(
        pl.col("play_type").is_in(["pass", "run"])
        & pl.col("posteam").is_not_null()
        & pl.col("defteam").is_not_null()
    )

    offense = (
        scrimmage.group_by([
            "game_id",
            "season",
            "week",
            "posteam",
        ])
        .agg(
            epa_total("pass").alias("off_pass_total_epa"),
            epa_plays("pass").alias("off_pass_plays"),
            success_total("pass").alias("off_pass_successes"),
            success_plays("pass").alias("off_pass_success_plays"),

            epa_total("run").alias("off_run_total_epa"),
            epa_plays("run").alias("off_run_plays"),
            success_total("run").alias("off_run_successes"),
            success_plays("run").alias("off_run_success_plays"),

            count_if(
                pl.col("interception") == 1
            ).alias("interceptions_thrown"),

            count_if(
                pl.col("fumble") == 1
            ).alias("off_fumble_plays"),

            count_if(
                pl.col("fumble_lost") == 1
            ).alias("off_fumbles_lost"),
        )
        .rename({
            "posteam": "team",
        })
    )

    # defensive passing, rushing, and turnover statistics
    defense = (
        scrimmage.group_by([
            "game_id",
            "defteam",
        ])
        .agg(
            epa_total("pass").alias("def_pass_total_epa_allowed"),
            epa_plays("pass").alias("def_pass_plays"),

            epa_total("run").alias("def_run_total_epa_allowed"),
            epa_plays("run").alias("def_run_plays"),

            success_total("pass").alias("def_pass_successes_allowed"),
            success_plays("pass").alias("def_pass_success_plays"),

            success_total("run").alias("def_run_successes_allowed"),
            success_plays("run").alias("def_run_success_plays"),

            count_if(
                pl.col("interception") == 1
            ).alias("def_interceptions"),

            count_if(
                pl.col("fumble") == 1
            ).alias("opponent_fumble_plays"),

            count_if(
                pl.col("fumble_lost") == 1
            ).alias("def_fumble_takeaways"),
        )
        .rename({
            "defteam": "team",
        })
    )

    # field goal statistics
    field_goals = (
        pbp.filter(
            pl.col("fg_result").is_not_null()
            & pl.col("posteam").is_not_null()
        )
        .group_by(["game_id", "posteam"])
        .agg(
            pl.len().alias("fg_attempts"),

            count_if(
                pl.col("fg_result") == "made"
            ).alias("fg_made"),

            count_if(
                pl.col("fg_result") == "missed"
            ).alias("fg_missed"),

            count_if(
                pl.col("fg_result") == "blocked"
            ).alias("fg_blocked"),

            count_if(
                (pl.col("kick_distance_numeric") >= 50)
                & (pl.col("fg_result") == "made")
            ).alias("fg_50_plus_made"),

            count_if(
                pl.col("kick_distance_numeric") >= 50
            ).alias("fg_50_plus_attempts"),

            pl.col("kick_distance_numeric")
            .sum()
            .alias("fg_attempt_distance"),

            pl.col("kick_distance_numeric")
            .filter(pl.col("fg_result") == "made")
            .sum()
            .alias("fg_made_distance"),
        )
        .rename({
            "posteam": "team",
        })
    )

    # extra point statistics
    extra_points = (
        pbp.filter(
            pl.col("pat_result").is_not_null()
            & pl.col("posteam").is_not_null()
        )
        .group_by(["game_id", "posteam"])
        .agg(
            pl.len().alias("pat_att"),

            count_if(
                pl.col("pat_result").is_in(["good", "made"])
            ).alias("pat_made"),

            count_if(
                pl.col("pat_result").is_in(["failed", "missed"])
            ).alias("pat_missed"),

            count_if(
                pl.col("pat_result") == "blocked"
            ).alias("pat_blocked"),
        )
        .rename({
            "posteam": "team",
        })
    )

    # combine team-game statistics
    expanded = (
        offense
        .join(
            defense,
            on=["game_id", "team"],
            how="left",
        )
        .join(
            field_goals,
            on=["game_id", "team"],
            how="left",
        )
        .join(
            extra_points,
            on=["game_id", "team"],
            how="left",
        )
        .sort(["season", "week", "game_id", "team"])
    )

    # teams without kicking attempts receive zero counts
    kicking_counts = [
        "fg_attempts",
        "fg_made",
        "fg_missed",
        "fg_blocked",
        "fg_50_plus_made",
        "fg_50_plus_attempts",
        "pat_att",
        "pat_made",
        "pat_missed",
        "pat_blocked",
    ]

    expanded = expanded.with_columns(
        [
            pl.col(name).fill_null(0)
            for name in kicking_counts
        ]
    )

    # zero attempts must not produce a zero percent estimate
    expanded = expanded.with_columns(
        pl.when(pl.col("fg_attempts") > 0)
        .then(
            pl.col("fg_made") / pl.col("fg_attempts")
        )
        .otherwise(None)
        .alias("fg_pct"),

        pl.when(pl.col("pat_att") > 0)
        .then(
            pl.col("pat_made") / pl.col("pat_att")
        )
        .otherwise(None)
        .alias("pat_pct"),
    )

    # validate team-game records
    duplicates = (
        expanded.group_by(["game_id", "team"])
        .len()
        .filter(pl.col("len") > 1)
    )

    assert duplicates.is_empty(), (
        f"{season}: duplicate team-game records"
    )

    assert expanded.select(
        pl.col("def_pass_plays").is_not_null().all()
    ).item(), (
        f"{season}: missing defensive passing statistics"
    )

    assert expanded.select(
        pl.col("def_run_plays").is_not_null().all()
    ).item(), (
        f"{season}: missing defensive rushing statistics"
    )

    output_path = (
        OUTPUT_DIR
        / f"expanded_team_stats_{season}.parquet"
    )

    expanded.write_parquet(output_path)

    print(
        f"Saved {expanded.height} team-game records "
        f"to {output_path.name}"
    )

    print(
        expanded.select([
            "off_pass_plays",
            "off_run_plays",
            "interceptions_thrown",
            "off_fumbles_lost",
            "fg_attempts",
            "pat_att",
        ]).sum()
    )

print("\nSUCCESS: Expanded team statistics generated.")
