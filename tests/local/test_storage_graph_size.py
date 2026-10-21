"""Full graph validation under a real MV3 worker and a bounded container heap."""
import json
import os
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_storage import call

FIXTURE=json.loads(Path('/app/contracts/business/v1/portable-financial-v2.json').read_text())


@pytest.mark.parametrize('count',[1000,10000,100000])
def test_native_complete_large_graph_remains_exact_validated_and_inactive(tmp_path,count):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,page,_):
        original=call(page,'open')['value'];fence=original['context']
        result=worker.evaluate('args=>storageProbe.run("stage",args)',
            dict(name='l4-financial',fence=fence,golden=FIXTURE,count=count,mode='valid-graph'))
        assert result['ok'],result
        stage=result['value'];assert stage['state']=='graph_valid' and stage['graphVersion']=='1'
        assert int(stage['rowCount'])==count+sum(len(rows) for rows in FIXTURE['rows'].values())
        assert int(stage['byteCount'])>count*1900
        assert stage['maxTransactionMs']<10000
        assert call(page,'open')['value']['context']==fence
        assert call(page,'open')['value']['state']['rows']==original['state']['rows']
        peak=int(Path('/sys/fs/cgroup/memory.peak').read_text());assert 0<peak<3*1024**3
        Path('/results').mkdir(exist_ok=True)
        label='chrome140' if os.getenv('CHROME_EXECUTABLE') else 'chromium145'
        Path('/results',f'l4-complete-graph-{label}-{count}.json').write_text(json.dumps(dict(count=count,
            bytes=stage['byteCount'],elapsed_ms=stage['elapsedMs'],validation_ms=stage['validationMs'],
            max_transaction_ms=stage['maxTransactionMs'],cgroup_peak_bytes=peak,user_agent=worker.evaluate('navigator.userAgent'))))
