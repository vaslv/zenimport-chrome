"""Actual published SDK writes are fenced by native attempts; fake network only."""
import json
import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_mirror import call
from test_capture import NOW
from test_outbox import prepared_history,prepare


def test_native_sdk_response_publication_and_journal_commit_atomically(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        prepared_history(worker);batch=prepare(worker)['result']
        sent=call(worker,'outbox-send',id=batch['id'],now=NOW);assert sent['ok'] and sent['result']==dict(outcome='response_applied',error=None),sent
        assert sent['calls']==1 and sent['tables']['zen_movements'][0]['id']==batch['items'][0]['zen_id']
        evidence=call(worker,'outbox-evidence')['result'];assert [row['outcome'] for row in evidence['attempts']].count('response_applied')==1
        assert evidence['deliveries'][0]['state']=='uncertain'
        request=call(worker,'last-write')['result'];assert request['transaction']==[json.loads(batch['items'][0]['payload'])] and request['serverTimestamp']==100
        assert request['transaction'][0]['viewed'] is False
        assert request['currentClientTimestamp']==NOW  # Fractional gateway clock is normalized only at SDK boundary.
        assert call(worker,'outbox-status')['result']['phase']=='settled'
        assert call(worker,'outbox-send',id=batch['id'],now=NOW)['calls']==0
        assert prepare(worker)['result'] is None
        assert call(worker,'delivery-state')['result'][0]['state']=='delivered'


@pytest.mark.parametrize('status,raw,mode,error',[
    (400,None,None,'zenmoney_response'),(429,None,None,'zenmoney_rate_limited'),(500,None,None,'zenmoney_unavailable'),
    (200,'{"serverTimestamp":101,"transaction":null}',None,'zenmoney_response'),
    (200,None,'timeout-write','zenmoney_unavailable'),(200,None,'quota-response','quota_exceeded'),
])
def test_native_unknown_sdk_outcome_never_repeats_original_create(tmp_path,status,raw,mode,error):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        prepared_history(worker);batch=prepare(worker)['result'];before=call(worker,'status')['tables']['zen_sync_runs']
        reply=call(worker,'outbox-send',id=batch['id'],now=NOW,status=status,raw=raw,mode=mode,delay=3000 if mode=='timeout-write' else None)
        assert reply['calls']==1,reply
        assert (reply.get('result') or {}).get('error',reply.get('code'))==error,reply
        after=call(worker,'status');assert after['tables']['zen_sync_runs']==before
        evidence=call(worker,'outbox-evidence')['result'];assert evidence['deliveries'][0]['state']=='uncertain'
        assert evidence['deliveries'][0]['zen_id']==batch['items'][0]['zen_id'] and evidence['deliveries'][0]['payload']==batch['items'][0]['payload']
        assert call(worker,'outbox-status')['result']['phase']=='settled'
        assert prepare(worker)['result'] is None
        assert call(worker,'outbox-send',id=batch['id'],now=NOW)['calls']==0


@pytest.mark.parametrize('failure',['permission','settings','token','expired'])
def test_native_sdk_final_dispatch_fence_prevents_network(tmp_path,failure):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=prepared_history(worker);batch=prepare(worker)['result'];options={}
        if failure=='permission':options['permission']=False
        if failure=='expired':options['now']=NOW+61
        if failure=='token':assert call(worker,'verify',token='rotated',now=NOW)['ok']
        if failure=='settings':assert call(worker,'accounts-configure',id=connection['accounts'][0]['id'],data=dict(expected_version=1,selection='ignored',zenmoney_account_id=None,import_start=None),now=NOW)['ok']
        reply=call(worker,'outbox-send',id=batch['id'],now=options.pop('now',NOW),**options);assert reply['calls']==0,reply
        assert call(worker,'last-write')['result'] is None


def test_native_browser_death_after_remote_commit_recovers_same_uuid_by_read(tmp_path):
    path,profile=tmp_path/'extension',tmp_path/'profile'
    with sync_playwright() as p:
        with installed(p,path,profile) as (_,worker,page,identifier):
            prepared_history(worker);batch=prepare(worker)['result'];serial=worker.evaluate('mirrorProbe.networkCount()')
            worker.evaluate('args=>{globalThis.pendingSend=mirrorProbe.run("outbox-send",args);return true;}',dict(name='l6-mirror',id=batch['id'],now=NOW,mode='pause-write'))
            for _ in range(200):
                if worker.evaluate('mirrorProbe.networkCount()')>serial and call(worker,'last-write')['result']:break
                page.wait_for_timeout(20)
            request=call(worker,'last-write')['result'];assert request['transaction'][0]['id']==batch['items'][0]['zen_id']
        with installed(p,path,profile,known_id=identifier) as (_,worker,_,_):
            assert call(worker,'outbox-recover',now=NOW+61)['ok']
            assert call(worker,'refresh',raw=json.dumps(dict(serverTimestamp=102,transaction=request['transaction'])),now=NOW+61)['ok']
            assert prepare(worker,now=NOW+61)['result'] is None
            assert call(worker,'delivery-state')['result'][0]['state']=='delivered'
            assert call(worker,'outbox-send',id=batch['id'],now=NOW+61)['calls']==0


def test_native_two_senders_cannot_settle_each_others_inflight_request(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,page,_):
        prepared_history(worker);batch=prepare(worker)['result'];serial=worker.evaluate('mirrorProbe.networkCount()')
        worker.evaluate('args=>{globalThis.pendingSend=mirrorProbe.run("outbox-send-two",args);return true;}',dict(name='l6-mirror',id=batch['id'],now=NOW,mode='pause-write'))
        for _ in range(200):
            if worker.evaluate('mirrorProbe.networkCount()')>serial:break
            page.wait_for_timeout(20)
        page.wait_for_timeout(100)
        assert call(worker,'outbox-status')['result']['phase']=='dispatching'
        assert len(call(worker,'outbox-evidence')['result']['attempts'])==1
        worker.evaluate('()=>mirrorProbe.releaseNetwork()');reply=worker.evaluate('()=>globalThis.pendingSend')
        assert reply['calls']==1 and sum(row.get('outcome')=='response_applied' for row in reply['result'])==1,reply
        assert call(worker,'outbox-status')['result']['phase']=='settled'


@pytest.mark.parametrize('size',[2,2100])
def test_native_partial_and_large_sdk_replies_publish_only_observed_facts(tmp_path,size):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        prepared_history(worker,2);batch=prepare(worker)['result'];items=[json.loads(item['payload']) for item in batch['items']]
        rows=[items[0]]+[dict(items[0],id='unrelated-'+str(i)) for i in range(size-1)]
        reply=call(worker,'outbox-send',id=batch['id'],now=NOW,raw=json.dumps(dict(serverTimestamp=101,transaction=rows)))
        assert reply['ok'] and reply['result']['outcome']=='response_applied',reply
        assert prepare(worker)['result'] is None
        states=call(worker,'delivery-state')['result'];assert sum(row['state']=='delivered' for row in states)==1
        assert sum(row['state']=='uncertain' for row in states)==1
        assert call(worker,'outbox-send',id=batch['id'],now=NOW)['calls']==0
