"""Publish kickoff times and U.S. broadcast listings for the active forecast slate."""
import json
from urllib.request import urlopen
from src.ml.refresh_performance import ROOT, ALIASES, stamp, utcnow, write_json


def build_schedule(predictions, scoreboard, now):
    season, week = predictions['season'], predictions['week']
    if scoreboard.get('season', {}).get('year') != season or scoreboard.get('season', {}).get('type') != 2 \
            or scoreboard.get('week', {}).get('number') != week:
        raise ValueError('Scoreboard does not match the active regular-season week')
    events = {}
    for event in scoreboard.get('events', []):
        competitions = event.get('competitions', [])
        if len(competitions) != 1:
            continue
        competition = competitions[0]
        teams = {row.get('homeAway'): ALIASES.get(row.get('team', {}).get('abbreviation'), row.get('team', {}).get('abbreviation'))
                 for row in competition.get('competitors', [])}
        if not teams.get('home') or not teams.get('away'):
            continue
        try:
            start = stamp(event['date']).isoformat()
        except (KeyError, ValueError, TypeError):
            continue
        geo = competition.get('geoBroadcasts', [])
        if geo:
            networks = [row.get('media', {}).get('shortName') for row in geo
                        if row.get('region') == 'us' and row.get('lang') == 'en'
                        and row.get('type', {}).get('shortName') in ('TV', 'Streaming')]
        else:
            networks = [name for row in competition.get('broadcasts', [])
                        if row.get('market') == 'national' for name in row.get('names', [])]
        record = {'home_team': teams['home'], 'away_team': teams['away'], 'kickoff': start,
                  'networks': list(dict.fromkeys(name for name in networks if isinstance(name, str) and name.strip())),
                  'event_id': event.get('id')}
        key = (teams['home'], teams['away'])
        if key in events:
            raise ValueError('Ambiguous scoreboard matchup')
        events[key] = record
    games = {game['game_id']: events[(game['home_team'], game['away_team'])] for game in predictions['games']
             if (game['home_team'], game['away_team']) in events}
    if not games:
        raise ValueError('No active matchups have verified schedule information')
    return {'schema_version': 1, 'season': season, 'week': week, 'exported_at': now,
            'source': f'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates={season}&seasontype=2&week={week}',
            'broadcast_region': 'US', 'broadcast_note': 'U.S. listings. Regional availability and subscription requirements vary.', 'games': games}


def main():
    predictions = json.loads((ROOT / 'frontend/public/predictions.json').read_text())
    season, week = predictions['season'], predictions['week']
    url = f'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates={season}&seasontype=2&week={week}'
    with urlopen(url, timeout=25) as response:
        scoreboard = json.load(response)
    result = build_schedule(predictions, scoreboard, utcnow())
    write_json(ROOT / 'frontend/public/game_schedule.json', result)
    print(f"Exported kickoff and broadcast listings for {len(result['games'])} matchups.")


if __name__ == '__main__':
    main()
