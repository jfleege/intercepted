"""Grade original pregame research snapshots; monitor errors without retraining."""
import json
import math
import subprocess
from collections import defaultdict
from statistics import mean
from src.ml.refresh_performance import ROOT, stamp, digest, git, write_json, utcnow, kickoff, normalize_result
from src.ml.projection_features import team_name, num

POLICY = {'label': 'Provisional review heuristic, not a statistical significance test', 'relative_error': .10,
          'minimum': {'winners': 100, 'scoring': 100, 'yardage': 300, 'touchdowns': 500},
          'windows': 2, 'automatic_retraining': False}


def finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def evidence(path, content, observations, now, root=ROOT):
    """Import a tracked snapshot's first commit time; otherwise observe it now."""
    identity = digest(content)
    if identity not in observations:
        rel = str(path.relative_to(root))
        # A changed working file cannot borrow an older commit's timestamp.
        timestamp = None
        try:
            committed = git('show', f'HEAD:{rel}', root=root)
            if committed and digest(json.loads(committed)) == identity:
                timestamp = git('log', '--diff-filter=A', '--format=%cI', '--reverse', '--', rel, root=root).splitlines()[0]
        except (ValueError, IndexError, subprocess.CalledProcessError):
            pass
        observations[identity] = {'observed_at': timestamp or now, 'source': 'git_first_commit' if timestamp else 'refresh_observation', 'path': rel}
    return identity, observations[identity]


def eligible(payload, game, observed):
    try:
        version = payload['model_versions'][game['model_version']]
        target = (payload['season'], payload['week'])
        if any(tuple(m['training_cutoff']) >= target or tuple(m['calibration_cutoff']) >= target
               or tuple(m['training_cutoff']) >= tuple(m['calibration_cutoff']) for m in version['models'].values()):
            return False, 'Model cutoffs do not precede forecast week'
        generated, created, saved, start = map(stamp, [game['generated_at'], version['created_at'], observed['observed_at'], game['kickoff']])
        if created > generated or generated > saved:
            return False, 'Generation/model time is after saved evidence'
        if saved >= start:
            return False, 'First saved evidence was after kickoff'
        return True, 'Pregame evidence and model cutoffs verified'
    except (KeyError, ValueError, TypeError):
        return False, 'Incomplete model or timestamp evidence'


def extract(payload, identity, observed, schedules):
    records=[]
    for game_id, game in payload.get('games', {}).items():
        valid, reason = eligible(payload, game, observed)
        source = schedules.get(game_id)
        if not source:
            raise ValueError(f'Missing schedule for research snapshot {game_id}')
        if (source['season'], source['week']) != (payload['season'], payload['week']):
            raise ValueError('Research slate does not match schedule')
        if not kickoff(source) or stamp(kickoff(source)) != stamp(game['kickoff']):
            valid,reason=False,'Saved and current schedule kickoff differ'
        home,away=team_name(source['home_team']),team_name(source['away_team'])
        score=game.get('scoring',{})
        if score.get('home',{}).get('team') != home or score.get('away',{}).get('team') != away:
            raise ValueError(f'Research team mismatch {game_id}')
        common={'game_id':game_id,'season':payload['season'],'week':payload['week'],'date':str(source['gameday'])[:10],
                'home_team':home,'away_team':away,'kickoff':game['kickoff'],'version':game['model_version'],
                'saved_at':observed['observed_at'],'generated_at':game['generated_at'],'snapshot_id':identity,
                'eligibility':'verified' if valid else 'retrospective','eligibility_reason':reason}
        def add(family,target,subject,label,prediction,interval=None,baseline=None,**extra):
            records.append({**common,'family':family,'target':target,'subject':subject,'label':label,
                            'prediction':prediction if finite(prediction) else None,
                            'range':interval if interval and len(interval)==2 and all(finite(v) for v in interval) and interval[0]<=interval[1] else None,
                            'baseline':baseline if finite(baseline) else None,**extra})
        for side in ['away','home']:
            row=score.get(side,{})
            add('scoring','team_points',side,f'{row.get("team",side)} points',row.get('expected_points'),row.get('range_80'),row.get('baseline_points'))
        add('scoring','total','game',f'{away} @ {home} total',score.get('total'),score.get('total_range_80'),score.get('baseline_total'))
        add('scoring','margin','game',f'{home} margin',score.get('home_margin'),score.get('margin_range_80'),score.get('baseline_home_margin'))
        for player in game.get('players',[]):
            team=player.get('team');opponent=home if team==away else away if team==home else None
            if opponent is None or player.get('opponent')!=opponent:
                raise ValueError(f'Player team/opponent mismatch {game_id}')
            available=player.get('status')=='available'
            extra={'player_id':player['player_id'],'team':team,'position':player.get('position'), 'headshot':player.get('headshot')}
            kind=player.get('stat') or {'QB':'passing','RB':'rushing','WR':'receiving','TE':'receiving'}.get(player.get('position'))
            if kind not in ('passing','rushing','receiving'):continue
            add('yardage',kind,player['player_id'],player['name'],player.get('expected_yards') if available else None,player.get('range_80'),player.get('recent_yards'),**extra)
            for target,key,baseline_key in [('any_td','anytime_td_probability','baseline_anytime_td_probability'),('pass_td','passing_td_probability','baseline_passing_td_probability')]:
                if target=='pass_td' and player.get('position')!='QB':continue
                p=player.get(key)
                add('touchdowns',target,player['player_id'],player['name'],p if available and finite(p) and 0<=p<=1 else None,baseline=player.get(baseline_key),**extra)
    return records


