
from pathlib import Path

import nflreadpy as nfl
import polars as pl


# configuration
ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "processed"
OUTPUT_DIR = ROOT / "data" / "diagnostics"

DATA_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

SEASONS = list(range(2019, 2027))

TEAM_RENAMES = {
    "OAK": "LV",
    "SD": "LAC",
    "STL": "LA",
    "LAR": "LA",
    "JAC": "JAX",
}

NGS_PATH = (
    DATA_DIR / "qb_nextgen_weekly_2019_2026.parquet"
)

OUTPUT_PATH = (
    DATA_DIR / "qb_depth_chart_records_2019_2026.parquet"
)


# load existing quarterback data
ngs = pl.read_parquet(NGS_PATH)

ngs_ids = set(
    ngs["player_gsis_id"]
    .drop_nulls()
    .cast(pl.String)
    .to_list()
)

print(f"Loaded {len(ngs_ids):,} unique NGS QB IDs.")


# load depth charts by season
all_qbs = []
coverage = []

for season in SEASONS:
    print(f"\n{'=' * 60}")
    print(f"LOADING {season}")
    print(f"{'=' * 60}")

    try:
        depth = nfl.load_depth_charts(
            seasons=season
        )
    except Exception as error:
        print(f"Could not load {season}: {error}")

        coverage.append({
            "season": season,
            "status": "load_failed",
            "records": 0,
            "qb_records": 0,
            "unique_qbs": 0,
            "matched_qb_ids": 0,
            "id_match_rate": None,
            "timestamp_available": False,
        })

        continue

    print(f"Total records: {depth.height:,}")
    print(f"Columns: {depth.columns}")

    if depth.is_empty():
        print("No records found.")
        continue

    # identify schema
    if "dt" in depth.columns:
        schema = "timestamped"
        position_column = "pos_abb"

    elif "week" in depth.columns:
        schema = "weekly"
        position_column = "position"

    else:
        print("Unrecognized depth-chart schema.")
        continue

    if position_column not in depth.columns:
        print(
            f"Missing QB position column: "
            f"{position_column}"
        )
        continue

    # filter quarterback records
    qbs = depth.filter(
        pl.col(position_column)
        .cast(pl.String)
        .str.to_uppercase() == "QB"
    )

    print(f"Schema: {schema}")
    print(f"QB records: {qbs.height:,}")

    if qbs.is_empty():
        continue

    # normalize player identifiers
    if "gsis_id" not in qbs.columns:
        qbs = qbs.with_columns(
            pl.lit(None)
            .cast(pl.String)
            .alias("gsis_id")
        )

    qbs = qbs.with_columns(
        pl.col("gsis_id")
        .cast(pl.String)
        .alias("qb_id")
    )

    # normalize team names
    team_column = (
        "team"
        if "team" in qbs.columns
        else "club_code"
    )

    qbs = qbs.with_columns(
        pl.col(team_column)
        .replace(TEAM_RENAMES)
        .alias("normalized_team")
    )

    # identify player names
    if "player_name" in qbs.columns:
        qbs = qbs.with_columns(
            pl.col("player_name")
            .alias("qb_name")
        )

    elif "full_name" in qbs.columns:
        qbs = qbs.with_columns(
            pl.col("full_name")
            .alias("qb_name")
        )

    else:
        qbs = qbs.with_columns(
            pl.lit(None)
            .cast(pl.String)
            .alias("qb_name")
        )

    # inspect qb rank information
    rank_columns = [
        name
        for name in [
            "depth_team",
            "depth_position",
            "pos_rank",
            "pos_slot",
        ]
        if name in qbs.columns
    ]

    print("\nAvailable ranking fields:")
    print(rank_columns)

    for name in rank_columns:
        print(f"\n{name} values:")
        print(
            qbs.group_by(name)
            .len()
            .sort("len", descending=True)
            .head(10)
        )

    # check compatibility with ngs ids
    unique_ids = set(
        qbs["qb_id"]
        .drop_nulls()
        .to_list()
    )

    matched_ids = unique_ids & ngs_ids

    match_rate = (
        len(matched_ids) / len(unique_ids)
        if unique_ids
        else None
    )

    print("\nGSIS ID compatibility:")
    print(f"Unique depth-chart QBs: {len(unique_ids)}")
    print(f"Matched to NGS: {len(matched_ids)}")

    if match_rate is not None:
        print(f"Match rate: {match_rate:.1%}")

    # inspect snapshot dates or weeks
    if schema == "timestamped":
        print("\nSnapshot timestamps:")

        print(
            qbs.select(
                pl.col("dt").min().alias("first"),
                pl.col("dt").max().alias("last"),
                pl.col("dt").n_unique().alias(
                    "unique_snapshots"
                ),
            )
        )

    else:
        print("\nWeekly coverage:")

        print(
            qbs.group_by("week")
            .agg(
                pl.col("normalized_team")
                .n_unique()
                .alias("teams"),
            )
            .sort("week")
        )

    # build common audit dataset
    if "week" not in qbs.columns:
        qbs = qbs.with_columns(
            pl.lit(None)
            .cast(pl.Int32)
            .alias("week")
        )

    if "dt" not in qbs.columns:
        qbs = qbs.with_columns(
            pl.lit(None)
            .cast(pl.String)
            .alias("dt")
        )

    if "depth_team" not in qbs.columns:
        qbs = qbs.with_columns(
            pl.lit(None)
            .cast(pl.String)
            .alias("depth_team")
        )

    if "pos_rank" not in qbs.columns:
        qbs = qbs.with_columns(
            pl.lit(None)
            .cast(pl.Float64)
            .alias("pos_rank")
        )

    selected = qbs.select(
        pl.lit(season).alias("season"),
        pl.lit(schema).alias("schema"),
        "normalized_team",
        "qb_id",
        "qb_name",
        pl.col("week").cast(pl.Int32),
        pl.col("dt").cast(pl.String),
        pl.col("depth_team").cast(pl.String),
        pl.col("pos_rank").cast(pl.Float64),
    )

    all_qbs.append(selected)

    coverage.append({
        "season": season,
        "status": "loaded",
        "records": depth.height,
        "qb_records": qbs.height,
        "unique_qbs": len(unique_ids),
        "matched_qb_ids": len(matched_ids),
        "id_match_rate": match_rate,
        "timestamp_available": schema == "timestamped",
    })


# combine and validate
assert all_qbs, (
    "No usable quarterback depth-chart data."
)

output = pl.concat(
    all_qbs,
    how="vertical"
)

assert output.height > 0

print(f"\n{'=' * 60}")
print("DEPTH CHART AUDIT SUMMARY")
print(f"{'=' * 60}")

coverage_df = pl.DataFrame(coverage)

print(coverage_df)


# inspect recent qb depth charts
print("\n2026 QB examples:")

recent = output.filter(
    pl.col("season") == 2026
)

if not recent.is_empty():
    print(
        recent.select([
            "normalized_team",
            "qb_name",
            "qb_id",
            "dt",
            "pos_rank",
        ])
        .head(15)
    )


# save audit results
output.write_parquet(OUTPUT_PATH)

coverage_df.write_csv(
    OUTPUT_DIR / "depth_chart_coverage.csv"
)

print("\nSUCCESS: Depth chart audit completed.")
print(f"Saved {output.height:,} QB depth-chart records.")
print(f"Output: {OUTPUT_PATH.name}")
