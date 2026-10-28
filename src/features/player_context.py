"""Game-scoped availability evidence and a transparent conditional opportunity baseline."""
from collections import defaultdict
from statistics import mean
from src.ml.refresh_performance import stamp, kickoff
from src.ml.projection_features import team_name

FIELDS = {'QB': 'attempts', 'RB': 'carries', 'WR': 'targets', 'TE': 'targets'}
VERSION = 'recent-opportunities-mean-v1'
SOURCE = 'https://nflreadr.nflverse.com/reference/load_injuries.html'
DEPTH_SOURCE = 'https://nflreadr.nflverse.com/reference/load_depth_charts.html'
MAX_AGE_HOURS = 48


def finite(v):
    import math
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def within(when, now, hours=MAX_AGE_HOURS):
    try:
        age = (stamp(now) - stamp(when)).total_seconds()
        return 0 <= age <= hours * 3600
    except (ValueError, TypeError, KeyError):
        return False


def usage(history, position, team):
    field = FIELDS.get(position)
    rows = sorted(history, key=lambda h: (h['week'], h['game_id']))
    if not field or len(rows) < 3:
        return {'status': 'insufficient_history', 'field': field, 'estimate': None, 'version': VERSION, 'samples': len(rows)}
    recent = rows[-3:]
    if any(h.get('team') != team or not finite(h.get(field)) or h[field] < 0 for h in recent):
        return {'status': 'insufficient_history', 'field': field, 'estimate': None, 'version': VERSION, 'samples': 0}
    return {'status': 'estimated', 'field': field, 'estimate': round(mean(h[field] for h in recent), 1),
            'recent_average': round(mean(h[field] for h in recent), 2), 'last': recent[-1][field],
            'observed_range': [min(h[field] for h in recent), max(h[field] for h in recent)],
            'samples': 3, 'through_week': recent[-1]['week'], 'version': VERSION,
            'method': 'Unweighted mean of the prior three same-team appearances; conditional on appearing. Not adjusted for injury or a new role. Observed range is not a prediction interval.'}


def usage_validation(players):
    groups = defaultdict(list)
    for p in players:
        history = sorted(p.get('history', []), key=lambda h: (h['week'], h['game_id']))
        field = FIELDS.get(p['position'])
        for i in range(3, len(history)):
            h = history[i]
            if not field or not finite(h.get(field)) or h[field] < 0:
                continue
            forecast = usage(history[:i], p['position'], h['team'])
            if forecast['estimate'] is not None:
                candidate=sum(history[i-j][field]*w for j,w in [(3,.2),(2,.3),(1,.5)])
                groups[field].append((abs(round(candidate,1)-h[field]), abs(forecast['estimate']-h[field])))
    return [{'field': key, 'samples': len(rows), 'mae': round(mean(r[0] for r in rows), 3),
             'baseline_mae': round(mean(r[1] for r in rows), 3), 'version': VERSION, 'active_method':'Unweighted prior-three mean', 'candidate_method':'20% / 30% / 50% recent weighting; not promoted',
             'evaluation': 'Retrospective walk-forward on current-season directory appearances; not a verified live record.'}
            for key,rows in sorted(groups.items())]


