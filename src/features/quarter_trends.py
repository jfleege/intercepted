"""Descriptive quarter/half trends, reconciled with final scores; OT stays separate."""
from collections import defaultdict
from statistics import mean
from src.ml.projection_features import num, team_name, day


def quarter_trends(pbp_rows, games, season):
    allowed = {g['game_id']: g for g in games if g['season'] == season}
    groups = defaultdict(list)
    for row in pbp_rows:
        if row.get('game_id') in allowed and row.get('season_type') == 'REG' and row.get('qtr') in (1, 2, 3, 4, 5):
            groups[row['game_id']].append(row)
    histories, excluded = defaultdict(list), []
    for game_id, game in allowed.items():
        rows = groups.get(game_id, [])
        scores, valid = {}, True
        for q in range(1, 5 + int(any(r.get('qtr') == 5 for r in rows))):
            qr = [r for r in rows if r['qtr'] == q]
            home = [num(r.get('total_home_score'), None) for r in qr]
            away = [num(r.get('total_away_score'), None) for r in qr]
            home, away = [x for x in home if x is not None], [x for x in away if x is not None]
            if not home or not away:
                valid = False
                break
            scores[q] = (max(home), max(away))
        if not valid or not scores or scores[max(scores)] != (game['home_score'], game['away_score']):
            excluded.append(game_id)
            continue
        if any(scores[q][i] < (scores[q - 1][i] if q > 1 else 0) for q in scores for i in (0, 1)):
            excluded.append(game_id)
            continue
        for side, team, other, index in [('home', game['home_team'], game['away_team'], 0), ('away', game['away_team'], game['home_team'], 1)]:
            team = team_name(team)
            periods = []
            for q in range(1, 5):
                own = scores[q][index] - (scores[q - 1][index] if q > 1 else 0)
                opposing = scores[q][1 - index] - (scores[q - 1][1 - index] if q > 1 else 0)
                plays = [r for r in rows if r['qtr'] == q and team_name(r.get('posteam')) == team and r.get('play_type') in ('pass', 'run') and num(r.get('epa'), None) is not None]
                successes = [num(r.get('success'), None) for r in plays]
                successes = [s for s in successes if s is not None]
                periods.append({'period': f'Q{q}', 'points_for': own, 'points_against': opposing, 'plays': len(plays),
                                'epa_total': sum(num(r['epa']) for r in plays), 'successes': sum(successes), 'success_plays': len(successes)})
            for label, qs in [('H1', periods[:2]), ('H2', periods[2:4])]:
                periods.append({'period': label, **{key: sum(q[key] for q in qs) for key in ('points_for', 'points_against', 'plays', 'epa_total', 'successes', 'success_plays')}})
            ot = scores.get(5)
            histories[team].append({'game_id': game_id, 'week': game['week'], 'date': day(game).isoformat(), 'opponent': team_name(other), 'periods': periods,
                                    'overtime_points_for': ot[index] - scores[4][index] if ot else 0,
                                    'overtime_points_against': ot[1 - index] - scores[4][1 - index] if ot else 0})
    output = {}
    for team, records in histories.items():
        records.sort(key=lambda r: (r['date'], r['game_id']))
        summary = []
        for i, label in enumerate(['Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2']):
            all_periods = [g['periods'][i] for g in records]
            recent = all_periods[-3:]
            plays = sum(r['plays'] for r in all_periods)
            success_plays = sum(r['success_plays'] for r in all_periods)
            summary.append({'period': label, 'games': len(records), 'recent_games': len(recent),
                            'points_for': round(mean(r['points_for'] for r in all_periods), 2),
                            'points_against': round(mean(r['points_against'] for r in all_periods), 2),
                            'recent_points_for': round(mean(r['points_for'] for r in recent), 2),
                            'recent_points_against': round(mean(r['points_against'] for r in recent), 2),
                            'off_epa_per_play': round(sum(r['epa_total'] for r in all_periods) / plays, 3) if plays else None,
                            'success_rate': round(sum(r['successes'] for r in all_periods) / success_plays, 3) if success_plays else None})
        for record in records:
            record['periods'] = [{key: period[key] for key in ('period', 'points_for', 'points_against')} for period in record['periods']]
        output[team] = {'games': len(records), 'summary': summary, 'history': records}
    return {'kind': 'historical_trends', 'methodology': 'Current-season completed prior-week games. Quarter scores reconcile with final scores. Halves exclude OT. EPA uses pass/run plays. These are descriptive averages, not quarter forecasts.',
            'excluded_games': excluded, 'teams': output}
