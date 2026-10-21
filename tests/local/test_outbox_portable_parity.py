"""An actual browser attempt journal is independently validated by the server."""
import base64
from uuid import uuid4
import pytest
pytest.importorskip('backend')
from backend import portable_codec,portable_graph
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_mirror import call
from test_capture import NOW
from test_outbox import prepared_history,prepare


@pytest.mark.parametrize('send',[False,True])
def test_native_uncertain_intent_archive_passes_actual_python_financial_graph(tmp_path,send):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        prepared_history(worker);batch=prepare(worker)['result']
        if send:
            reply=call(worker,'outbox-send',id=batch['id'],now=NOW);assert reply['ok'],reply
        else:
            recovered=call(worker,'outbox-recover',now=NOW+61);assert recovered['ok'],recovered
        exported=call(worker,'export',now=NOW+61,mode='archive-bytes');assert exported['ok'],exported
        archive=tmp_path/'native-journal.zip';archive.write_bytes(b''.join(base64.b64decode(chunk,validate=True) for chunk in exported['result']['chunks']))
        stage=portable_codec.read_archive(archive,tmp_path/str(uuid4()));summary=portable_graph.validate_stage(stage,expected_owners=['1'])
        counts=dict(summary.counts);assert counts['delivery_attempts']==(2 if send else 1) and counts['deliveries']==1
        assert exported['result']['receipt']['dataset_digest']==stage.manifest['dataset_digest']
        # The exact attempted UUID/payload are real persisted evidence, not a
        # fixture marker that could accidentally authorize another create.
        columns=portable_codec.TABLES['deliveries']['columns'];rows=list(stage.rows('deliveries'))
        assert rows[0][columns.index('zen_id')]==batch['items'][0]['zen_id']
        assert rows[0][columns.index('payload')]==batch['items'][0]['payload']
        assert rows[0][columns.index('ever_attempted')]==1 and rows[0][columns.index('state')]=='uncertain'
