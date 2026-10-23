"""Disposable source acceleration checked against cold native IDB after real writes."""
import json
import time
from pathlib import Path
import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_mirror import call,full,many,ready
from test_capture import NOW
from test_outbox import prepared_history,prepare


def compare(worker,**args):
    reply=call(worker,'source-cache-compare',now=NOW,summary=True,**args)
    assert reply['ok'] and 'mismatch' not in reply['result'],reply
    return reply['result']


def test_cache_tracks_commits_and_mirror_publication_but_never_aborted_intents(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        prepared_history(worker,21)
        compare(worker)
        warm=compare(worker);assert warm['warmReads']==dict(pages=0,rows=0)
        failed=prepare(worker,mode='quota-outbox');assert failed['code']=='quota_exceeded',failed
        assert compare(worker)['warmReads']['rows']==0
        for _ in range(2):
            reply=call(worker,'delivery-run',now=NOW,summary=True);assert reply['ok'],reply
            assert reply['sourceReads']['rows']<=42,reply['sourceReads']
            assert compare(worker)['warmReads']['rows']==0
        assert len(call(worker,'delivery-service')['result']['requests'])==2
        assert call(worker,'refresh',now=NOW,raw=many(1000,1000),summary=True)['ok']
        compare(worker)
        assert call(worker,'refresh',now=NOW,raw=json.dumps(dict(serverTimestamp=1001,deletion=[dict(object='transaction',id='t-0')])),summary=True)['ok']
        assert compare(worker)['warmReads']['rows']==0
        assert call(worker,'refresh',now=NOW,raw=many(1,1002),summary=True)['ok']
        assert compare(worker)['warmReads']['rows']==0
        assert call(worker,'verify',now=NOW,token='rotated')['ok']
        assert compare(worker)['warmReads']['rows']>0
        assert call(worker,'refresh',now=NOW,raw=full(1003),summary=True)['ok']
        assert compare(worker)['warmReads']['rows']==0


@pytest.mark.parametrize('count',[1000,10000,100000])
def test_large_retained_history_does_not_get_rescanned_for_each_delivery_batch(tmp_path,count):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (context,worker,page,_):
        prepared_history(worker,41)
        assert call(worker,'refresh',now=NOW,raw=many(count,101),summary=True)['ok']
        assert call(worker,'source-cache-forget',now=NOW,summary=True)['ok']
        cold=call(worker,'source-cache-read',now=NOW,summary=True);assert cold['ok'],cold
        assert cold['sourceReads']['rows']>=count
        metrics=[]
        for _ in range(3):
            started=time.monotonic()
            reply=call(worker,'delivery-run',now=NOW,summary=True);assert reply['ok'] and reply['result']['sent'],reply
            assert reply['sourceReads']['rows']<=82,reply['sourceReads']
            elapsed=time.monotonic()-started
            assert elapsed<180
            assert reply['maxTransactionMs']<10000
            metrics.append(dict(elapsed_seconds=elapsed,source_reads=reply['sourceReads'],max_transaction_ms=reply['maxTransactionMs']))
        service=call(worker,'delivery-service',summary=True)['result'];assert len(service['requests'])==3
        assert sum(len(request['transaction']) for request in service['requests'])==41
        assert compare(worker)['warmReads']['rows']==0
        peak=int(Path('/sys/fs/cgroup/memory.peak').read_text());assert peak<3*1024**3
        Path('/results').mkdir(exist_ok=True)
        Path(f'/results/source-cache-{count}.json').write_text(json.dumps(dict(retained_transactions=count,new_transactions=41,cold=cold['result'],batches=metrics,cgroup_peak_bytes=peak)))
