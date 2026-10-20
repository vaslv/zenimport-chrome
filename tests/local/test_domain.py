"""Execute the shared pure engine from an installed, offline MV3 worker."""
import json
from pathlib import Path

from playwright.sync_api import sync_playwright
from test_runtime import installed

ROOT = Path('/app/contracts/business/v1')


def test_native_browser_shared_financial_scenarios(tmp_path):
    with sync_playwright() as p, installed(p, tmp_path/'extension', tmp_path/'profile') as (_, worker, _, _):
        for path in sorted((ROOT/'scenarios').glob('*.json')):
            scenario = json.loads(path.read_text())
            if scenario['implemented_by_stage'] == 'L2':
                assert worker.evaluate('scenario=>domain.runScenario(scenario)', scenario) == scenario['expected'], scenario['id']


def test_native_browser_pinned_unicode_and_exact_random_vectors(tmp_path):
    with sync_playwright() as p, installed(p, tmp_path/'extension', tmp_path/'profile') as (_, worker, _, _):
        unicode = json.loads((ROOT/'unicode15.json').read_text())['vectors']
        result = worker.evaluate('rows=>rows.map(([value])=>domain.normalized(value))', unicode)
        assert result == [expected for _, expected in unicode]
        rows = json.loads((ROOT/'arithmetic-vectors.json').read_text())['vectors']
        result = worker.evaluate('rows=>rows.map(row=>domain.ExactMoney.parse(row.left).add(domain.ExactMoney.parse(row.right)).toString())', rows)
        assert result == [row['sum'] for row in rows]
