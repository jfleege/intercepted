"""Observe published forecasts without rewriting them; export changes and operational/model review signals."""
import argparse
import hashlib
import json
import math
import os
from collections import defaultdict
from statistics import mean
from pathlib import Path
from src.ml.refresh_performance import ROOT, stamp, utcnow, write_json, kickoff
from src.features.player_context import build_context, within, finite

POLICY={'win_pp':10,'td_pp':15,'yards_relative':.25,'yards_absolute':15,'points':7,
        'calibration_gap':.10,'minimum':{'winners':100,'touchdowns':500},'windows':2,
        'label':'Provisional review thresholds, not significance tests or automatic retraining rules.', 'automatic_retraining':False}


def read(path):
    try:
        value=json.loads(path.read_text())
        return value if isinstance(value,dict) else {}
    except FileNotFoundError: return {}


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,allow_nan=False).encode()).hexdigest()


def capture(predictions,research,contexts):
    output={};current={(c['game_id'],c['player_id']):c for c in contexts}
    matching=(research.get('season'),research.get('week'))==(predictions['season'],predictions['week'])
    for g in predictions['games']:
        gid=g['game_id'];r=research.get('games',{}).get(gid,{}) if matching else {}
        if r and (r.get('scoring',{}).get('home',{}).get('team')!=g['home_team'] or r.get('scoring',{}).get('away',{}).get('team')!=g['away_team']): r={}
        start=r.get('kickoff') or g.get('kickoff') or kickoff(g)
        items={}
        for k,v in g.items():
            if k.startswith('home_win_prob_') and finite(v) and 0<=v<=1:
                items[k]={'value':v,'label':k.replace('home_win_prob_','')+' home win','unit':'probability','at':g.get('generated_at',predictions.get('generated_at'))}
        for side in ('home','away'):
            sel=g.get(f'{side}_qb_selection',{})
            items[f'{side}_qb']={'value':g.get(f'{side}_projected_qb_id'),'display':g.get(f'{side}_projected_qb_name'),
                               'label':g[f'{side}_team']+' projected QB','unit':'identity','at':sel.get('observed_at'),'source':sel.get('source')}
            items[f'{side}_qb_status']={'value':sel.get('status'),'label':g[f'{side}_team']+' QB confirmation','unit':'status','at':sel.get('observed_at'),'source':sel.get('source')}
        if r:
            items['research_model_version']={'value':r.get('model_version'),'label':'Research model version','unit':'version','at':r.get('generated_at')}
            for side in ('home','away'):
                value=r.get('scoring',{}).get(side,{}).get('expected_points')
                if finite(value): items[f'{side}_points']={'value':value,'label':g[f'{side}_team']+' projected points','unit':'points','at':r.get('generated_at'),'version':r.get('model_version')}
            for p in r.get('players',[]):
                if p.get('team') not in (g['home_team'],g['away_team']):continue
                for field,unit in [('expected_yards','yards'),('anytime_td_probability','probability'),('passing_td_probability','probability')]:
                    v=p.get(field)
                    if finite(v) and (unit!='probability' or 0<=v<=1):
                        items[f'{p["player_id"]}:{field}']={'value':v,'label':p['name']+' · '+field.replace('_',' '),'unit':unit,'player_id':p['player_id'],'at':r.get('generated_at'),'version':r.get('model_version')}
        for (game,pid),c in current.items():
            if game!=gid:continue
            a=c['availability'];s=c['starter'];u=c['usage']
            items[f'{pid}:availability']={'value':a['status'],'label':c['name']+' game status','unit':'status','player_id':pid,'at':a.get('observed_at'),'source':a['source']}
            items[f'{pid}:practice']={'value':a.get('practice'),'label':c['name']+' practice','unit':'status','player_id':pid,'at':a.get('observed_at')}
            items[f'{pid}:starter']={'value':s['status'],'label':c['name']+' depth / starter status','unit':'status','player_id':pid,'at':s.get('updated_at'),'source':s['source']}
            if finite(u.get('estimate')): items[f'{pid}:usage']={'value':u['estimate'],'label':c['name']+' expected '+u['field'],'unit':'opportunities','player_id':pid,'version':u['version']}
        output[gid]={'game_id':gid,'season':predictions['season'],'week':predictions['week'],'away_team':g['away_team'],'home_team':g['home_team'],'kickoff':start,
                     'values':items,'research_version':r.get('model_version'),'input_fingerprint':research.get('input_fingerprint') if r else None,
                     'qb_ids':[g.get(f'{s}_projected_qb_id') for s in ('away','home')]}
    return output


