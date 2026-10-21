"""Durable native scheduling with the actual SDK and a persistent fake service."""
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_mirror import call
from test_capture import NOW
from test_outbox import prepared_history,prepare


def test_native_worker_delivers_multiple_bounded_batches_and_persists_final_status(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        prepared_history(worker,21)
        first=call(worker,'delivery-run',now=NOW);assert first['ok'] and first['result']['sent'],first
        service=call(worker,'delivery-service')['result'];assert len(service['requests'])==1 and len(service['requests'][0]['transaction'])==20
        assert service['reads']==2 and len(service['transactions'])==20
        assert call(worker,'delivery-next',now=NOW)['result']==str(NOW)
        second=call(worker,'delivery-run',now=NOW);assert second['ok'] and second['result']['sent'],second
        service=call(worker,'delivery-service')['result'];assert len(service['requests'])==2 and len(service['requests'][1]['transaction'])==1
        assert len({row['id'] for row in service['transactions']})==21 and service['reads']==4
        assert all(row['viewed'] is False for row in service['transactions'])
        assert call(worker,'delivery-next',now=NOW)['result'] is None
        state=call(worker,'delivery-status',now=NOW)['result'];assert not state['work'] and state['display']['phase']=='idle'
        assert call(worker,'delivery-run',now=NOW)['ok']
        assert len(call(worker,'delivery-service')['result']['requests'])==2


def test_native_partial_400_verifies_same_uuids_and_backoff_survives_browser_restart(tmp_path):
    path,profile=tmp_path/'extension',tmp_path/'profile'
    with sync_playwright() as p:
        with installed(p,path,profile) as (_,worker,_,identifier):
            prepared_history(worker,2);reply=call(worker,'delivery-run',now=NOW,mode='partial-400');assert reply['ok'],reply
            assert reply['result']['nextAt']==str(NOW+15)
            state=call(worker,'delivery-state')['result'];assert sorted(row['state'] for row in state)==['delivered','uncertain']
            ids={row['zen_id'] for row in state};service=call(worker,'delivery-service')['result'];assert len(service['requests'])==1
        with installed(p,path,profile,known_id=identifier) as (_,worker,_,_):
            early=call(worker,'delivery-run',now=NOW+14);assert early['ok'] and not early['result']['sent'],early
            assert len(call(worker,'delivery-service')['result']['requests'])==1
            later=call(worker,'delivery-run',now=NOW+15);assert later['ok'] and not later['result']['sent'],later
            assert later['result']['nextAt']==str(NOW+45)
            assert {row['zen_id'] for row in call(worker,'delivery-state')['result']}==ids
            assert len(call(worker,'delivery-service')['result']['requests'])==1


def test_native_lost_reply_is_verified_without_another_create(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        prepared_history(worker,2);reply=call(worker,'delivery-run',now=NOW,mode='lost-service-reply');assert reply['ok'],reply
        assert reply['result']['nextAt'] is None
        assert all(row['state']=='delivered' for row in call(worker,'delivery-state')['result'])
        assert len(call(worker,'delivery-service')['result']['requests'])==1
        assert call(worker,'delivery-run',now=NOW)['ok']
        assert len(call(worker,'delivery-service')['result']['requests'])==1


def test_native_failed_read_and_competing_cycle_never_write_financial_http(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,page,_):
        prepared_history(worker);reply=call(worker,'delivery-run',now=NOW,mode='read-failure');assert reply['ok'],reply
        assert reply['result']['nextAt']==str(NOW+15) and not call(worker,'delivery-service')['result']['requests']
        # The mirror has its own durable cooldown (10s); the cycle retries at 15s.
        serial=worker.evaluate('mirrorProbe.networkCount()')
        worker.evaluate('args=>{globalThis.pendingCycle=mirrorProbe.run("delivery-run",args);return true;}',dict(name='l6-mirror',now=NOW+15,mode='pause-service'))
        for _ in range(200):
            if worker.evaluate('mirrorProbe.networkCount()')>serial:break
            page.wait_for_timeout(20)
        other=call(worker,'delivery-run',now=NOW+15);assert other['ok'] and not other['result']['sent'],other
        assert not call(worker,'delivery-service')['result']['requests']
        worker.evaluate('()=>mirrorProbe.releaseNetwork()')
        # This mode pauses each fake request, so close before any financial write.


def test_native_expired_attempt_recovery_verifies_but_never_dispatches_prepared_payload(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        prepared_history(worker);batch=prepare(worker)['result']
        blocked=call(worker,'delivery-run',now=NOW);assert blocked['ok'] and not blocked['result']['sent'],blocked
        assert blocked['result']['nextAt']==batch['deadline']
        later=call(worker,'delivery-run',now=NOW+61);assert later['ok'] and not later['result']['sent'],later
        service=call(worker,'delivery-service')['result'];assert not service['requests']
        assert call(worker,'delivery-state')['result'][0]['state']=='uncertain'


def test_native_status_sweep_continues_after_all_financial_work_is_finished(tmp_path):
    from test_local_reports import capture
    from test_capture import record
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=prepared_history(worker)
        for _ in range(20):capture(worker,connection,[record('bank-0')])
        first=call(worker,'delivery-run',now=NOW);assert first['ok'] and first['result']['sent'],first
        jobs=call(worker,'capture-state')['result']['capture_jobs'];assert len(jobs)==21
        assert sum(job['delivery_state']=='complete' for job in jobs)==20
        assert call(worker,'delivery-next',now=NOW)['result']==str(NOW)
        service=call(worker,'delivery-service')['result'];before=(service['reads'],len(service['requests']))
        second=call(worker,'delivery-run',now=NOW);assert second['ok'] and not second['result']['sent'],second
        assert all(job['delivery_state']=='complete' for job in call(worker,'capture-state')['result']['capture_jobs'])
        after=call(worker,'delivery-service')['result'];assert (after['reads'],len(after['requests']))==before
        assert call(worker,'delivery-next',now=NOW)['result'] is None


def test_native_periodic_alarm_is_recreated_and_retained_after_worker_shutdown(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (context,worker,page,_):
        prepared_history(worker)
        alarm=call(worker,'delivery-alarm',now=NOW,mode='clear-alarm');assert alarm['ok'] and alarm['result']['periodInMinutes']==.5,alarm
        session=context.new_cdp_session(page)
        target=next(row for row in session.send('Target.getTargets')['targetInfos'] if row['url']==worker.url and row['type']=='service_worker')
        assert session.send('Target.closeTarget',dict(targetId=target['targetId']))['success']
        retained=page.evaluate('()=>chrome.alarms.get("zenimport-local-delivery")');assert retained['periodInMinutes']==.5
        assert page.evaluate('()=>chrome.runtime.sendMessage({type:"probe-wake"})')
        restored=call(page,'delivery-alarm',now=NOW,mode='clear-alarm');assert restored['ok'] and restored['result']['periodInMinutes']==.5,restored
        assert call(page,'delivery-service')['result'] is None


def test_native_empty_completed_capture_gets_final_status_without_api_work(tmp_path):
    from test_local_reports import capture
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=prepared_history(worker,0)
        assert call(worker,'delivery-next',now=NOW)['result']==str(NOW)
        reply=call(worker,'delivery-run',now=NOW);assert reply['ok'] and not reply['result']['sent'],reply
        assert all(job['delivery_state']=='complete' for job in call(worker,'capture-state')['result']['capture_jobs'])
        assert call(worker,'delivery-service')['result'] is None
        assert call(worker,'delivery-next',now=NOW)['result'] is None


def test_native_blocked_intent_uses_bounded_backoff_instead_of_immediate_api_loop(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        prepared_history(worker)
        first=call(worker,'delivery-run',now=NOW,mode='invalid-catalog');assert first['ok'] and not first['result']['sent'],first
        assert first['result']['nextAt']==str(NOW+15)
        service=call(worker,'delivery-service')['result'];assert service['reads']==1 and not service['requests']
        early=call(worker,'delivery-run',now=NOW+14,mode='invalid-catalog');assert early['ok'] and early['calls']==0,early
        second=call(worker,'delivery-run',now=NOW+15,mode='invalid-catalog');assert second['ok'] and second['result']['nextAt']==str(NOW+45),second
        assert len(call(worker,'delivery-service')['result']['requests'])==0
