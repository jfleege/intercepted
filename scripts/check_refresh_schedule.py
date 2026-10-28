"""Offline workflow wiring check: evaluate real step guards without API requests."""
import ast
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]


def evaluate(expression, context):
    tree = ast.parse(expression.replace('&&', ' and ').replace('||', ' or '), mode='eval')
    def visit(node):
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Name):
            return {'true': True, 'false': False, **context}[node.id]
        if isinstance(node, ast.Attribute):
            return visit(node.value).get(node.attr)
        if isinstance(node, ast.BoolOp):
            values = [bool(visit(value)) for value in node.values]
            return all(values) if isinstance(node.op, ast.And) else any(values)
        if isinstance(node, ast.Compare) and len(node.ops) == 1:
            left, right = visit(node.left), visit(node.comparators[0])
            if isinstance(node.ops[0], ast.Eq):
                return left == right
            if isinstance(node.ops[0], ast.NotEq):
                return left != right
        raise ValueError(f'Unsupported expression node: {ast.dump(node)}')
    return bool(visit(tree.body))


def main():
    workflow = yaml.load((ROOT / '.github/workflows/refresh-pages.yml').read_text(), Loader=yaml.BaseLoader)
    schedules = workflow['on']['schedule']
    weekly = [schedule for schedule in schedules if schedule.get('timezone') == 'America/Chicago']
    assert weekly == [{'cron': '0 12 * * 2', 'timezone': 'America/Chicago'}]
    steps = workflow['jobs']['build']['steps']
    indexed = {step['id']: step for step in steps if 'id' in step}
    order = list(indexed)
    assert order.index('pre_rollover') < order.index('forecast') < order.index('results') < order.index('history')
    archive = indexed['pre_rollover']['run']
    assert archive.index('src.ml.refresh_performance') < archive.index('src.ml.export_prediction_history') < archive.index('git commit') < archive.index('git push')
    assert 'data/tracking' in archive and 'frontend/public/predictions' in archive
    cases = [
        ('Tuesday noon', 'schedule', '0 12 * * 2', {}, (True, True, False, False)),
        ('Daily morning', 'schedule', '17 13 * * *', {}, (False, True, True, False)),
        ('Overnight', 'schedule', '47 7 * * *', {}, (False, False, False, False)),
        ('Manual forecast', 'workflow_dispatch', None, {'refresh_forecasts': True}, (True, True, False, False)),
        ('Results-only wins', 'workflow_dispatch', None, {'results_only': True, 'refresh_forecasts': True, 'refresh_odds': True, 'refresh_props': True}, (False, False, False, False)),
        ('Manual legacy props', 'workflow_dispatch', None, {'refresh_props': True}, (False, False, False, True)),
        ('Push deployment', 'push', None, {}, (False, True, False, False)),
    ]
    for label, event, cron, inputs, expected in cases:
        context = {'github': {'event_name': event, 'event': {'schedule': cron}}, 'inputs': inputs}
        actual = tuple(evaluate(indexed[key]['if'], context) for key in ('pre_rollover', 'forecast', 'odds', 'props'))
        assert actual == expected, (label, actual, expected)
        print(f'PASS {label}: archive/forecast/odds/props = {actual}')
    # The workflow must record a failed checkpoint instead of reporting full success.
    status = next(step for step in steps if step.get('name') == 'Export refresh status and source timestamps')
    assert 'steps.pre_rollover.outcome' in status['env']['REFRESH_OUTCOMES']
    print('PASS archive checkpoint order, named timezone, history persistence, and failure reporting')


if __name__ == '__main__':
    main()