def observe(current,state,now):
    """A first observation is a baseline, not a reconstructed past revision. Post-kickoff observations never change it."""
    old=state.get('games',{});events=list(state.get('events',[]));updated=dict(old)
    started=state.get('tracking_started_at',now)
    for gid,g in current.items():
        if not g.get('kickoff') or stamp(now)>=stamp(g['kickoff']):continue
        prior=old.get(gid)
        if prior and (prior['season'],prior['week'],prior['home_team'],prior['away_team'],prior['kickoff']) != (g['season'],g['week'],g['home_team'],g['away_team'],g['kickoff']):
            # Changed event identity/time requires a fresh baseline; never compare different contracts.
            prior=None
        if prior:
            for key in sorted(set(prior['values'])|set(g['values'])):
                before=prior['values'].get(key);after=g['values'].get(key)
                if before and after and before.get('value')==after.get('value'):continue
                # Do not mistake a merely missing/stale optional input for a changed numeric prediction.
                if not before or not after:continue
                reasons=[]
                if prior.get('qb_ids')!=g.get('qb_ids'):reasons.append('Projected quarterback identity changed in the saved slate.')
                if key=='research_model_version' or before.get('version')!=after.get('version'):reasons.append('Saved model version changed.')
                if key.endswith((':availability',':practice',':starter')):reasons.append('Source-backed availability/depth evidence changed; no causal adjustment to yardage is assumed.')
                if not reasons and prior.get('input_fingerprint')!=g.get('input_fingerprint'):reasons.append('Saved research input fingerprint changed; individual cause is not attributed.')
                if not reasons:reasons.append('Saved value changed; no cause was provided by the source.')
                delta=after['value']-before['value'] if finite(before.get('value')) and finite(after.get('value')) else None
                event={'game_id':gid,'season':g['season'],'week':g['week'],'matchup':f'{g["away_team"]} @ {g["home_team"]}',
                       'field':key,'label':after['label'],'player_id':after.get('player_id'),'unit':after['unit'],
                       'before':before.get('display',before['value']),'after':after.get('display',after['value']),'delta':delta,
                       'previous_observed_at':prior['observed_at'],'observed_at':now,'source_at':after.get('at'),'source':after.get('source'),'reasons':reasons}
                event['id']=digest(event)[:24];events.append(event)
        updated[gid]={**g,'observed_at':now}
    return {'schema_version':1,'tracking_started_at':started,'last_observed_at':now,'games':updated,'events':events}


