from argparse import ArgumentParser
from datetime import date
from pathlib import Path
import json

import numpy as np
import polars as pl


# configuration
ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "processed"
MODEL_DIR = ROOT / "models"

TEAM_EFFICIENCY = {
    "v4_off_pass_epa": ("off_pass_total_epa", "off_pass_plays", 0.0, 250),
    "v4_off_run_epa": ("off_run_total_epa", "off_run_plays", 0.0, 200),
    "v4_def_pass_epa": ("def_pass_total_epa_allowed", "def_pass_plays", 0.0, 250),
    "v4_def_run_epa": ("def_run_total_epa_allowed", "def_run_plays", 0.0, 200),
    "v4_off_pass_success": ("off_pass_successes", "off_pass_success_plays", 0.45, 250),
    "v4_off_run_success": ("off_run_successes", "off_run_success_plays", 0.45, 200),
    "v4_def_pass_success_allowed": (
        "def_pass_successes_allowed", "def_pass_success_plays", 0.45, 250
    ),
    "v4_def_run_success_allowed": (
        "def_run_successes_allowed", "def_run_success_plays", 0.45, 200
    ),
}

QB_METRICS = [
    "completion_percentage_above_expectation",
    "avg_time_to_throw",
    "avg_intended_air_yards",
    "aggressiveness",
]

TEAM_RENAMES = {"OAK": "LV", "SD": "LAC", "STL": "LA", "LAR": "LA", "JAC": "JAX"}


def load_table(path):
    if not path.exists():
        raise FileNotFoundError(path)
    return pl.read_parquet(path)


def sums(frame, columns):
    return {
        name: float(frame[name].sum()) if frame.height else 0.0
        for name in columns
    }


def prepare_team_features(team, season, week, rolling, expanded, preseason):
    # historical observations are actual games, not previously lagged features
    current_r = rolling.filter(
        (pl.col("team") == team)
        & (pl.col("season") == season)
        & (pl.col("week") < week)
    )
    current_e = expanded.filter(
        (pl.col("team") == team)
        & (pl.col("season") == season)
        & (pl.col("week") < week)
    )
    previous_e = expanded.filter(
        (pl.col("team") == team)
        & (pl.col("season") == season - 1)
    )

    # require the two raw-data sources to cover exactly the same team-games
    if set(current_r["game_id"].to_list()) != set(current_e["game_id"].to_list()):
        raise ValueError(f"Historical team-game source mismatch: {team}")

    games = current_r.height
    current_weight = min(0.70, games / (games + 4.0))

    prior = preseason.filter(
        (pl.col("team") == team)
        & (pl.col("target_season") == season)
    )
    if prior.height != 1:
        raise ValueError(f"Expected one preseason row for {team} {season}")

    record = {
        "team": team,
        "team_completed_games": games,
        "team_latest_week": int(current_r["week"].max()) if games else None,
    }

    # reproduce blended_features.py
    for kind, total_col, plays_col, prior_col in [
        ("off", "off_total_epa", "off_plays", "preseason_off_epa"),
        ("def", "def_total_epa", "def_plays", "preseason_def_epa"),
    ]:
        total = float(current_r[total_col].sum()) if games else 0.0
        plays = float(current_r[plays_col].sum()) if games else 0.0
        preseason_rate = float(prior[prior_col][0])
        current_rate = total / plays if plays > 0 else preseason_rate
        record[f"blended_{kind}_epa"] = (
            current_weight * current_rate
            + (1.0 - current_weight) * preseason_rate
        )

    # reproduce the eight rate-method features from pregame_features_v4.py
    for output_name, (numerator, denominator, neutral, strength) in TEAM_EFFICIENCY.items():
        prev_num = float(previous_e[numerator].sum()) if previous_e.height else 0.0
        prev_den = float(previous_e[denominator].sum()) if previous_e.height else 0.0
        current_num = float(current_e[numerator].sum()) if games else 0.0
        current_den = float(current_e[denominator].sum()) if games else 0.0
        preseason_rate = (prev_num + strength * neutral) / (prev_den + strength)
        current_rate = current_num / current_den if current_den > 0 else preseason_rate
        record[output_name] = (
            current_weight * current_rate
            + (1.0 - current_weight) * preseason_rate
        )

    return record


