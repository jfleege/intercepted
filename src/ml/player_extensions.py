"""Chronological experimental usage and threshold candidates; no original forecasts rewritten."""
import json
import argparse
import hashlib
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
 fitted={};validation=[]
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
  for threshold in THRESHOLDS[kind]:
   for r in group:r['threshold_event']=int(r['yards']>=threshold)
   model=fit_event(train,cal,'threshold_event');p=predict_event(model,test)
   actual=np.array([r['threshold_event'] for r in test]);rate=np.mean([r['threshold_event'] for r in cal])
   brier=float(np.mean((p-actual)**2));baseline=float(np.mean((rate-actual)**2))
   validation.append({'kind':kind,'target':threshold,'samples':len(test),'brier':brier,'baseline_brier':baseline,'promoted':brier<baseline})
   fitted[(kind,threshold)]=model if brier<baseline else None
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
    thresholds=[]
    for threshold in THRESHOLDS[kind]:
     m=fitted.get((kind,threshold))
     if m:thresholds.append({'threshold':threshold,'probability':round(float(predict_event(m,[{'x':x}])[0]),6)})
    # Separate classifiers can cross; withhold incoherent curves rather than silently repair them.
    if any(b['probability']>a['probability'] for a,b in zip(thresholds,thresholds[1:])):thresholds=[]
    output.append({'game_id':gid,'player_id':player['player_id'],'team':team,'opponent':opp,'kickoff':kickoff(g),'kind':kind,'usage_field':USAGE[kind], 'usage':0 if out else round(float(predict_regression(model,[{'x':x}])[0]),1) if model else None,'usage_status':'reported_out' if out else 'conditional_model' if model else 'baseline_not_beaten','baseline_usage':x['recent_usage'],'thresholds':[] if out else thresholds,'role_adjustment':'Unavailable: historical pregame starter/injury evidence has not been validated.'})
 report={'schema_version':1,'season':slate['season'],'week':slate['week'],'generated_at':now,'version':'player-extensions:'+hashlib.sha256(Path(__file__).read_bytes()).hexdigest()[:16],'policy':'Experimental conditional-on-appearing estimates. Fit through 2023; calibrate 2024; evaluate 2025. Development gates, not independent prospective validation. No heuristic injury penalties or inferred participation probabilities. Original forecasts unchanged. Threshold means yards >= target; unsupported targets unavailable.','validation':validation,'players':output}
 write_json(ROOT/'frontend/public/player_extensions.json',report)
 print(json.dumps({'players':len(output),'validation':validation},indent=2))

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--cache',type=Path,default=ROOT/'data/raw/research');args=parser.parse_args();run(args.cache)