def calibration_watch(rows):
    grouped=defaultdict(list)
    for r in rows:
        if r.get('status')=='graded' and r.get('family') in ('winners','touchdowns') and finite(r.get('prediction')) and 0<=r['prediction']<=1 and r.get('actual') in (0,1) and r.get('version'):
            grouped[(r['target'],r['version'],r['family'])].append(r)
    output=[]
    for (target,version,family),rs in sorted(grouped.items()):
        gate=POLICY['minimum'][family];buckets=defaultdict(list)
        # Collapse duplicate evidence; each subject/game/target contributes once, conflicting rows fail.
        unique={}
        for r in rs:
            key=(r['game_id'],'home' if family=='winners' else r.get('subject'))
            if key in unique and (unique[key]['prediction'],unique[key]['actual'])!=(r['prediction'],r['actual']):raise ValueError('Conflicting calibration observations')
            unique[key]=r
        for r in unique.values():buckets[(r.get('kickoff') or r['date'],r['game_id'])].append(r)
        windows=[];pending=[]
        for key in sorted(buckets,reverse=True):
            pending.extend(buckets[key])
            if len(pending)>=gate:
                bins=defaultdict(list)
                for r in pending:bins[min(9,int(r['prediction']*10))].append(r)
                predicted=mean(r['prediction'] for r in pending);actual=mean(r['actual'] for r in pending)
                windows.append({'samples':len(pending),'predicted':predicted,'observed':actual,'gap':predicted-actual,
                                'ece':sum(len(b)/len(pending)*abs(mean(r['prediction']-r['actual'] for r in b)) for b in bins.values()),
                                'start':min(r['date'] for r in pending),'end':max(r['date'] for r in pending)})
                pending=[]
                if len(windows)==2:break
        bad=[abs(w['gap'])>=POLICY['calibration_gap'] and w['ece']>=POLICY['calibration_gap'] for w in windows]
        status='review' if len(bad)==2 and all(bad) else 'watch' if bad and bad[0] else 'monitoring' if len(windows)==2 else 'sample_building'
        output.append({'target':target,'version':version,'family':family,'samples':len(unique),'minimum':gate,'windows':windows,'status':status})
    return output


