"""Opponent box-score allowances by position, per defensive team-game (not per player)."""
import json
import math
from collections import defaultdict
from src.ml.refresh_performance import ROOT,utcnow,write_json
from src.ml.projection_features import final_games,team_name
POSITIONS=('QB','RB','WR','TE')
FIELDS=('passing_yards','rushing_yards','receiving_yards','passing_tds','rushing_tds')

def number(value):
    return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)

def build(slate,schedules,stats,now):
    season,week=slate['season'],slate['week']
    games=[g for g in final_games(schedules,season,week,now) if int(g['season'])==season]
    rows=defaultdict(list)
    for r in stats:
        if r.get('season')==season and r.get('season_type','REG')=='REG':
            rows[(int(r['week']),team_name(r.get('team') or r.get('recent_team')))].append(r)
    history=defaultdict(list)
    for g in games:
        for defense,offense in [(team_name(g['home_team']),team_name(g['away_team'])),(team_name(g['away_team']),team_name(g['home_team']))]:
            positions={}
            team_rows=rows[(int(g['week']),offense)]
            all_ids=[r.get('player_id') or r.get('gsis_id') for r in team_rows]
            unknown=any(not r.get('position') and any(number(r.get(f)) and r[f]!=0 for f in FIELDS) for r in team_rows)
            for position in POSITIONS:
                group=[r for r in rows[(int(g['week']),offense)] if r['position']==position]
                ids=[r.get('player_id') or r.get('gsis_id') for r in group]
                unique=bool(group) and not unknown and all(ids) and all(all_ids.count(pid)==1 for pid in ids)
                positions[position]={f:round(sum(r[f] for r in group),3) if unique and all(number(r.get(f)) and (not f.endswith('_tds') or (r[f]>=0 and float(r[f]).is_integer())) for r in group) else None for f in FIELDS}
            history[defense].append({'game_id':g['game_id'],'week':int(g['week']),'opponent':offense,'positions':positions})
    teams={}
    for team,records in history.items():
        windows={}
        for name,size in [('last3',3),('last5',5),('season',len(records))]:
            recent=records[-size:];summary={}
            for position in POSITIONS:
                summary[position]={}
                for field in FIELDS:
                    values=[r['positions'][position][field] for r in recent if r['positions'][position][field] is not None]
                    summary[position][field]={'average':round(sum(values)/len(values),2) if values else None,'games':len(values),'window_games':len(recent)}
            windows[name]=summary
        teams[team]={'games':len(records),'through_week':max(r['week'] for r in records),'windows':windows,'history':records}
    return {'schema_version':1,'season':season,'week':week,'exported_at':now,'policy':'Regular-season completed games strictly before the selected week. Position totals per defensive team-game, including overtime; gross box-score yards, not net passing yards. Last 3/5 means defensive team games, not player appearances. All opposing players in each position are summed. Missing or ambiguous position rows remain unknown, not zero. Descriptive context, not a target hit probability or model adjustment.','teams':teams}

def main():
    import nflreadpy as nfl
    slate=json.loads((ROOT/'frontend/public/predictions.json').read_text())
    report=build(slate,nfl.load_schedules(slate['season']).to_dicts(),nfl.load_player_stats(seasons=slate['season'],summary_level='week').to_dicts(),utcnow())
    write_json(ROOT/f'frontend/public/position_defense/{slate["season"]}-week-{slate["week"]}.json',report)
    print(f'Exported position allowances for {len(report["teams"])} defensive teams.')
if __name__=='__main__':main()
