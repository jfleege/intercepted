"""Publish refresh evidence without treating snapshot age as model accuracy."""
import argparse
import json
import os
from datetime import timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from src.ml.refresh_performance import ROOT, stamp, utcnow, write_json

STATUS = Path('frontend/public/refresh_status.json')
CHECK = Path('data/tracking/forecast_refresh_status.json')
SOURCES = (
    ('forecasts', 'Game forecasts', 'predictions.json', 'generated_at'),
    ('players', 'Player cards', 'players_watch.json', 'exported_at'),
    ('directory', 'Player history', 'player_intelligence.json', 'exported_at'),
    ('research', 'Matchup projections', 'matchup_research.json', 'generated_at'),
    ('results', 'Game results', 'performance.json', 'updated_at'),
    ('research_results', 'Projection results', 'research_performance.json', 'updated_at'),
    ('odds', 'Sportsbook lines', 'odds.json', 'exported_at'),
    ('props', 'Player prop quotes', 'player_props.json', 'exported_at'),
)


def read(path):
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (FileNotFoundError, ValueError):
        return {}


def next_weekly_refresh(now):
    current = stamp(now)
    local = current.astimezone(ZoneInfo('America/Chicago'))
    target = (local + timedelta(days=(1 - local.weekday()) % 7)).replace(hour=12, minute=0, second=0, microsecond=0)
    if target <= local:
        target += timedelta(days=7)
    return stamp(target).isoformat()


def next_check(now):
    current = stamp(now)
    morning = current.replace(hour=13, minute=17, second=0, microsecond=0)
    if morning <= current:
        morning += timedelta(days=1)
    return min(morning, stamp(next_weekly_refresh(now))).isoformat()


def forecast_check(current, season, week, state, message, now, root=ROOT):
    write_json(root / CHECK, {
        'checked_at': now, 'state': state, 'message': message,
        'active_season': current['season'], 'active_week': current['week'],
        'target_season': season, 'target_week': week,
    })


def start(mode, now, root=ROOT):
    previous = read(root / STATUS)
    previous['attempt'] = {'started_at': now, 'mode': mode, 'state': 'running'}
    write_json(root / STATUS, previous)


def finish(now, outcomes=None, root=ROOT):
    """Only a completed full pipeline earns a full-refresh success timestamp."""
    previous = read(root / STATUS)
    attempt = previous.get('attempt', {})
    mode = attempt.get('mode', 'snapshot')
    outcomes = outcomes or {}
    required = ('verify', 'results', 'history', 'players', 'research', 'teams', 'directory', 'research_results', 'markets')
    results_required = ('verify', 'results', 'history', 'research_results', 'markets')
    expected = results_required if mode == 'results' else required
    failed = [key for key, value in outcomes.items() if value in ('failure', 'cancelled')]
    complete = mode in ('full', 'results') and all(outcomes.get(key) == 'success' for key in expected)
    state = 'success' if complete and not failed else 'partial' if outcomes else 'unknown'
    attempt.update(completed_at=now, mode=mode, state=state, steps=outcomes)
    if state == 'success':
        previous['last_results_refresh_at' if mode == 'results' else 'last_successful_refresh_at'] = now
    forecasts = read(root / 'frontend/public/predictions.json')
    sources = []
    for key, label, filename, date_field in SOURCES:
        data = read(root / 'frontend/public' / filename)
        source = {'id': key, 'label': label, 'updated_at': data.get(date_field)}
        for field in ('season', 'week', 'features_through_week', 'through_week'):
            if field in data:
                source[field] = data[field]
        if key in outcomes:
            source['refresh_outcome'] = outcomes[key]
        sources.append(source)
    value = {
        'schema_version': 1, 'snapshot_at': now,
        'active_season': forecasts.get('season'), 'active_week': forecasts.get('week'),
        'last_successful_refresh_at': previous.get('last_successful_refresh_at'),
        'last_results_refresh_at': previous.get('last_results_refresh_at'),
        'attempt': attempt, 'forecast_check': read(root / CHECK) or None,
        'next_forecast_check_at': next_check(now),
        'next_weekly_refresh_at': next_weekly_refresh(now), 'sources': sources,
    }
    run_id = os.environ.get('GITHUB_RUN_ID', '')
    if run_id.isdigit():
        value['workflow_url'] = f'https://github.com/jfleege/intercepted/actions/runs/{run_id}'
    write_json(root / STATUS, value)
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['start', 'finish', 'snapshot'])
    parser.add_argument('--mode', choices=['full', 'results'], default='full')
    args = parser.parse_args()
    now = utcnow()
    if args.command == 'start':
        start(args.mode, now)
    else:
        outcomes = json.loads(os.environ.get('REFRESH_OUTCOMES', '{}')) if args.command == 'finish' else {}
        finish(now, outcomes)


if __name__ == '__main__':
    main()