def monitor(predictions,research,directory,contexts,events,performance,sources,now):
    alerts=[]
    def alert(key,severity,message,**extra):alerts.append({'id':key,'severity':severity,'message':message,**extra})
    for name,payload in [('research',research),('directory',directory)]:
        if (payload.get('season'),payload.get('week'))!=(predictions['season'],predictions['week']):alert(name,'review',f'{name.title()} export does not match the active slate.')
    if directory and not within(directory.get('exported_at'),now,30):alert('directory_age','watch','Player history export is more than 30 hours old or has an invalid/future timestamp.')
    for g in predictions['games']:
        for k,v in g.items():
            if k.startswith('home_win_prob_') and (not finite(v) or not 0<=v<=1):alert(f'{g["game_id"]}:{k}','review','Winner probability is missing, nonfinite, or outside 0–1.',game_id=g['game_id'])
        r=research.get('games',{}).get(g['game_id']);start=r.get('kickoff') if r else None
        generated=g.get('generated_at',predictions.get('generated_at'))
        if generated and stamp(generated)>stamp(now):alert('future:'+g['game_id'],'review','Winner forecast generation time is in the future.',game_id=g['game_id'])
        if r and (r.get('scoring',{}).get('home',{}).get('team')!=g['home_team'] or r.get('scoring',{}).get('away',{}).get('team')!=g['away_team']): r=None
        if not r:alert('missing:'+g['game_id'],'watch','No matching research projection is published for this game.',game_id=g['game_id'])
        elif research.get('features_through_week')!=predictions['week']-1:alert('cutoff:'+g['game_id'],'review','Research feature cutoff does not match the prior week.',game_id=g['game_id'])
        if start and stamp(now)<stamp(start) and r:
            ids=[p['player_id'] for p in r.get('players',[])]
            if len(ids)!=len(set(ids)):alert('duplicate:'+g['game_id'],'review','Duplicate player identity in the research export.',game_id=g['game_id'])
            if stamp(r['generated_at'])>stamp(now):alert('future_research:'+g['game_id'],'review','Research forecast generation time is in the future.',game_id=g['game_id'])
            for p in r.get('players',[]):
                for field in ('anytime_td_probability','passing_td_probability'):
                    if field in p and (not finite(p[field]) or not 0<=p[field]<=1):alert('invalid:'+p['player_id']+':'+field,'review','Touchdown probability is nonfinite or outside 0–1.',game_id=g['game_id'])
                if p.get('status')=='available' and not finite(p.get('expected_yards')):alert('invalid:'+p['player_id'],'review','A modeled player has no finite yardage estimate.',game_id=g['game_id'])
    for g in predictions['games']:
        group=[c for c in contexts if c['game_id']==g['game_id'] and c.get('kickoff') and stamp(now)<stamp(c['kickoff'])]
        for side in ('home','away'):
            team=g[f'{side}_team'];qbs={c['player_id'] for c in group if c['team']==team and c['position']=='QB' and c['starter']['status']=='listed_first_unit' and within(c['starter'].get('updated_at'),now)}
            if len(qbs)==1 and g.get(f'{side}_projected_qb_id') not in qbs:
                name=next(c['name'] for c in group if c['player_id'] in qbs)
                alert('qb_depth:'+g['game_id']+':'+team,'watch',f'{team}: published QB {g.get(f"{side}_projected_qb_name","unknown")} differs from first-unit depth listing {name}. A depth chart is not a game-day confirmation; review before revising.',game_id=g['game_id'])
        for c in group:
            if c['availability']['blocked'] and within(c['availability'].get('observed_at'),now):alert('reported_out:'+g['game_id']+':'+c['player_id'],'watch',f'{c["name"]} is reported out. Saved projections remain conditional; current recommendations exclude this player.',game_id=g['game_id'])
    for name,s in sources.items():
        if s.get('status')!='available':alert('source:'+name,'watch',f'{name.replace("_"," ").title()} source unavailable; availability is not inferred.')
        elif not within(s.get('observed_at'),now):alert('source_age:'+name,'watch',f'{name.replace("_"," ").title()} source observation is stale; current availability cannot be inferred.')
    available=sum(within(c['availability'].get('observed_at'),now) and c.get('kickoff') is not None and stamp(now)<stamp(c['kickoff']) for c in contexts)
    alert('availability_coverage','info',f'{available} of {len(contexts)} tracked player/game identities have a unique current-week pregame injury/practice row. Missing rows do not mean healthy.')
    for e in events:
        d=e.get('delta');a=e.get('after');b=e.get('before');large=False
        if finite(d):
            large=abs(d)>=POLICY['points'] if e['unit']=='points' else abs(d)>=POLICY['yards_absolute'] and abs(d)/max(1,abs(b))>=POLICY['yards_relative'] if e['unit']=='yards' and finite(b) else abs(d)>=POLICY['win_pp']/100 if e['field'].startswith('home_win_prob_') else abs(d)>=POLICY['td_pp']/100 if e['unit']=='probability' else abs(d)>=3 and abs(d)/max(1,abs(b))>=.4 if e['unit']=='opportunities' and finite(b) else False
        if large:alert('swing:'+e['id'],'watch','Unusual saved projection change. Review inputs and model version before relying on it.',game_id=e['game_id'],event_id=e['id'])
    for name,outcome in json.loads(os.environ.get('FORECAST_INPUT_OUTCOMES','{}')).items():
        if outcome in ('failure','cancelled'): alert('pipeline:'+name,'review',f'{name} input refresh failed; older data may have been retained.')
    if not performance.get('datasets',{}).get('verified'): alert('results_missing','watch','Verified model results are unavailable; no calibration health verdict is possible.')
    elif not within(performance.get('updated_at'),now,30): alert('results_age','watch','Model performance export is more than 30 hours old or has an invalid/future timestamp.')
    cal=calibration_watch(performance.get('datasets',{}).get('verified',{}).get('rows',[]))
    for c in cal:
        if c['status'] in ('watch','review'):alert('cal:'+c['target']+':'+c['version'],c['status'],'Probability calibration gap crossed the provisional review threshold.',target=c['target'],version=c['version'])
    for g in performance.get('datasets',{}).get('verified',{}).get('groups',[]):
        if g.get('version')!='all' and g.get('health',{}).get('status') in ('watch','review'):
            alert('error:'+g['target']+':'+g['version'],g['health']['status'],g['health']['reason'],target=g['target'],version=g['version'])
    return {'alerts':alerts,'calibration':cal,'policy':POLICY,'availability_coverage':{'reported':available,'tracked':len(contexts)},
            'checked_at':now,'automatic_retraining':False}