def choose(records):
    frozen={}
    for r in sorted(records,key=lambda r:(stamp(r['saved_at']),r['snapshot_id'])):
        key=(r['game_id'],r['family'],r['target'],r['subject'])
        if key not in frozen or (frozen[key]['eligibility']!='verified' and r['eligibility']=='verified'):
            frozen[key]=r
    return list(frozen.values())


def grade(records, schedules, player_rows, now):
    indexed=defaultdict(list)
    for row in player_rows:
        if row.get('season_type','REG')!='REG':continue
        team=team_name(row.get('team',row.get('recent_team')))
        indexed[(row['season'],row['week'],team,row.get('player_id'))].append(row)
    output=[]
    for frozen in records:
        r={**frozen,'actual':None,'error':None,'loss':None,'baseline_loss':None,'inside_range':None,'status':'pending'}
        source=schedules[r['game_id']];result=normalize_result(source,now)
        if r['prediction'] is None:r['status']='unavailable'
        elif result['status']=='cancelled':r['status']='cancelled'
        elif result['status']=='final':
            if r['family']=='scoring':
                h,a=source['home_score'],source['away_score']
                r['actual']=h+a if r['target']=='total' else h-a if r['target']=='margin' else source[f'{r["subject"]}_score']
            else:
                matches=indexed.get((r['season'],r['week'],r['team'],r['player_id']),[])
                if len(matches)>1:raise ValueError('Duplicate player team/week stats')
                stats=matches[0] if matches else {}
                if r['family']=='yardage':r['actual']=stats.get(f'{r["target"]}_yards')
                elif r['target']=='pass_td':
                    v=stats.get('passing_tds');r['actual']=int(v>0) if finite(v) else None
                else:
                    rush,receive=stats.get('rushing_tds'),stats.get('receiving_tds')
                    r['actual']=int(rush+receive>0) if finite(rush) and finite(receive) else None
                if not finite(r['actual']):r['actual']=None;r['status']='missing_stats'
            if r['actual'] is not None:
                r['status']='graded';r['error']=r['actual']-r['prediction']
                event=r['family']=='touchdowns'
                r['loss']=r['error']**2 if event else abs(r['error'])
                if r['baseline'] is not None and (not event or 0<=r['baseline']<=1):
                    r['baseline_loss']=(r['actual']-r['baseline'])**2 if event else abs(r['actual']-r['baseline'])
                if r['range'] is not None:r['inside_range']=r['range'][0]<=r['actual']<=r['range'][1]
        output.append(r)
    return output


def reliability(rows):
    bins=[]
    for i in range(10):
        subset=[r for r in rows if min(9,int(r['prediction']*10))==i]
        if not subset:continue
        n=len(subset);p=mean(r['actual'] for r in subset);z=1.96;den=1+z*z/n
        center=(p+z*z/(2*n))/den;radius=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den
        bins.append({'bin':f'{i*10}–{(i+1)*10}%','samples':n,'predicted':mean(r['prediction'] for r in subset),'observed':p,'lower':max(0,center-radius),'upper':min(1,center+radius)})
    return bins


