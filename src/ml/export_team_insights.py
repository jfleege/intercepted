"""Export team matchup context with a strict prior-week cutoff; no odds calls."""
import json
from datetime import datetime, timezone
from src.ml.refresh_performance import ROOT, write_json
from src.features.team_insights import build_team_insights

COLUMNS = ['game_id', 'season_type', 'play_type', 'posteam', 'defteam', 'epa', 'success',
           'total_home_score', 'total_away_score', 'fixed_drive', 'yardline_100', 'pass_touchdown', 'rush_touchdown',
           'third_down_converted', 'third_down_failed', 'interception', 'fumble_lost', 'field_goal_result']

def main():
    import nflreadpy as nfl
    forecast = json.loads((ROOT / 'frontend/public/predictions.json').read_text())
    season, week = forecast['season'], forecast['week']
    now = datetime.now(timezone.utc).isoformat()
    schedule = nfl.load_schedules(season).to_dicts()
    pbp = nfl.load_pbp(season).select(COLUMNS).to_dicts()
    output = {**build_team_insights(pbp, schedule, season, week, now), 'generated_at': now}
    write_json(ROOT / f'frontend/public/team_insights/{season}-week-{week}.json', output)
    print(f'Exported {len(output["teams"])} teams; input cutoff Week {week - 1}.')

if __name__ == '__main__':
    main()
