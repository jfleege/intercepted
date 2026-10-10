
import json
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

import nflreadpy as nfl


# configuration
ROOT = Path(__file__).resolve().parents[2]
PREDICTIONS = (
    ROOT / "frontend" / "public" / "predictions.json"
)
OUTPUT = (
    ROOT / "frontend" / "public" / "players_watch.json"
)

AS_OF = date(2026, 10, 9)

TEAM_RENAMES = {
    "OAK": "LV",
    "SD": "LAC",
    "STL": "LA",
    "LAR": "LA",
    "JAC": "JAX",
}

STAT_OPTIONS = {
    "QB": ("passing_yards", "Passing yards"),
    "RB": ("rushing_yards", "Rushing yards"),
    "WR": ("receiving_yards", "Receiving yards"),
    "TE": ("receiving_yards", "Receiving yards"),
}


# helpers
def normalize_team(value):
    return TEAM_RENAMES.get(value, value)


def first_available(columns, candidates):
    return next(
        (name for name in candidates if name in columns),
        None,
    )


def number(value):
    try:
        return float(value or 0)
    except (ValueError, TypeError):
        return 0.0


def valid_headshot(value):
    if (
        isinstance(value, str)
        and value.startswith(("https://", "http://"))
    ):
        return value
    return None


# load prediction schedule
payload = json.loads(PREDICTIONS.read_text())
games = payload["games"]
season = payload["season"]
week = payload["week"]

teams = {
    normalize_team(team)
    for game in games
    for team in (game["home_team"], game["away_team"])
}

print(f"Loaded {len(games)} matchups.")
print(f"Target: {season} Week {week}")
print(f"Player statistics cutoff: {AS_OF}")


# load player statistics and identities
stats = nfl.load_player_stats(
    seasons=season,
    summary_level="week",
)

players = nfl.load_players()
schedule = nfl.load_schedules(season)

print(f"Loaded {stats.height:,} weekly player rows.")
print(f"Loaded {players.height:,} player records.")


# resolve source columns
stat_columns = stats.columns
player_columns = players.columns

player_id_col = first_available(
    stat_columns,
    ["player_id", "gsis_id"],
)

team_col = first_available(
    stat_columns,
    ["recent_team", "team", "team_abbr"],
)

name_col = first_available(
    stat_columns,
    ["player_display_name", "player_name", "display_name"],
)

position_col = first_available(
    stat_columns,
    ["position", "player_position"],
)

meta_id_col = first_available(
    player_columns,
    ["gsis_id", "player_id"],
)

headshot_col = first_available(
    player_columns,
    ["headshot", "headshot_url"],
)

required = {
    "player_id": player_id_col,
    "team": team_col,
    "name": name_col,
    "position": position_col,
    "metadata_id": meta_id_col,
}

missing = [
    name for name, value in required.items()
    if value is None
]

if missing:
    raise ValueError(
        f"Unsupported nflreadpy schema: {missing}\n"
        f"Player stats columns: {stat_columns}"
    )

required_stats = {
    field for field, _ in STAT_OPTIONS.values()
}

missing_stats = required_stats - set(stat_columns)

if missing_stats:
    raise ValueError(
        f"Missing required player stats: {missing_stats}"
    )

# validate touchdown statistics
td_columns = [
    "passing_tds",
    "rushing_tds",
    "receiving_tds",
]

missing_tds = [
    name for name in td_columns
    if name not in stat_columns
]

if missing_tds:
    raise ValueError(
        f"Missing touchdown columns: {missing_tds}"
    )

# map each team-week to its scheduled game date
dates = defaultdict(list)

for row in schedule.to_dicts():
    if row.get("game_type") != "REG":
        continue

    if row.get("gameday") is None:
        continue

    game_date = date.fromisoformat(
        str(row["gameday"])[:10]
    )

    for side in ("home_team", "away_team"):
        team = normalize_team(row[side])

        dates[(int(row["week"]), team)].append(
            game_date
        )

schedule_dates = {}

for key, values in dates.items():
    unique_dates = set(values)

    if len(unique_dates) != 1:
        raise ValueError(
            f"Ambiguous team-week schedule: {key}"
        )

    schedule_dates[key] = values[0]


# load player headshots by GSIS ID
identities = {}

for row in players.to_dicts():
    player_id = row.get(meta_id_col)

    if player_id is None:
        continue

    headshot = (
        valid_headshot(row.get(headshot_col))
        if headshot_col
        else None
    )

    existing = identities.get(player_id)

    if existing is None or (
        existing is None or existing.get("headshot") is None
    ):
        identities[player_id] = {
            "headshot": headshot,
        }


