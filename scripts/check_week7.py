"""Run after building forecasts: end-to-end provenance and feature parity assertions."""
import json
import polars as pl
from src.ml.refresh_performance import ROOT, stamp
from src.features.model_context import context_features, CONTEXT_COLUMNS
payload = json.loads((ROOT / "frontend/public/predictions.json").read_text())
assert (payload["season"], payload["week"]) == (2026, 7), "Week 7 has not been generated"
assert payload["count"] == len(payload["games"]) > 0
for game in payload["games"]:
    for model in ("v4_a", "v4_qb_plus", "v5_qb_plus", "v5_boosted"):
        p = game[f"home_win_prob_{model}"]
        assert 0 <= p <= 1 and abs(p + game[f"away_win_prob_{model}"] - 1) < 1e-12
index = json.loads((ROOT / "frontend/public/prediction_weeks.json").read_text())
assert any(w["week"] == 6 for w in index["weeks"])
past = json.loads((ROOT / "frontend/public/predictions/2026-week-6.json").read_text())
assert len(past["games"]) == 14 and "v5_boosted" not in past["models"]
# Verify the live contextual builder reproduces the offline training context.
import nflreadpy as nfl
rows = nfl.load_schedules(list(range(2019, 2027))).to_dicts()
by_id = {r["game_id"]: r for r in rows}
context = pl.read_parquet(ROOT / "data/processed/game_context_2019_2026.parquet")
for record in context.to_dicts():
    live = context_features(by_id[record["game_id"]], rows)
    for key in CONTEXT_COLUMNS:
        if record[key] is None:
            import math
            assert math.isnan(live[key])
        else:
            assert abs(live[key] - float(record[key])) < 1e-12, (record["game_id"], key)
print(f'PASS: Week 7 {payload["count"]} games, archived Week 6, all historical context feature values match.')
