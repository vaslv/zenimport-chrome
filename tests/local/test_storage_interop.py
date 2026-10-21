"""Optional isolated Python ZIP -> real IDB -> Python-installation roundtrip."""
import base64
import json
import os
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_storage import call

ROOT=Path('/interop')


@pytest.mark.skipif(not ROOT.is_dir(),reason='requires the explicit offline financial-interop runner')
@pytest.mark.parametrize('name',['current','legacy','format1'])
def test_native_python_archive_roundtrip_preserves_all_financial_facts(tmp_path,name):
    root=ROOT/name;second=os.getenv('INTEROP_PHASE')=='installed'
    source=root/('server-installed.zip' if second else 'python.zip')
    expected=json.loads((root/('server-installed.json' if second else 'expected.json')).read_text())
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,page,_):
        original=call(page,'open')['value'];fence=original['context']
        stage=call(page,'stage-bytes',fence=fence,base64=base64.b64encode(source.read_bytes()).decode())
        assert stage['ok'],stage
        assert stage['value']['datasetDigest']==expected['digest']
        checked=call(page,'validate-graph',fence=fence,stageId=stage['value']['id']);assert checked['ok'],checked
        copied=worker.evaluate('args=>storageProbe.run("copy-inactive-stage",args)',
            dict(name='l4-financial',fence=fence,stageId=stage['value']['id']))
        assert copied['ok'],copied
        assert copied['value']['datasetDigest']==expected['digest']
        destination=root/('browser-installed.zip' if second else 'browser.zip')
        destination.write_bytes(base64.b64decode(copied['value']['base64'],validate=True))
        assert call(page,'open')['value']['context']==fence
        assert call(page,'open')['value']['state']['rows']==original['state']['rows']
        assert call(page,'stages')['value'][0]['state']=='graph_valid'
