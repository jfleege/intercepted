"""Read-only source check for the TB Week 7 omission; no forecast publication or paid API."""
import json
import math
from pathlib import Path
import nflreadpy as nfl
import polars as pl
from src.features.qb_coverage import missing_ngs_weeks, low_volume_exclusions
from src.features.qb_starters import resolve_qb
from src.features.upcoming_features import build_qb_snapshots
from src.ml.refresh_performance import utcnow


def main():
    season, week, now = 2026, 8, utcnow()
    schedules = nfl.load_schedules([season]).to_dicts()
    ngs = nfl.load_nextgen_stats(list(range(2019,season+1)),stat_type='passing')
    ngs = ngs.filter(pl.col('season_type').is_in(['REG','REGULAR']),pl.col('week').is_between(1,18))
    rows = ngs.to_dicts()
    missing = missing_ngs_weeks(schedules,rows,season,week,now)
    exclusions = low_volume_exclusions(missing,schedules,rows,nfl.load_player_stats([season]).to_dicts(),nfl.load_team_stats([season]).to_dicts(),season,week,now)
    game = next(g for g in schedules if g['week']==week and 'TB' in [g['home_team'],g['away_team']])
    qb = resolve_qb(game,'TB',rows,{},now,exclusions)
    features = build_qb_snapshots(ngs,season,week)[qb['player_id']]
    assert all(math.isfinite(value) for value in features.values())
    assert qb['player_id']=='00-0034855',qb
    report = {'validation_at':now,'season':season,'target_week':week,'missing_ngs_team_weeks':missing,
              'qualification_exclusions':exclusions,'tb_qb_selection':qb,'tb_available_ngs_features':features,
              'note':'Read-only current-source validation; not a generated or archived forecast.'}
    directory=Path('qa/qb-coverage');directory.mkdir(parents=True,exist_ok=True)
    (directory/'source-validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
