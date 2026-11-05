"""Check pregame inputs against published forecasts without writing snapshots."""
import os
from zoneinfo import ZoneInfo

from src.features.injury_updates import availability_revision_games
from src.features.qb_starters import changed_report_games, load_reports
from src.ml.forecast_insights import ROOT, load_context, read, stamp, utcnow


def pending_games(predictions, research, now):
    if (predictions['season'], predictions['week']) != (research.get('season'), research.get('week')):
        return []
    pending = []
    for game in predictions['games']:
        start = research.get('games', {}).get(game['game_id'], {}).get('kickoff')
        if not start or stamp(start) <= stamp(now):
            continue
        eastern = stamp(start).astimezone(ZoneInfo('America/New_York'))
        pending.append({**game, 'gameday': eastern.date().isoformat(), 'gametime': eastern.strftime('%H:%M:%S')})
    return pending


def main():
    public = ROOT / 'frontend/public'
    current = read(public / 'predictions.json')
    research = read(public / 'matchup_research.json')
    now = utcnow()
    pending = pending_games(current, research, now)
    changed = []
    if pending:
        directory = read(public / 'player_intelligence.json')
        contexts, _, sources, now = load_context(current, directory, research)
        changed = availability_revision_games(current, pending, contexts, sources, now)
        changed += changed_report_games(current, pending, load_reports(), now)
        unavailable = [name for name, source in sources.items() if source['status'] != 'available']
        if unavailable:
            print(f"::warning::Pregame sources unavailable: {', '.join(unavailable)}")
    print(f'Pregame check: {len(pending)} upcoming games, {len({g["game_id"] for g in changed})} with revisions.')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write(f'refresh={str(bool(changed)).lower()}\n')


if __name__ == '__main__':
    main()
