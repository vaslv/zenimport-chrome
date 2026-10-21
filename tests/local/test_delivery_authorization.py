"""Only immutable, completely observed capture revisions authorize new delivery."""
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_mirror import call
from test_capture import setup,start,lease,page,complete,record,NOW


def test_native_delivery_authorization_requires_complete_capture_and_preserves_replay(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        job=start(worker,setup(worker))['result'];interval=job['accounts'][0]['intervals'][0];owned=lease(worker,job)
        assert page(worker,job,interval,owned,[record()])['ok']
        before=call(worker,'authorize-job',id=job['id'],now=NOW);assert before['ok'] and before['result']['authorized']==0,before
        assert complete(worker,job,interval,owned)['ok']
        reply=call(worker,'authorize-job',id=job['id'].upper(),now=NOW);assert reply['ok'] and reply['result']['authorized']==1,reply
        state=call(worker,'authorization-state')['result'];auth=state['authorizations'][0]
        assert auth['revision']=='1' and auth['target_id']=='a' and auth['settings_version']=='1' and auth['interval_id']==interval['id']
        assert call(worker,'authorize-job',id=job['id'],now=NOW)['ok']
        assert call(worker,'authorization-state')['result']==state
        assert call(worker,'export',now=NOW)['ok']


def test_native_delivery_authorization_recovers_from_browser_shutdown_after_capture(tmp_path):
    path,profile=tmp_path/'extension',tmp_path/'profile'
    with sync_playwright() as p:
        with installed(p,path,profile) as (_,worker,_,identifier):
            job=start(worker,setup(worker))['result'];interval=job['accounts'][0]['intervals'][0];owned=lease(worker,job)
            assert page(worker,job,interval,owned,[record()])['ok'];assert complete(worker,job,interval,owned)['ok']
        with installed(p,path,profile,known_id=identifier) as (_,worker,_,_):
            reply=call(worker,'authorize-job',id=job['id'],now=NOW);assert reply['ok'] and reply['result']['authorized']==1,reply
            assert call(worker,'authorization-state')['result']['schedule']==[dict(id='1',next_run_at=str(NOW),failures='0')]


def test_native_delivery_authorization_does_not_authorize_reconfigured_account(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker);job=start(worker,connection)['result'];interval=job['accounts'][0]['intervals'][0];owned=lease(worker,job)
        assert page(worker,job,interval,owned,[record()])['ok'];assert complete(worker,job,interval,owned)['ok']
        changed=call(worker,'accounts-configure',id=connection['accounts'][0]['id'],data=dict(expected_version=1,selection='ignored',zenmoney_account_id=None,import_start=None),now=NOW);assert changed['ok'],changed
        reply=call(worker,'authorize-job',id=job['id'],now=NOW);assert reply['ok'] and reply['result']['authorized']==0,reply
        assert not call(worker,'authorization-state')['result']['authorizations']


def test_native_explicit_click_can_authorize_old_completed_history_outside_new_overlap(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker);first=start(worker,connection)['result'];interval=first['accounts'][0]['intervals'][0];owned=lease(worker,first)
        old=record(local_date='2026-10-02',occurred_at='2026-10-02T12:00:00+07:00')
        assert page(worker,first,interval,owned,[old])['ok'];assert complete(worker,first,interval,owned)['ok']
        second=start(worker,connection)['result'];assert second['id']!=first['id']
        assert all(row['period']['start']>'2026-10-02' for row in second['accounts'][0]['intervals'])
        reply=call(worker,'authorize-job',id=second['id'],now=NOW);assert reply['ok'] and reply['result']['authorized']==1,reply
        auth=call(worker,'authorization-state')['result']['authorizations'][0]
        assert auth['job_id']==second['id'] and auth['interval_id']==interval['id'] and auth['revision']=='1'
        assert call(worker,'capture-stop',id=second['id'],now=NOW)['ok']
        exported=call(worker,'export',now=NOW);assert exported['ok'],exported
