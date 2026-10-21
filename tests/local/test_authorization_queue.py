"""Accepted clicks and completed capture queue delivery work in the same commit."""
from uuid import uuid4
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_mirror import call
from test_capture import setup,start,lease,page,complete,record,NOW


def test_native_queue_acceptance_and_capture_completion_roll_back_together_on_quota(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker);request=str(uuid4())
        failed=call(worker,'capture-start',data=dict(connection_id=connection['id'],request_id=request,reimport_from=None),mode='quota-authorization-queue',now=NOW)
        assert failed['code']=='quota_exceeded',failed
        assert not call(worker,'capture-state')['result']['capture_jobs']
        assert not call(worker,'authorize-pending',now=NOW)['result']
        job=start(worker,connection,request=request)['result'];interval=job['accounts'][0]['intervals'][0];owned=lease(worker,job)
        assert call(worker,'authorize-drain',now=NOW)['ok']
        assert not call(worker,'authorize-pending',now=NOW)['result']
        assert page(worker,job,interval,owned,[record()])['ok']
        failed=call(worker,'capture-complete',id=job['id'],intervalId=interval['id'],data=owned|dict(total_pages=1,total_records=1),mode='quota-authorization-queue',now=NOW)
        assert failed['code']=='quota_exceeded',failed
        state=call(worker,'capture-state')['result'];assert state['capture_intervals'][0]['state']!='complete' and not state['coverage']
        assert not call(worker,'authorize-pending',now=NOW)['result']
        assert complete(worker,job,interval,owned)['ok']
        assert call(worker,'authorize-pending',now=NOW)['result'][0]['jobId']==job['id']
        assert call(worker,'authorize-drain',now=NOW)['result']['processed']==1
        assert len(call(worker,'authorization-state')['result']['authorizations'])==1
        assert not call(worker,'authorize-pending',now=NOW)['result']


def test_native_restart_resumes_queued_authorization_without_network_or_another_click(tmp_path):
    path,profile=tmp_path/'extension',tmp_path/'profile'
    with sync_playwright() as p:
        with installed(p,path,profile) as (_,worker,_,identifier):
            job=start(worker,setup(worker))['result'];interval=job['accounts'][0]['intervals'][0];owned=lease(worker,job)
            assert page(worker,job,interval,owned,[record()])['ok'];assert complete(worker,job,interval,owned)['ok']
            queued=call(worker,'authorize-pending',now=NOW)['result'];assert queued
        with installed(p,path,profile,known_id=identifier) as (_,worker,_,_):
            assert call(worker,'authorize-pending',now=NOW)['result']==queued
            drained=call(worker,'authorize-drain',now=NOW);assert drained['ok'] and drained['calls']==0,drained
            assert len(call(worker,'authorization-state')['result']['authorizations'])==1
            assert call(worker,'authorize-drain',now=NOW)['result']['processed']==0


def test_native_new_queue_task_survives_an_older_authorization_ack(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,page_context,_):
        connection=setup(worker);request=str(uuid4());job=start(worker,connection,request=request)['result'];interval=job['accounts'][0]['intervals'][0];owned=lease(worker,job)
        assert page(worker,job,interval,owned,[record()])['ok'];assert complete(worker,job,interval,owned)['ok']
        worker.evaluate('args=>{globalThis.pendingAuthorization=mirrorProbe.run("authorize-drain",args);return true;}',dict(name='l6-mirror',now=NOW,mode='pause-authorization-ack'))
        for _ in range(300):
            if worker.evaluate('mirrorProbe.checkpoint()'):break
            page_context.wait_for_timeout(20)
        assert worker.evaluate('mirrorProbe.checkpoint()')
        original=call(worker,'authorize-pending',now=NOW)['result'][0]
        assert start(worker,connection,request=request,now=NOW+1)['ok']
        replacement=call(worker,'authorize-pending',now=NOW+1)['result'][0];assert replacement['id']!=original['id'] and replacement['jobId']==original['jobId']
        worker.evaluate('()=>mirrorProbe.resumeAuthorization()');assert worker.evaluate('()=>globalThis.pendingAuthorization')['ok']
        assert call(worker,'authorize-pending',now=NOW+1)['result']==[replacement]
        assert call(worker,'authorize-drain',now=NOW+1)['ok']
        assert not call(worker,'authorize-pending',now=NOW+1)['result']


def test_native_authorization_queue_drains_at_most_twenty_clicks_per_unit(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker)
        for _ in range(25):
            job=start(worker,connection)['result'];assert call(worker,'capture-stop',id=job['id'],now=NOW)['ok']
        assert len(call(worker,'authorize-pending',now=NOW)['result'])==20
        first=call(worker,'authorize-drain',now=NOW);assert first['ok'] and first['result']['processed']==20 and first['maxTransactionMs']<10000,first
        assert len(call(worker,'authorize-pending',now=NOW)['result'])==5
        assert call(worker,'authorize-drain',now=NOW)['result']['processed']==5
        assert not call(worker,'authorize-pending',now=NOW)['result']