def health(rows, family, mixed=False):
    gate=POLICY['minimum'][family]
    units=lambda rs:len({r['game_id'] for r in rs}) if family in ('winners','scoring') else len(rs)
    base={'minimum':gate,'unit':'games' if family in ('winners','scoring') else 'appearances','samples':units(rows),'windows':[]}
    if mixed:return {**base,'status':'version_required','reason':'Choose one model version for health assessment.'}
    buckets=defaultdict(list)
    for r in rows:buckets[(r.get('kickoff') or r['date'],r['game_id'])].append(r)
    windows=[];pending=[]
    for key in sorted(buckets,reverse=True):
        pending+=buckets[key]
        if units(pending)>=gate:
            windows.append(pending);pending=[]
            if len(windows)==2:break
    if not windows:return {**base,'status':'sample_building','reason':f'Need {gate} graded {base["unit"]} per non-overlapping window.'}
    for window in windows:
        paired=[r for r in window if r.get('baseline_loss') is not None]
        if units(paired)<gate:
            return {**base,'status':'baseline_unavailable','reason':'Not enough paired pregame baseline estimates. Older missing baselines are not reconstructed.'}
        model,reference=mean(r['loss'] for r in paired),mean(r['baseline_loss'] for r in paired)
        base['windows'].append({'samples':units(paired),'model_error':model,'baseline_error':reference,'relative_error':model/reference-1 if reference>0 else None,
                                'start':min(r['date'] for r in paired),'end':max(r['date'] for r in paired)})
    bad=[w['model_error']>0 and w['model_error']>=w['baseline_error']*(1+POLICY['relative_error']) for w in base['windows']]
    if len(bad)==2 and all(bad):status,reason='review','Error exceeds baseline by at least 10% in two separate windows. Investigate before changing models.'
    elif base['windows'][0]['model_error']>base['windows'][0]['baseline_error']:status,reason='watch','Latest completed window is worse than its paired baseline.'
    elif len(windows)<2:status,reason='sample_building','First window is complete; waiting for a second independent window.'
    else:status,reason='monitoring','No error-based review flag in the latest two windows.'
    return {**base,'status':status,'reason':reason}


def summarize(rows, family, version):
    graded=sorted([r for r in rows if r['status']=='graded'],key=lambda r:(r.get('kickoff') or r['date'],r['game_id'],r['subject']))
    paired=[r for r in graded if r.get('baseline_loss') is not None]
    ranges=[r for r in graded if r.get('inside_range') is not None]
    versions=sorted({r['version'] for r in rows})
    avg=lambda rs,k:mean(r[k] for r in rs) if rs else None
    trend=[];loss=0
    for i,r in enumerate(graded):
        loss+=r['loss'];trend.append({'n':i+1,'label':r['label'],'date':r['date'],'loss':loss/(i+1),'prediction':r['prediction'],'actual':r['actual']})
    return {'family':family,'target':rows[0]['target'],'version':version,'versions':versions,'samples':len(graded),'games':len({r['game_id'] for r in graded}),
            'counts':{state:sum(r['status']==state for r in rows) for state in ['pending','missing_stats','unavailable','cancelled']},
            'error':avg(graded,'loss'),'baseline_error':avg(paired,'baseline_loss'),'paired_error':avg(paired,'loss'),'baseline_samples':len(paired),
            'rmse':math.sqrt(mean(r['error']**2 for r in graded)) if graded else None,
            'log_loss':mean(-(r['actual']*math.log(min(1-1e-15,max(1e-15,r['prediction'])))+(1-r['actual'])*math.log(1-min(1-1e-15,max(1e-15,r['prediction'])))) for r in graded) if graded and family in ('winners','touchdowns') else None,
            'bias':avg(graded,'error'),'coverage':avg(ranges,'inside_range'),'range_samples':len(ranges),
            'range_width':mean(r['range'][1]-r['range'][0] for r in ranges) if ranges else None,
            'accuracy':mean((r['prediction']>=.5)==bool(r['actual']) for r in graded) if graded and family=='winners' else None,
            'calibration':reliability(graded) if family in ('touchdowns','winners') else [],'trend':trend,
            'health':health(graded,family,mixed=version=='all' and len(versions)>1)}