def build_context(predictions, directory, research, injuries, depth, sources, now):
    season, week = predictions['season'], predictions['week']
    games = {g['game_id']: g for g in predictions['games']}
    candidates = {}
    if (directory.get('season'), directory.get('week')) == (season, week):
        for p in directory.get('players', []):
            g = games.get(p.get('game_id'))
            if g and p.get('team') in (g['home_team'],g['away_team']):
                history = [h for h in p.get('history',[]) if h['week'] < week and str(h.get('date','')) <= now[:10]]
                if len({h['game_id'] for h in history}) != len(history):
                    raise ValueError('Duplicate appearance in usage history')
                candidates[(g['game_id'],p['player_id'])] = {**p,'history':history}
    if (research.get('season'),research.get('week')) == (season,week):
        for gid,r in research.get('games',{}).items():
            g = games.get(gid)
            if not g or r.get('scoring',{}).get('home',{}).get('team') != g['home_team'] or r.get('scoring',{}).get('away',{}).get('team') != g['away_team']: continue
            for p in r.get('players',[]):
                if p.get('team') not in (g['home_team'],g['away_team']): continue
                key=(gid,p['player_id']);old=candidates.get(key,{})
                candidates[key] = {**old,**p,'game_id':gid,'history':old.get('history',[])}
    injury_map=defaultdict(list)
    for r in injuries:
        if r.get('season')==season and r.get('week')==week and r.get('season_type',r.get('game_type'))=='REG' and r.get('gsis_id'):
            injury_map[(team_name(r.get('team')),r['gsis_id'])].append(r)
    charts=defaultdict(list)
    latest_team={}
    for r in depth:
        try:
            if stamp(r['dt'])<=stamp(now):
                team=team_name(r.get('team'))
                if team not in latest_team or stamp(r['dt'])>stamp(latest_team[team]): latest_team[team]=r['dt']
        except (ValueError,TypeError,KeyError): pass
    for r in depth:
        try:
            if r.get('dt')==latest_team.get(team_name(r.get('team'))) and r.get('gsis_id') and r.get('pos_abb') in FIELDS:
                charts[(team_name(r.get('team')),r['gsis_id'])].append(r)
        except (ValueError,TypeError,KeyError): continue
    output=[]
    for (gid,pid),p in sorted(candidates.items()):
        game=games[gid];team=p['team'];start=game.get('kickoff') or game.get('kickoff_utc') or kickoff(game)
        # Prediction JSON uses game_date rather than schedule gameday; the research provides exact kickoff.
        if not start: start=research.get('games',{}).get(gid,{}).get('kickoff')
        pregame=bool(start and stamp(now)<stamp(start))
        rows=injury_map[(team,pid)]
        src=sources.get('injuries',{})
        usable=pregame and src.get('status')=='available' and within(src.get('observed_at'),now)
        # Ambiguous duplicate rows never become an automatic absence or healthy designation.
        row=rows[0] if len(rows)==1 and usable else {}
        if row.get('date_modified') and not within(row['date_modified'],now): row={}
        status=row.get('report_status')
        availability={'status':status if status in ('Out','Doubtful','Questionable') else 'unknown',
                      'practice':row.get('practice_status'), 'injury':row.get('report_primary_injury') or row.get('practice_primary_injury'),
                      'observed_at':src.get('observed_at') if row else None, 'report_updated_at':row.get('date_modified'),
                      'source':SOURCE, 'reason':'Current-week source row; observation time is not the report update time.' if row else 'No unique, current, pregame injury report row. Availability is unknown.',
                      'blocked':status=='Out' and bool(row)}
        entries=charts[(team,pid)];latest=max((r['dt'] for r in entries),default=None)
        entries=[r for r in entries if r['dt']==latest and r['pos_abb']==p['position']]
        ranks=[r['pos_rank'] for r in entries if finite(r.get('pos_rank')) and r['pos_rank']>=1]
        depth_fresh=pregame and sources.get('depth_charts',{}).get('status')=='available' and latest and within(latest,now) and bool(ranks)
        starter={'status':'listed_first_unit' if depth_fresh and 1 in ranks else 'listed_reserve' if depth_fresh else 'unknown',
                 'rank':int(min(ranks)) if depth_fresh else None, 'updated_at':latest, 'source':DEPTH_SOURCE,
                 'reason':'Depth-chart listing, package dependent; not a game-day starter confirmation.'}
        if p['position']=='QB':
            side='home' if team==game['home_team'] else 'away';sel=game.get(f'{side}_qb_selection',{})
            if sel.get('player_id')==pid and sel.get('status') in ('confirmed','reported_expected') and within(sel.get('observed_at'),now) and pregame:
                starter={'status':sel['status'],'rank':None,'updated_at':sel['observed_at'],'source':sel['source'],'reason':'Game-specific sourced quarterback report.'}
        output.append({'player_id':pid,'game_id':gid,'team':team,'opponent':game['away_team'] if team==game['home_team'] else game['home_team'],
                       'name':p['name'],'position':p['position'],'kickoff':start,'availability':availability,'starter':starter,
                       'usage':usage(p['history'],p['position'],team) if pregame else {'status':'game_started','estimate':None,'field':FIELDS.get(p['position']),'version':VERSION,'samples':0}})
    return output,usage_validation(list(candidates.values()))
