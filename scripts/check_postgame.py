"""Lightweight final-score signal; the existing nflverse grader remains authoritative."""
import json
import os
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import urlopen
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]
ALIASES={'LAR':'LA','WSH':'WAS','JAC':'JAX'}

def changed_finals(games,events):
    changed=[]
    for event in events:
        if event.get('status',{}).get('type',{}).get('completed') is not True:continue
        competitions=event.get('competitions',[])
        if len(competitions)!=1:continue
        competitors=competitions[0].get('competitors',[])
        sides={r.get('homeAway'):r for r in competitors}
        if len(competitors)!=2 or set(sides)!={'home','away'}:continue
        try:
            teams={s:ALIASES.get(sides[s]['team']['abbreviation'],sides[s]['team']['abbreviation']) for s in sides}
            scores={s:float(sides[s]['score']) for s in sides}
            start=datetime.fromisoformat(event['date'].replace('Z','+00:00'))
            if start.tzinfo is None or not all(math.isfinite(v) and v>=0 and v.is_integer() for v in scores.values()):continue
        except (KeyError,ValueError,TypeError):continue
        matches=[]
        for gid,g in games.items():
            try: saved=datetime.fromisoformat(g['kickoff'].replace('Z','+00:00'))
            except (ValueError,TypeError,KeyError):continue
            if saved.tzinfo is not None and teams['home']==g.get('home_team') and teams['away']==g.get('away_team') and abs((saved-start).total_seconds())<=300:matches.append((gid,g))
        if len(matches)!=1:continue
        gid,g=matches[0]
        if g.get('status')!='final' or any(g.get(s+'_score')!=int(scores[s]) for s in sides):changed.append(gid)
    return sorted(set(changed))

def recent_games(games,now):
    local=now.astimezone(ZoneInfo('America/Chicago'))
    dates={(local-timedelta(days=i)).date().isoformat() for i in (0,1)}
    relevant={}
    for gid,g in games.items():
        try:
            start=datetime.fromisoformat(g['kickoff'].replace('Z','+00:00'))
            if start.tzinfo is not None and start<=now and start.astimezone(ZoneInfo('America/Chicago')).date().isoformat() in dates:relevant[gid]=g
        except (KeyError,ValueError,TypeError):continue
    return relevant

def main():
    now=datetime.now(timezone.utc);local=now.astimezone(ZoneInfo('America/Chicago'))
    dates={(local-timedelta(days=i)).date().isoformat() for i in (0,1)}
    games=json.loads((ROOT/'data/tracking/results.json').read_text()).get('games',{})
    relevant=recent_games(games,now)
    events=[]
    if relevant:
        for date in sorted(dates):
            url='https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates='+date.replace('-','')+'&limit=1000'
            with urlopen(url,timeout=25) as response:payload=json.load(response)
            if not isinstance(payload.get('events'),list):raise ValueError('Scoreboard response has no events list')
            events.extend(payload['events'])
    changed=changed_finals(relevant,events)
    print(f'Postgame check: {len(relevant)} recent archived games; {len(changed)} new/corrected finals.')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'],'a') as output:output.write('refresh='+str(bool(changed)).lower()+'\n')

if __name__=='__main__':main()
