"""Chronological experimental usage and threshold candidates; no original forecasts rewritten."""
import json
import argparse
import hashlib
import time
from pathlib import Path
from datetime import datetime, timezone
import numpy as np
from src.ml.refresh_performance import ROOT, kickoff, stamp, write_json
from src.ml.projection_features import build_history, player_features, team_summary, KINDS, USAGE, day
from src.ml.projection_models import fit_event, predict_event, fit_regression, predict_regression, PLAYER_FEATURES

THRESHOLDS={'passing':[150,200,250,300], 'rushing':[25,50,60,75,100], 'receiving':[25,50,60,75,100]}

def run(cache):
 import polars as pl
 now=datetime.now(timezone.utc).isoformat()
 slate=json.loads((ROOT/'frontend/public/predictions.json').read_text())
 if slate['season']<2026:raise ValueError('Extension evaluation requires forecasts after the fixed 2025 development year')
 def source(name):
  historical=cache/f'{name}-through-{slate["season"]-1}.parquet';current=cache/f'{name}-{slate["season"]}.parquet'
  paths=[historical,current] if historical.exists() and current.exists() else [cache/f'{name}.parquet']
  return [row for path in paths for row in pl.read_parquet(path).to_dicts()]
 schedules=source('schedules')
 players=source('players')
 # Only records earlier than the active forecast week are admitted.
 _,rows,teams,histories=build_history(schedules,players,slate['season'],slate['week'],now)
 lookup={(r['player_id'],int(r['season']),int(r['week'])):r for r in players}
 for r in rows:r['opportunities']=float(lookup[(r['player_id'],r['season'],r['week'])].get(USAGE[r['kind']]) or 0)
 watch=json.loads((ROOT/'frontend/public/players_watch.json').read_text())
 contexts=json.loads((ROOT/'frontend/public/forecast_insights.json').read_text())
 directory=json.loads((ROOT/'frontend/public/player_intelligence.json').read_text())
 latest={p['player_id']:max((h['game_id'] for h in p.get('history',[])),default=None) for p in directory.get('players',[])}
 from src.features.pregame_roles import Roles
 import nflreadpy as nfl
 depth_path=cache/'timestamped-depth.parquet'
 if not depth_path.exists() or time.time()-depth_path.stat().st_mtime>86400:nfl.load_depth_charts([2025,slate['season']]).write_parquet(depth_path)
 roles=Roles(pl.read_parquet(depth_path).to_dicts())
 schedule_by_id={g['game_id']:g for g in schedules}
 role_columns=PLAYER_FEATURES+['depth_rank']
 for row in rows:
  raw=lookup[(row['player_id'],row['season'],row['week'])]
  g=schedule_by_id[row['game_id']]
  role=roles.lookup(raw.get('team',raw.get('recent_team')),row['player_id'],kickoff(g))
  row['role_x']={**row['x'],'depth_rank':role['rank']} if role else None
 fitted={};validation=[];role_fitted={};role_thresholds={}
 for kind in THRESHOLDS:
  group=[r for r in rows if r['kind']==kind]
  train=[r for r in group if r['season']<=2023]
  cal=[r for r in group if r['season']==2024]
  test=[r for r in group if r['season']==2025]
  if min(len(train),len(cal),len(test))<100:continue
  usage=fit_regression(train,cal,PLAYER_FEATURES,'opportunities')
  pred=predict_regression(usage,test);y=np.array([r['opportunities'] for r in test]);base=np.array([r['x']['recent_usage'] for r in test])
  mae=float(np.mean(abs(pred-y)));baseline=float(np.mean(abs(base-y)))
  validation.append({'kind':kind,'target':'usage','samples':len(test),'mae':mae,'baseline_mae':baseline,'promoted':mae<baseline})
  fitted[(kind,'usage')]=usage if mae<baseline else None
  role_rows=[{**r,'x':r['role_x']} for r in group if r.get('role_x')]
  role_train=[r for r in role_rows if r['season']==2025 and r['week']<=12]
  role_cal=[r for r in role_rows if r['season']==2025 and r['week']>12]
  role_test=[r for r in role_rows if r['season']==slate['season']]
  if min(len(role_train),len(role_cal),len(role_test))>=40:
   candidate=fit_regression(role_train,role_cal,role_columns,'opportunities')
   rp=predict_regression(candidate,role_test)
   regular=predict_regression(usage,[{**r,'x':{k:r['x'][k] for k in PLAYER_FEATURES}} for r in role_test])
   ry=np.array([r['opportunities'] for r in role_test]);recent=np.array([r['x']['recent_usage'] for r in role_test])
   error=float(np.mean(abs(rp-ry)));regular_error=float(np.mean(abs(regular-ry)));recent_error=float(np.mean(abs(recent-ry)))
   promoted=error<min(regular_error,recent_error)
   role_fitted[kind]=candidate if promoted else None
   validation.append({'kind':kind,'target':'role_usage','samples':len(role_test),'mae':error,'baseline_mae':recent_error,'regular_usage_mae':regular_error,'promoted':promoted,'fit':'2025 through W12','calibration':'2025 W13–18','evaluation':f'{slate["season"]} completed weeks; development gate, not prospective validation'})
  for threshold in THRESHOLDS[kind]:
   for r in group:r['threshold_event']=int(r['yards']>=threshold)
   model=fit_event(train,cal,'threshold_event');p=predict_event(model,test)
   actual=np.array([r['threshold_event'] for r in test]);rate=np.mean([r['threshold_event'] for r in cal])
   brier=float(np.mean((p-actual)**2));baseline=float(np.mean((rate-actual)**2))
   validation.append({'kind':kind,'target':threshold,'samples':len(test),'brier':brier,'baseline_brier':baseline,'promoted':brier<baseline})
   fitted[(kind,threshold)]=model if brier<baseline else None
   if min(len(role_train),len(role_cal),len(role_test))>=40:
    for subset in [role_train,role_cal,role_test]:
     for r in subset:r['threshold_event']=int(r['yards']>=threshold)
    if all(len({r['threshold_event'] for r in subset})==2 for subset in [role_train,role_cal]):
     candidate=fit_event(role_train,role_cal,'threshold_event',role_columns)
     rp=predict_event(candidate,role_test);actual=np.array([r['threshold_event'] for r in role_test])
     standard=predict_event(model,[{**r,'x':{k:r['x'][k] for k in PLAYER_FEATURES}} for r in role_test])
     error=float(np.mean((rp-actual)**2));standard_error=float(np.mean((standard-actual)**2));rate=np.mean([r['threshold_event'] for r in role_cal]);baseline_error=float(np.mean((rate-actual)**2))
     promoted=error<min(standard_error,baseline_error)
     role_thresholds[(kind,threshold)]=candidate if promoted else None
     validation.append({'kind':kind,'target':f'role_threshold_{threshold}','samples':len(role_test),'brier':error,'baseline_brier':baseline_error,'regular_brier':standard_error,'promoted':promoted})
 games={r['game_id']:r for r in schedules};output=[]
 for gid,game in watch.get('games',{}).items():
  g=games.get(gid)
  if not g or stamp(kickoff(g))<=stamp(now):continue
  for side,other in [('home','away'),('away','home')]:
   team=g[f'{side}_team'];opp=g[f'{other}_team']
   own=team_summary(teams,team,slate['season'],day(g));opponent=team_summary(teams,opp,slate['season'],day(g))
   for player in game.get(f'{side}_players',[]):
    kind=KINDS.get(player['position']);history=histories.get(player['player_id'],[])
    if not kind:continue
    # Do not publish from an older cache when the public directory has newer appearances.
    current_games={r['game_id'] for r in rows if r['player_id']==player['player_id']}
    if latest.get(player['player_id']) and latest[player['player_id']] not in current_games:continue
    x=player_features(history,kind,player['position'],slate['season'],own,opponent,side=='home',slate['week'])
    if not x:continue
    contexts_for=[c for c in contexts.get('players',[]) if c['game_id']==gid and c['player_id']==player['player_id']]
    from src.features.player_context import within
    c=contexts_for[0] if len(contexts_for)==1 else None
    out=bool(c and contexts.get('season')==slate['season'] and contexts.get('week')==slate['week'] and c['availability']['status']=='Out' and c['availability']['blocked'] and within(c['availability'].get('observed_at'),now))
    model=fitted.get((kind,'usage'))
    role_model=role_fitted.get(kind)
    role_current=bool(c and contexts.get('season')==slate['season'] and contexts.get('week')==slate['week'] and c.get('team')==team and c.get('opponent')==opp and c.get('kickoff')==kickoff(g) and within(contexts.get('exported_at'),now) and within(c['starter'].get('updated_at'),now) and c['starter'].get('rank') is not None)
    role_x={**x,'depth_rank':c['starter']['rank']} if role_current else None
    role_usage=float(predict_regression(role_model,[{'x':role_x}])[0]) if role_model and role_x else None
    thresholds=[]
    for threshold in THRESHOLDS[kind]:
     m=fitted.get((kind,threshold))
     rm=role_thresholds.get((kind,threshold)) if role_current else None
     if rm:thresholds.append({'threshold':threshold,'probability':round(float(predict_event(rm,[{'x':role_x}])[0]),6),'basis':'role_aware'})
     elif m:thresholds.append({'threshold':threshold,'probability':round(float(predict_event(m,[{'x':x}])[0]),6),'basis':'conditional_baseline'})
    # Separate classifiers can cross; withhold incoherent curves rather than silently repair them.
    if any(b['probability']>a['probability'] for a,b in zip(thresholds,thresholds[1:])):thresholds=[]
    output.append({'game_id':gid,'player_id':player['player_id'],'team':team,'opponent':opp,'kickoff':kickoff(g),'kind':kind,'usage_field':USAGE[kind], 'usage':0 if out else round(role_usage,1) if role_usage is not None else round(float(predict_regression(model,[{'x':x}])[0]),1) if model else None,'usage_status':'reported_out' if out else 'role_aware_conditional' if role_usage is not None else 'conditional_model' if model else 'baseline_not_beaten','baseline_usage':x['recent_usage'],'thresholds':[] if out else thresholds,'role_adjustment':'Timestamped depth-rank model passed development gate' if role_usage is not None else 'Role candidate not promoted or fresh unambiguous role evidence unavailable; base estimate retained', 'role_rank':c['starter']['rank'] if role_current else None})
 report={'schema_version':1,'season':slate['season'],'week':slate['week'],'generated_at':now,'version':'player-extensions:'+hashlib.sha256(Path(__file__).read_bytes()+(ROOT/'src/features/pregame_roles.py').read_bytes()+(ROOT/'src/ml/projection_models.py').read_bytes()+json.dumps(validation,sort_keys=True).encode()).hexdigest()[:16],'policy':'Experimental conditional-on-appearing estimates. Fit through 2023; calibrate 2024; evaluate 2025. Development gates, not independent prospective validation. No heuristic injury penalties or inferred participation probabilities. Original forecasts unchanged. Threshold means yards >= target; unsupported targets unavailable.','validation':validation,'players':output}
 write_json(ROOT/'frontend/public/player_extensions.json',report)
 print(json.dumps({'players':len(output),'validation':validation},indent=2))

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--cache',type=Path,default=ROOT/'data/raw/research');args=parser.parse_args();run(args.cache)