def build_qb_snapshots(ngs, season, week):
    # include only completed QB performances before the forecast target week
    ngs = (
        ngs.filter(
            (pl.col("season") < season)
            | ((pl.col("season") == season) & (pl.col("week") < week))
        )
        .filter(pl.col("player_gsis_id").is_not_null() & (pl.col("attempts") > 0))
        .sort(["player_gsis_id", "season", "week"])
    )

    records = {}
    for player in ngs.partition_by("player_gsis_id", maintain_order=True):
        player_id = player["player_gsis_id"][0]
        attempts = player["attempts"].to_numpy().astype(float)
        recent = player.tail(3)
        recent_attempts = recent["attempts"].to_numpy().astype(float)
        row = {"qb_career_attempts": float(attempts.sum())}
        for metric in QB_METRICS:
            values = player[metric].to_numpy().astype(float)
            recent_values = recent[metric].to_numpy().astype(float)
            row[f"qb_career_{metric}"] = float(np.average(values, weights=attempts))
            row[f"qb_recent_{metric}"] = float(
                np.average(recent_values, weights=recent_attempts)
            )
        records[player_id] = row
    return records


def main():
    parser = ArgumentParser()
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--week", type=int, default=6)
    parser.add_argument("--as-of", type=date.fromisoformat, default=date(2026, 10, 9))
    parser.add_argument("--through-week", type=int, default=5)
    args = parser.parse_args()

    if args.through_week >= args.week:
        raise ValueError("The last completed data week must precede the target week")

    path = DATA_DIR / f"upcoming_matchups_{args.season}_week_{args.week}.parquet"
    games = load_table(path)
    if games.is_empty() or games["game_id"].n_unique() != games.height:
        raise ValueError("Upcoming matchup staging rows are empty or duplicated")
    if not games.select((pl.col("game_date") > args.as_of).all()).item():
        raise ValueError("Some staged games are on or before the forecast date")

    metadata = json.loads((MODEL_DIR / "model_metadata.json").read_text())
    required_models = {"v4_a", "v4_qb_plus"}
    if not required_models.issubset(metadata["models"]):
        raise ValueError("Expected both saved models in metadata")

    if (args.season, args.through_week) != (
        metadata["latest_training_season"], metadata["latest_training_week"]
    ):
        raise ValueError(
            "Training cutoff does not match requested data cutoff; "
            "retrain or explicitly rebuild aligned historical features"
        )

    rolling = load_table(DATA_DIR / "rolling_team_stats_2018_2026.parquet")
    preseason = load_table(DATA_DIR / "preseason_strength_2019_2026.parquet")
    expanded = pl.concat([
        load_table(DATA_DIR / f"expanded_team_stats_{year}.parquet")
        for year in [args.season - 1, args.season]
    ])
    ngs = load_table(DATA_DIR / "qb_nextgen_weekly_2019_2026.parquet")

    # exclude all team games after the feature cutoff
    rolling = rolling.filter(
        (pl.col("season") < args.season)
        | ((pl.col("season") == args.season) & (pl.col("week") <= args.through_week))
    )
    expanded = expanded.filter(
        (pl.col("season") < args.season)
        | ((pl.col("season") == args.season) & (pl.col("week") <= args.through_week))
    )
    ngs = ngs.filter(
        (pl.col("season") < args.season)
        | ((pl.col("season") == args.season) & (pl.col("week") <= args.through_week))
    )

    # ensure every completed 2026 team-game has a game date before the cutoff
    from nflreadpy import load_schedules
    schedule = load_schedules(args.season)
    schedule = schedule.with_columns(
        pl.col("gameday").cast(pl.String).str.strptime(pl.Date, "%Y-%m-%d")
        .alias("game_date")
    )
    ids = expanded.filter(pl.col("season") == args.season)["game_id"].unique()
    checked = (
        pl.DataFrame({"game_id": ids})
        .join(schedule.select("game_id", "game_date"), on="game_id", how="left")
    )
    if checked["game_date"].null_count() or not checked.select(
        (pl.col("game_date") < args.as_of).all()
    ).item():
        raise ValueError("Historical team stats contain a game on/after the as-of date")

    teams = sorted(set(games["home_team"].to_list() + games["away_team"].to_list()))
    ratings = pl.DataFrame([
        prepare_team_features(team, args.season, args.week, rolling, expanded, preseason)
        for team in teams
    ])
    if ratings["team"].n_unique() != len(teams):
        raise ValueError("A team has duplicate current ratings")

    # use the projected primary passer saved by upcoming_matchups.py
    snapshots = build_qb_snapshots(ngs, args.season, args.week)
    qb_records = []
    for side in ("home", "away"):
        for entry in games.iter_rows(named=True):
            player_id = entry[f"{side}_projected_qb_id"]
            history = snapshots.get(player_id)
            row = {"game_id": entry["game_id"], "side": side}
            row["qb_projection_missing"] = float(player_id is None)
            row["qb_history_missing"] = float(history is None)
            row["qb_career_attempts"] = history["qb_career_attempts"] if history else None
            for metric in QB_METRICS:
                for prefix in ("career", "recent"):
                    col = f"qb_{prefix}_{metric}"
                    row[col] = history[col] if history else None
            qb_records.append(row)
    qb_frame = pl.DataFrame(qb_records)

    output = games
    for side in ("home", "away"):
        team_data = ratings.rename({
            "team": f"{side}_team",
            **{key: f"{side}_{key}" for key in ratings.columns if key != "team"},
        })
        output = output.join(team_data, on=f"{side}_team", how="left")
        qb_data = qb_frame.filter(pl.col("side") == side).drop("side")
        qb_data = qb_data.rename({key: f"{side}_{key}" for key in qb_data.columns if key != "game_id"})
        output = output.join(qb_data, on="game_id", how="left")

    # construct the exact feature names used by train_final.py
    for metric in ["blended_off_epa", "blended_def_epa", *TEAM_EFFICIENCY]:
        output = output.with_columns(
            (pl.col(f"home_{metric}") - pl.col(f"away_{metric}")).alias(f"diff_{metric}")
        )
    for metric in QB_METRICS:
        for prefix in ("career", "recent"):
            field = f"qb_{prefix}_{metric}"
            output = output.with_columns(
                (pl.col(f"home_{field}") - pl.col(f"away_{field}")).alias(f"diff_{field}")
            )
    output = output.with_columns(
        (
            pl.col("home_qb_career_attempts").log1p()
            - pl.col("away_qb_career_attempts").log1p()
        ).alias("qb_experience_diff")
    )

    if output.height != games.height or output["game_id"].n_unique() != games.height:
        raise ValueError("One or more games duplicated during feature joins")

    features = metadata["models"]["v4_qb_plus"]["features"]
    if len(features) != 18 or len(metadata["models"]["v4_a"]["features"]) != 10:
        raise ValueError("Saved feature counts differ from expected model schemas")
    missing = [name for name in features if name not in output.columns]
    if missing:
        raise ValueError(f"Missing trained features: {missing}")
    for name in features:
        values = output[name].to_numpy().astype(float)
        if np.isinf(values).any():
            raise ValueError(f"Infinite values: {name}")
    for name in metadata["models"]["v4_a"]["features"]:
        if output[name].null_count():
            raise ValueError(f"Missing required V4-A efficiency feature: {name}")

    # include all feature columns as ordinary parquet columns for model serving
    outfile = DATA_DIR / f"upcoming_features_{args.season}_week_{args.week}.parquet"
    output.write_parquet(outfile)
    print(f"PASS: {len(features)} V4-QB+ features match saved model metadata.")
    print(f"PASS: {output.height} upcoming games preserved.")
    print("\nRecent team-game coverage:")
    print(output.select("home_team", "away_team", "home_team_latest_week", "away_team_latest_week"))
    print("\nMissing QB histories:")
    print(output.select(
        pl.col("home_qb_history_missing").sum().alias("home"),
        pl.col("away_qb_history_missing").sum().alias("away"),
    ))
    print(f"\nSUCCESS: Saved {outfile}")
    print("NOTE: No probabilities generated; predictions require a separate model-serving step.")


if __name__ == "__main__":
    main()