def source_tables(season,now):
    import nflreadpy as nfl
    sources={};tables={}
    for name,loader in [('injuries',nfl.load_injuries),('depth_charts',nfl.load_depth_charts)]:
        try:
            table=loader(season)
            # Keep only the latest pre-observation depth snapshot per team, not an arbitrary tail row.
            if name=='depth_charts' and 'dt' in table.columns:
                import polars as pl
                table=table.filter(pl.col('dt')<=now).with_columns(pl.col('dt').max().over('team').alias('_latest')).filter(pl.col('dt')==pl.col('_latest')).drop('_latest')
            tables[name]=table.to_dicts();sources[name]={'status':'available','observed_at':now,'rows':len(tables[name]),'latest_report_at':None if name=='injuries' else max((r['dt'] for r in tables[name]),default=None)}
        except Exception as error:
            tables[name]=[];sources[name]={'status':'unavailable','observed_at':now,'rows':0,'error':type(error).__name__}
    return tables,sources


def export(root=ROOT,now=None,fetch_sources=True):
    now=now or utcnow();public=root/'frontend/public';predictions=read(public/'predictions.json');research=read(public/'matchup_research.json');directory=read(public/'player_intelligence.json');performance=read(public/'research_performance.json')
    state_path=root/f'data/tracking/forecast_insights/{predictions["season"]}-week-{predictions["week"]}.json';state=read(state_path)
    if fetch_sources:tables,sources=source_tables(predictions['season'],now)
    else:
        previous=read(public/'forecast_insights.json');sources=previous.get('sources',{});tables={}
    if fetch_sources:
        contexts,validation=build_context(predictions,directory,research,tables.get('injuries',[]),tables.get('depth_charts',[]),sources,now)
    else:
        # Results-only checks retain only matching contexts; client time guards prevent stale eligibility decisions.
        contexts=previous.get('players',[]) if (previous.get('season'),previous.get('week'))==(predictions['season'],predictions['week']) else []
        validation=previous.get('usage_validation',[])
    current=capture(predictions,research,contexts);new_state=observe(current,state,now)
    events=[e for e in new_state['events'] if (e['season'],e['week'])==(predictions['season'],predictions['week'])]
    report={'schema_version':1,'season':predictions['season'],'week':predictions['week'],'exported_at':now,'sources':sources,'players':contexts,
            'tracking_started_at':new_state['tracking_started_at'],'changes':list(reversed(events)),
            'usage_validation':validation,'monitoring':monitor(predictions,research,directory,contexts,events,performance,sources,now),
            'policy':'Source-backed context and conditional usage baselines. Original yardage/TD/winner forecasts and grading archives are unchanged. First observation establishes a baseline; no older revisions are fabricated.'}
    # Validate before either write; changes never overwrite the original forecasts or grading evidence.
    digest(report);write_json(state_path,new_state);write_json(public/'forecast_insights.json',report)
    for group in report['monitoring']['alerts']:
        if group['severity'] in ('watch','review'):print('::warning::'+group['message'])
    summary=os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary,'a') as f:
            f.write('\n### Forecast monitoring\n\n'+f'{len(events)} tracked changes; {len(contexts)} player/game contexts. Automatic retraining is disabled.\n\n')
            for a in report['monitoring']['alerts']:f.write(f'- **{a["severity"]}**: {a["message"]}\n')
    print(f'Exported {len(contexts)} contexts, {len(events)} changes, {len(report["monitoring"]["alerts"])} monitoring signals.')
    return report


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--results-only',action='store_true');args=parser.parse_args();export(fetch_sources=not args.results_only)

if __name__=='__main__':main()
