"""Pregame team efficiency and rankings from completed regular-season games."""
from collections import defaultdict
from statistics import mean
from src.ml.projection_features import num, team_name, final_games


def ratio(n, d):
    return round(n / d, 4) if d else None


def aggregate(records):
    def rate(total, count):
        return ratio(sum(r[total] for r in records), sum(r[count] for r in records))
    return {
        'games': len(records), 'off_epa': rate('off_epa_total', 'off_plays'), 'def_epa': rate('def_epa_total', 'def_plays'),
        'pass_off_epa': rate('pass_off_total', 'pass_off_plays'), 'rush_off_epa': rate('rush_off_total', 'rush_off_plays'),
        'pass_def_epa': rate('pass_def_total', 'pass_def_plays'), 'rush_def_epa': rate('rush_def_total', 'rush_def_plays'),
        'success_rate': rate('successes', 'success_plays'), 'third_down_rate': rate('third_converted', 'third_attempts'),
        'redzone_td_rate': rate('redzone_td_drives', 'redzone_drives'),
        'td_drive_rate': rate('td_drives', 'drives'), 'fg_drive_rate': rate('fg_drives', 'drives'),
        'turnovers_per_100': (100 * rate('turnovers', 'off_plays')) if rate('turnovers', 'off_plays') is not None else None,
        'pass_td_per_game': round(mean(r['pass_td'] for r in records), 3),
        'rush_td_per_game': round(mean(r['rush_td'] for r in records), 3),
        'points_per_game': round(mean(r['points'] for r in records), 2),
        'points_allowed_per_game': round(mean(r['allowed'] for r in records), 2),
        'plays_per_game': round(mean(r['off_plays'] for r in records), 2),
    }


def ranks(summaries, metric, reverse):
    values = {t: s[metric] for t, s in summaries.items() if s[metric] is not None}
    return {t: 1 + sum((v > value if reverse else v < value) for v in values.values()) for t, value in values.items()}


def build_team_insights(pbp, schedules, season, week, now):
    games = final_games(schedules, season, week, now)
    games = [g for g in games if g['season'] == season]
    by_id = {g['game_id']: g for g in games}
    groups = defaultdict(list)
    for row in pbp:
        if row.get('game_id') in by_id and row.get('season_type') == 'REG':
            groups[row['game_id']].append(row)
    history, excluded = defaultdict(list), []
    for game in games:
        rows = groups.get(game['game_id'], [])
        # Refuse incomplete PBP; final cumulative scores must match the completed schedule.
        if not rows or any(max((num(r.get(f'total_{side}_score'), -1) for r in rows), default=-1) != game[f'{side}_score'] for side in ['home', 'away']):
            excluded.append(game['game_id'])
            continue
        plays = [r for r in rows if r.get('play_type') in ('pass', 'run') and num(r.get('no_play')) != 1 and num(r.get('epa'), None) is not None]
        if any(not any(team_name(r.get('posteam')) == team_name(game[f'{s}_team']) for r in plays) for s in ('home', 'away')):
            excluded.append(game['game_id'])
            continue
        for side, other in [('home', 'away'), ('away', 'home')]:
            team, opponent = team_name(game[f'{side}_team']), team_name(game[f'{other}_team'])
            own = [r for r in plays if team_name(r.get('posteam')) == team]
            defense = [r for r in plays if team_name(r.get('defteam')) == team]
            record = {'game_id': game['game_id'], 'week': game['week'], 'opponent': opponent, 'points': game[f'{side}_score'], 'allowed': game[f'{other}_score']}
            for prefix, selected in [('off', own), ('def', defense)]:
                record[f'{prefix}_epa_total'] = sum(num(r['epa']) for r in selected)
                record[f'{prefix}_plays'] = len(selected)
                for kind, key in [('pass', 'pass'), ('run', 'rush')]:
                    subset = [r for r in selected if r.get('play_type') == kind]
                    record[f'{key}_{prefix}_total'] = sum(num(r['epa']) for r in subset)
                    record[f'{key}_{prefix}_plays'] = len(subset)
            success = [num(r.get('success'), None) for r in own]
            record.update(successes=sum(v for v in success if v is not None), success_plays=sum(v is not None for v in success),
                          third_converted=sum(num(r.get('third_down_converted')) for r in own),
                          third_attempts=sum(num(r.get('third_down_converted')) + num(r.get('third_down_failed')) for r in own),
                          pass_td=sum(num(r.get('pass_touchdown')) for r in own), rush_td=sum(num(r.get('rush_touchdown')) for r in own),
                          turnovers=sum(int(num(r.get('interception')) == 1 or num(r.get('fumble_lost')) == 1) for r in own))
            drives = defaultdict(list)
            for r in rows:
                if team_name(r.get('posteam')) == team and r.get('fixed_drive') is not None and num(r.get('no_play')) != 1 and r.get('play_type') in ('pass', 'run', 'punt', 'field_goal', 'qb_kneel', 'qb_spike'):
                    drives[r['fixed_drive']].append(r)
            redzone = [d for d in drives.values() if any(num(r.get('yardline_100'), 101) <= 20 for r in d)]
            td = lambda d: any(num(r.get('pass_touchdown')) == 1 or num(r.get('rush_touchdown')) == 1 for r in d)
            record.update(drives=len(drives), td_drives=sum(td(d) for d in drives.values()),
                          fg_drives=sum(any(r.get('field_goal_result') == 'made' for r in d) for d in drives.values()),
                          redzone_drives=len(redzone), redzone_td_drives=sum(td(d) for d in redzone))
            history[team].append(record)
    # Partial coverage can change the league ordering. Fail the refresh, retaining the old file.
    if excluded:
        raise ValueError(f'Team insight PBP missing/inconsistent for {excluded}')
    summaries = {t: aggregate(rs) for t, rs in history.items()}
    previous = {t: aggregate([r for r in rs if r['week'] < week - 1]) for t, rs in history.items() if any(r['week'] < week - 1 for r in rs)}
    off, defense = ranks(summaries, 'off_epa', True), ranks(summaries, 'def_epa', False)
    old_off, old_def = ranks(previous, 'off_epa', True), ranks(previous, 'def_epa', False)
    return {'schema_version': 1, 'season': season, 'week': week, 'features_through_week': week - 1, 'comparison_through_week': max(0, week - 2),
            'method': 'Offensive EPA/play descending; defensive EPA allowed/play ascending. Play weighted; tied values share a competition rank. Movement = previous rank minus current rank.',
            'teams': {t: {'season': summary, 'recent': aggregate(history[t][-3:]),
                          'off_rank': off.get(t), 'def_rank': defense.get(t),
                          'off_movement': old_off[t] - off[t] if t in old_off and t in off else None,
                          'def_movement': old_def[t] - defense[t] if t in old_def and t in defense else None,
                          'history': [{'game_id': r['game_id'], 'week': r['week'], 'opponent': r['opponent'], **aggregate([r])} for r in history[t]]} for t, summary in summaries.items()}}