def winner_records(payload):
    records=[]
    for dataset,models in payload.get('datasets',{}).items():
        if dataset=='backtest':continue
        for model,group in models.items():
            for r in group['rows']:
                actual=r.get('outcome');status='graded' if actual is not None else r['grade']
                records.append({**r,'family':'winners','target':f'winner:{model}','subject':'game','label':f'{r["away_team"]} @ {r["home_team"]}',
                                'date':r['game_date'],'version':r['model_version'],'prediction':r['probability'],'actual':actual,'error':actual-r['probability'] if actual is not None else None,
                                'loss':r.get('brier'),'baseline':.5,'baseline_loss':.25 if actual is not None else None,'range':None,'inside_range':None,'status':status,
                                'eligibility':'verified' if dataset=='verified' else 'retrospective'})
    return records


def build_export(records, winners, now):
    records=records+winner_records(winners)
    datasets={}
    for name in ['verified','retrospective']:
        selected=[r for r in records if r['eligibility']==name]
        buckets=defaultdict(list)
        for r in selected:
            buckets[(r['family'],r['target'],'all')].append(r)
            buckets[(r['family'],r['target'],r['version'])].append(r)
        summaries=[summarize(rs,family,version) for (family,target,version),rs in buckets.items()]
        if name!='verified':
            for group in summaries:group['health']={**group['health'],'status':'disabled','reason':'Health alerts are disabled for unverified forecasts.'}
        datasets[name]={'rows':sorted(selected,key=lambda r:(r['date'],r['game_id'],r['target'],r['subject'])),
                        'groups':summaries}
    return {'schema_version':1,'updated_at':now,'policy':POLICY,'datasets':datasets,
            'notes':'Original estimates frozen per game and target; revisions regrade outcomes. Player estimates are conditional on appearing. Missing player-stat rows are ungraded, not zero or confirmed inactive. Health windows never pool weight versions.'}


def main():
    import nflreadpy as nfl
    now=utcnow();path=ROOT/'data/tracking/research_evidence.json'
    observed=json.loads(path.read_text()) if path.exists() else {}
    sources=[]
    for p in sorted((ROOT/'data/tracking/research').glob('*.json')):
        content=json.loads(p.read_text());identity,observation=evidence(p,content,observed,now)
        sources.append((content,identity,observation))
    years=sorted({p['season'] for p,_,_ in sources})
    schedule=nfl.load_schedules(years).to_dicts() if years else []
    by_id={r['game_id']:r for r in schedule}
    stats=nfl.load_player_stats(seasons=years,summary_level='week').to_dicts() if years else []
    extracted=[r for p,identity,observation in sources for r in extract(p,identity,observation,by_id)]
    records=grade(choose(extracted),by_id,stats,now)
    winners=json.loads((ROOT/'frontend/public/performance.json').read_text())
    result=build_export(records,winners,now)
    benchmark=ROOT/'docs/research-validation.json'
    result['benchmark']=json.loads(benchmark.read_text()) if benchmark.exists() else None
    # Preserve source observations as evidence; a missing row after it was graded cannot erase a result silently.
    revisions_path=ROOT/'data/tracking/research_results.json'
    history=json.loads(revisions_path.read_text()) if revisions_path.exists() else {'records':{},'revisions':[]}
    for r in records:
        key=digest([r['game_id'],r['family'],r['target'],r['subject']]);previous=history['records'].get(key)
        if previous and previous['eligibility']=='verified' and previous['snapshot_id']!=r['snapshot_id']:
            raise ValueError('First verified research snapshot changed; retaining prior export')
        if previous and previous['status']=='graded' and r['status']!='graded':
            raise ValueError('Previously graded research outcome disappeared; retaining prior export')
        if previous!=r:
            history['revisions'].append({'observed_at':now,'previous':previous,'result':r});history['records'][key]=r
    write_json(path,observed);write_json(revisions_path,history)
    write_json(ROOT/'frontend/public/research_performance.json',result)
    print('Research evaluation:',{name:sum(r['status']=='graded' for r in v['rows']) for name,v in result['datasets'].items()})

if __name__=='__main__':main()
