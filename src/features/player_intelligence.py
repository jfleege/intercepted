"""Source-backed player directory, appearance history, and period usage (no sportsbook calls)."""
import json
from collections import defaultdict
from src.ml.refresh_performance import ROOT, utcnow, write_json
from src.ml.projection_features import final_games, team_name, num

KINDS = {'QB':'passing','RB':'rushing','WR':'receiving','TE':'receiving'}
FIELDS = ('passing_yards','rushing_yards','receiving_yards','attempts','carries','targets','receptions','passing_tds','rushing_tds','receiving_tds')


def periods(rows, games):
    allowed = {g['game_id'] for g in games}
    grouped, quarters = defaultdict(lambda: defaultdict(lambda: [0,0,0,0])), defaultdict(set)
    for r in rows:
        gid, q = r.get('game_id'), r.get('qtr')
        if gid not in allowed or q not in (1,2,3,4,5): continue
        quarters[gid].add(q)
        if r.get('play_type') == 'no_play' or r.get('no_play') == 1 or r.get('qb_kneel') == 1 or r.get('qb_spike') == 1: continue
        for field, flag, index in [('passer_player_id','pass_attempt',0),('rusher_player_id','rush_attempt',1),('receiver_player_id','pass_attempt',2)]:
            pid = r.get(field)
            if pid and r.get(flag) == 1:
                grouped[(gid,pid)][int(q)][index] += 1
                if index == 2 and r.get('complete_pass') == 1: grouped[(gid,pid)][int(q)][3] += 1
    return {key:[{'period':f'Q{q}' if q<5 else 'OT','attempts':v[0],'carries':v[1],'targets':v[2],'receptions':v[3],'touches':v[1]+v[3]} for q in range(1,6) for v in [qs[q]]]
            for key,qs in grouped.items() if quarters[key[0]].issuperset({1,2,3,4})}


def build(predictions, stats, schedules, identities, pbp, now):
    season, week = predictions['season'], predictions['week']
    games = [g for g in final_games(schedules,season,week,now) if int(g['season'])==season]
    lookup = {(int(g['week']),team_name(g[side])):g for g in games for side in ('home_team','away_team')}
    metadata = {p.get('gsis_id',p.get('player_id')):p for p in identities}
    all_history = defaultdict(dict)
    splits = periods(pbp,games)
    for row in stats:
        if row.get('season') != season or row.get('position') not in KINDS or row.get('season_type','REG') != 'REG': continue
        team = team_name(row.get('recent_team') or row.get('team') or row.get('team_abbr'))
        game = lookup.get((int(row['week']),team)); pid = row.get('player_id') or row.get('gsis_id')
        if not game or not pid: continue
        other = game['away_team'] if team_name(game['home_team']) == team else game['home_team']
        item = {k:num(row.get(k),None) for k in FIELDS}
        item.update(game_id=game['game_id'],week=int(row['week']),date=str(game['gameday'])[:10],team=team,opponent=team_name(other),
                    name=row.get('player_display_name') or row.get('player_name') or pid,position=row['position'],periods=splits.get((game['game_id'],pid)))
        all_history[pid][game['game_id']] = item
    matchups = {g[side]:(g['game_id'],g['away_team'] if side=='home_team' else g['home_team']) for g in predictions['games'] for side in ('home_team','away_team')}
    output=[]
    for pid, by_game in all_history.items():
        history=sorted(by_game.values(),key=lambda r:(r['date'],r['week']))
        last=history[-1]; meta=metadata.get(pid,{})
        # Latest observed team, not an offseason roster assignment. Projections can add newer identities in the UI.
        team=last['team']
        if team not in matchups: continue
        headshot=meta.get('headshot') or meta.get('headshot_url')
        output.append({'player_id':pid,'name':last['name'],'position':last['position'],'team':team,'opponent':matchups[team][1],
                       'game_id':matchups[team][0],'headshot':headshot if isinstance(headshot,str) and headshot.startswith('https://') else None,
                       'history':history})
    return {'schema_version':1,'season':season,'week':week,'through_week':week-1,'exported_at':now,'players':output,
            'policy':'Completed regular-season appearances before the forecast week. Missing statistics remain null. Period usage excludes no-play, kneel and spike rows; OT is separate. Latest observed team is not a confirmed active roster.'}


def main():
    import nflreadpy as nfl
    import polars as pl
    data=json.loads((ROOT/'frontend/public/predictions.json').read_text()); season=data['season']
    path=ROOT/f'data/raw/research/pbp-{season}.parquet'
    required={'passer_player_id','rusher_player_id','receiver_player_id','pass_attempt','rush_attempt','complete_pass','play_type','qb_kneel','qb_spike'}
    cached=pl.read_parquet(path) if path.exists() else None
    pbp=cached if cached is not None and required.issubset(cached.columns) else nfl.load_pbp(season)
    result=build(data,nfl.load_player_stats(seasons=season,summary_level='week').to_dicts(),nfl.load_schedules(season).to_dicts(),nfl.load_players().to_dicts(),pbp.select(['game_id','qtr',*sorted(required)]).to_dicts(),utcnow())
    write_json(ROOT/'frontend/public/player_intelligence.json',result)
    print(f"Exported {len(result['players'])} player histories.")

if __name__=='__main__': main()