# collect only completed pre-cutoff games
history = defaultdict(list)

for row in stats.to_dicts():
    if int(row["season"]) != season:
        continue

    game_week = int(row["week"])

    if game_week >= week:
        continue

    season_type = row.get(
        "season_type",
        row.get("game_type", "REG"),
    )

    if season_type not in ("REG", None):
        continue

    team = normalize_team(row.get(team_col))

    if team not in teams:
        continue

    game_date = schedule_dates.get(
        (game_week, team)
    )

    if game_date is None:
        raise ValueError(
            f"Missing schedule date: {team} Week {game_week}"
        )

    if game_date > AS_OF:
        continue

    position = row.get(position_col)
    player_id = row.get(player_id_col)

    if (
        position not in STAT_OPTIONS
        or player_id is None
    ):
        continue

    stat_field, _ = STAT_OPTIONS[position]

        # calculate touchdowns by position
    if position == "QB":
        touchdowns = number(row["passing_tds"])
    else:
        touchdowns = (
            number(row["rushing_tds"])
            + number(row["receiving_tds"])
        )

    history[(team, player_id)].append({
        "week": game_week,
        "team": team,
        "name": row.get(name_col) or "Unknown player",
        "position": position,
        "value": number(row.get(stat_field)),
        "touchdowns": touchdowns,
    })


# summarize last three appearances
by_team = defaultdict(list)

for (team, player_id), records in history.items():
    records.sort(
        key=lambda row: row["week"],
        reverse=True,
    )

    recent = records[:3]

    if not recent:
        continue

    position = recent[0]["position"]
    stat_field, stat_label = STAT_OPTIONS[position]

        # recent and season production
    recent_average = sum(
        row["value"] for row in recent
    ) / len(recent)

    season_average = sum(
        row["value"] for row in records
    ) / len(records)

    recent_td_average = sum(
        row["touchdowns"] for row in recent
    ) / len(recent)

    # compare recent production with season average
    trend_pct = (
        (
            (recent_average - season_average)
            / season_average
        ) * 100
        if season_average > 0
        else None
    )

    by_team[team].append({
        "player_id": player_id,
        "name": recent[0]["name"],
        "team": team,
        "position": position,
        "headshot": identities.get(
            player_id, {}
        ).get("headshot"),
        "stat": stat_field,
        "stat_label": stat_label,
        "recent_average": round(recent_average, 1),
        "season_average": round(season_average, 1),
        "recent_td_average": round(recent_td_average, 2),
        "trend_pct": (
            round(trend_pct, 1)
            if trend_pct is not None
            else None
        ),
        "games_sampled": len(recent),
        "season_games": len(records),
        "last_game_week": recent[0]["week"],
    })


# choose one qb and three skill players per team
selected = {}

for team in teams:
    candidates = by_team.get(team, [])

    qbs = sorted(
        (p for p in candidates if p["position"] == "QB"),
        key=lambda p: (
            p["last_game_week"],
            p["recent_average"],
        ),
        reverse=True,
    )

    skill = sorted(
        (
            p for p in candidates
            if p["position"] in ("RB", "WR", "TE")
        ),
        key=lambda p: (
            p["last_game_week"],
            p["recent_average"],
        ),
        reverse=True,
    )

    selected[team] = qbs[:1] + skill[:3]


# generate per-matchup output
matchup_data = {}

for game in games:
    home = normalize_team(game["home_team"])
    away = normalize_team(game["away_team"])

    matchup_data[game["game_id"]] = {
        "away_team": away,
        "home_team": home,
        "away_players": selected.get(away, []),
        "home_players": selected.get(home, []),
    }

output = {
    "season": season,
    "week": week,
    "as_of": AS_OF.isoformat(),
    "exported_at": datetime.now(
        timezone.utc
    ).isoformat(),
    "games": matchup_data,
}

OUTPUT.parent.mkdir(
    parents=True,
    exist_ok=True,
)

OUTPUT.write_text(
    json.dumps(output, indent=2),
    encoding="utf-8",
)

headshots = sum(
    p["headshot"] is not None
    for players in selected.values()
    for p in players
)

print(f"Prepared player cards for {len(selected)} teams.")
print(f"Player headshots available: {headshots}")
print(f"SUCCESS: Saved {OUTPUT}")
