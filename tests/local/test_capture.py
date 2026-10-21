"""Durable local capture through real installed workers, without delivery access."""
from datetime import datetime,timezone
from uuid import uuid4
import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_mirror import call
from test_connections import discovery

NOW=int(datetime(2026,10,21,12,tzinfo=timezone.utc).timestamp())
WORKER='10000000-0000-4000-8000-000000000001'


def setup(worker,keys=('primary',),start='2026-10-01',**changes):
    for action in ('init','verify','refresh'):assert call(worker,action,now=NOW)['ok']
    found=call(worker,'connections-discover',data=discovery(keys=keys,**changes),now=NOW);assert found['ok'],found
    for a in found['result']['accounts']:
        configured=call(worker,'accounts-configure',id=a['id'],data=dict(expected_version=0,selection='enabled',zenmoney_account_id='a',import_start=start),now=NOW);assert configured['ok'],configured
    return found['result']


def start(worker,connection,reimport=None,request=None,now=NOW):
    return call(worker,'capture-start',data=dict(connection_id=connection['id'],request_id=request or str(uuid4()),reimport_from=reimport),now=now)


def lease(worker,job,worker_id=WORKER,now=NOW):
    reply=call(worker,'capture-lease',id=job['id'],data=dict(worker_id=worker_id),now=now);assert reply['ok'],reply
    return dict(worker_id=worker_id,lease_epoch=reply['result']['epoch'])


def record(id='bank-1',**changes):
    return dict(external_id=id,identity_kind='bank',identity_version='fixture-v1',occurred_at='2026-10-20T12:00:00+07:00',local_date='2026-10-20',direction='expense',amount='100',currency='VND',description='Fixture payment',beneficiary_account=None,beneficiary_name=None,balance='900',details_state='complete',details={})|changes


def page(worker,job,interval,lease_data,records,number=1,pages=1,total=None,now=NOW,**options):
    return call(worker,'capture-page',id=job['id'],intervalId=interval['id'],number=number,data=lease_data|dict(page_number=number,total_pages=pages,total_records=len(records) if total is None else total,records=records),now=now,**options)


def complete(worker,job,interval,lease_data,pages=1,total=1,now=NOW):
    return call(worker,'capture-complete',id=job['id'],intervalId=interval['id'],data=lease_data|dict(total_pages=pages,total_records=total),now=now)


def test_native_plan_request_ack_pages_and_completion_are_durable_and_idempotent(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker);request=str(uuid4());reply=start(worker,connection,request=request);assert reply['ok'],reply
        job=reply['result'];assert job['capture_state']=='planned' and job['end_date']=='2026-10-21'
        assert start(worker,connection,request=request)['result']==job
        assert start(worker,connection,reimport='2026-09-01',request=request)['code']=='idempotency_conflict'
        active=start(worker,connection);assert active['result']['id']==job['id']
        l=lease(worker,job);interval=job['accounts'][0]['intervals'][0]
        saved=page(worker,job,interval,l,[record()]);assert saved['ok'] and not saved['result']['repeated'],saved
        repeated=page(worker,job,interval,l,[record()],now=NOW+121);assert repeated['ok'] and repeated['result']['repeated'],repeated
        # The receipt remains valid after lease expiry; completing needs renewed ownership.
        assert complete(worker,job,interval,l,now=NOW+121)['code']=='lease_expired'
        expired=call(worker,'capture-state')['result']['capture_jobs'][0];assert expired['capture_state']=='paused' and expired['worker_id'] is None
        l2=lease(worker,job,now=NOW+122);assert l2['lease_epoch']=='2'
        done=complete(worker,job,interval,l2,now=NOW+122);assert done['ok'] and done['result']['state']=='complete',done
        assert complete(worker,job,interval,l,total=1,now=NOW+130)['result']==done['result']
        state=call(worker,'capture-state')['result'];assert len(state['coverage'])==len(state['capture_pages'])==len(state['bank_versions'])==1
        assert state['bank_processing'][0]['state']=='pending' and not state['source_capture_leases']
        assert state['bank_accounts'][0]['last_complete_end']=='2026-10-21'
        assert start(worker,connection,reimport='2026-10-10')['result']['accounts'][0]['intervals'][0]['period']['start']=='2026-10-10'


@pytest.mark.parametrize('failure',['payload','counts','duplicate','direction','details'])
def test_native_invalid_or_conflicting_page_never_proves_complete_history(tmp_path,failure):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        job=start(worker,setup(worker))['result'];l=lease(worker,job);interval=job['accounts'][0]['intervals'][0]
        if failure=='payload':
            assert page(worker,job,interval,l,[record()])['ok'];bad=page(worker,job,interval,l,[record(description='different')]);assert bad['code']=='idempotency_conflict'
        elif failure=='counts':
            assert page(worker,job,interval,l,[record()],pages=2,total=2)['ok'];bad=page(worker,job,interval,l,[record('bank-2')],number=2,pages=2,total=3);assert bad['code']=='history_incomplete'
        elif failure=='duplicate':
            assert page(worker,job,interval,l,[record()],pages=2,total=2)['ok'];bad=page(worker,job,interval,l,[record()],number=2,pages=2,total=2);assert bad['code']=='history_incomplete'
        elif failure=='direction':
            bad=page(worker,job,interval,l,[record(local_date='2026-10-19')]);assert bad['code']=='capture_context_changed'
        else:
            bad=page(worker,job,interval,l,[record(details={'password':'must-not-store'})]);assert bad['code']=='validation_error'
        state=call(worker,'capture-state')['result'];assert not state['coverage']
        assert len(state['capture_pages'])==(1 if failure in ('payload','counts','duplicate') else 0)
        assert all(row['raw_json'].find('must-not-store')<0 for row in state['bank_transactions'])


def test_native_incomplete_completion_retries_and_bank_login_resume_preserve_plan(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        job=start(worker,setup(worker))['result'];l=lease(worker,job);interval=job['accounts'][0]['intervals'][0]
        assert page(worker,job,interval,l,[record()],pages=2,total=2)['ok']
        assert complete(worker,job,interval,l,pages=2,total=2)['code']=='history_incomplete'
        assert call(worker,'capture-get',id=job['id'],now=NOW)['result']['capture_state']=='collecting'
        paused=call(worker,'capture-pause',id=job['id'],data=l|dict(state='paused',code='bank_login_required'),now=NOW);assert paused['ok'],paused
        assert call(worker,'capture-lease',id=job['id'],data=dict(worker_id=WORKER),now=NOW)['code']=='bank_login_required'
        resumed=start(worker,dict(id=job['connection_id']),now=NOW+86400);assert resumed['ok'] and resumed['result']['id']==job['id'] and resumed['result']['end_date']==job['end_date'],resumed
        l=lease(worker,job,now=NOW+86400)
        assert page(worker,job,interval,l,[record('bank-2')],number=2,pages=2,total=2,now=NOW+86400)['ok']
        assert complete(worker,job,interval,l,pages=2,total=2,now=NOW+86400)['ok']


def test_native_empty_history_multiple_accounts_and_cross_profile_locks(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker,keys=('a','b'));job=start(worker,connection)['result'];l=lease(worker,job)
        other=call(worker,'connections-discover',data=discovery('other',('a',)),now=NOW)['result']
        assert start(worker,other)['code']=='account_busy'
        for account in job['accounts']:
            interval=account['intervals'][0];saved=page(worker,job,interval,l,[]);assert saved['ok'],saved
            assert complete(worker,job,interval,l,total=0)['ok']
        state=call(worker,'capture-get',id=job['id'],now=NOW)['result'];assert state['capture_state']=='complete' and state['delivery_state']=='complete' and not state['errors']
        assert start(worker,other)['ok']


def test_native_killed_worker_after_page_commit_replays_original_ack_without_extra_revision(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (context,worker,page_ui,_):
        job=start(worker,setup(worker))['result'];l=lease(worker,job);interval=job['accounts'][0]['intervals'][0]
        args=dict(name='l6-mirror',id=job['id'],intervalId=interval['id'],number=1,data=l|dict(page_number=1,total_pages=1,total_records=1,records=[record()]),now=NOW,mode='lost-capture-reply')
        worker.evaluate('args=>{globalThis.pendingPage=mirrorProbe.run("capture-page",args);return true;}',args)
        for _ in range(300):
            if worker.evaluate('mirrorProbe.checkpoint()'):break
            page_ui.wait_for_timeout(20)
        assert worker.evaluate('mirrorProbe.checkpoint()')
        session=context.new_cdp_session(page_ui);target=next(row for row in session.send('Target.getTargets')['targetInfos'] if row['url']==worker.url and row['type']=='service_worker')
        assert session.send('Target.closeTarget',dict(targetId=target['targetId']))['success'];assert page_ui.evaluate('()=>chrome.runtime.sendMessage({type:"probe-wake"})')
        repeated=page(page_ui,job,interval,l,[record()]);assert repeated['ok'] and repeated['result']['repeated'],repeated
        assert complete(page_ui,job,interval,l)['ok']
        state=call(page_ui,'capture-state')['result'];assert len(state['bank_versions'])==len(state['capture_pages'])==1


def test_native_uppercase_uuid_paths_and_in_progress_account_state_match_server(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        job=start(worker,setup(worker,start='2026-09-01'))['result'];assert len(job['accounts'][0]['intervals'])==2
        upper=dict(job,id=job['id'].upper());interval=dict(job['accounts'][0]['intervals'][0]);interval['id']=interval['id'].upper()
        assert call(worker,'capture-get',id=upper['id'],now=NOW)['ok']
        l=lease(worker,upper);saved=page(worker,upper,interval,l,[],pages=1,total=0);assert saved['ok'],saved
        progress=call(worker,'capture-get',id=upper['id'],now=NOW)['result'];assert progress['accounts'][0]['capture_state']=='collecting'
        assert complete(worker,upper,interval,l,total=0)['ok']
        assert call(worker,'capture-stop',id=upper['id'],now=NOW)['result']['capture_state']=='cancelled'


@pytest.mark.parametrize('mode',['quota-capture','quota-complete'])
def test_native_capture_quota_rolls_back_page_or_completion_without_losing_retry_identity(tmp_path,mode):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        job=start(worker,setup(worker))['result'];l=lease(worker,job);interval=job['accounts'][0]['intervals'][0]
        if mode=='quota-capture':
            failed=page(worker,job,interval,l,[record()],mode=mode);assert failed['code']=='quota_exceeded',failed
            state=call(worker,'capture-state')['result'];assert not state['capture_pages'] and not state['bank_versions'] and not state['bank_transactions']
        assert page(worker,job,interval,l,[record()])['ok']
        if mode=='quota-complete':
            failed=call(worker,'capture-complete',id=job['id'],intervalId=interval['id'],data=l|dict(total_pages=1,total_records=1),now=NOW,mode=mode);assert failed['code']=='quota_exceeded',failed
            assert not call(worker,'capture-state')['result']['coverage']
        assert complete(worker,job,interval,l)['ok']


def test_native_capture_completes_with_unconfigured_zenmoney_without_sending(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker);assert call(worker,'remove',now=NOW)['ok']
        job=start(worker,connection)['result'];l=lease(worker,job);interval=job['accounts'][0]['intervals'][0]
        saved=page(worker,job,interval,l,[record()]);assert saved['ok'] and saved['calls']==0,saved
        done=complete(worker,job,interval,l);assert done['ok'] and done['calls']==0 and not done['readiness']['configured'],done
        assert len(call(worker,'capture-state')['result']['coverage'])==1


def test_native_live_legacy_marker_is_rejected_without_poisoning_export(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker)
        bad=call(worker,'connections-discover',data=discovery(connector_version='legacy-v12'),now=NOW);assert bad['code']=='validation_error',bad
        job=start(worker,connection)['result'];l=lease(worker,job);interval=job['accounts'][0]['intervals'][0]
        bad=page(worker,job,interval,l,[record(identity_version='legacy-v12')]);assert bad['code']=='validation_error',bad
        assert not call(worker,'capture-state')['result']['bank_versions']
        assert page(worker,job,interval,l,[record()])['ok'];assert complete(worker,job,interval,l)['ok']
        exported=call(worker,'export',now=NOW);assert exported['ok'],exported


def test_native_bounded_full_page_out_of_order_and_revised_observation(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker);job=start(worker,connection)['result'];l=lease(worker,job);interval=job['accounts'][0]['intervals'][0]
        assert page(worker,job,interval,l,[record('last')],number=2,pages=2,total=501)['ok']
        assert complete(worker,job,interval,l,pages=2,total=501)['code']=='history_incomplete'
        saved=page(worker,job,interval,l,[record('bank-'+str(i)) for i in range(500)],pages=2,total=501);assert saved['ok'],saved
        assert saved['maxTransactionMs']<10000,saved['maxTransactionMs']
        assert complete(worker,job,interval,l,pages=2,total=501)['ok']
        second=start(worker,connection)['result'];owned=lease(worker,second);piece=second['accounts'][0]['intervals'][0]
        assert page(worker,second,piece,owned,[record('bank-0',amount='200')])['ok'];assert complete(worker,second,piece,owned)['ok']
        state=call(worker,'capture-state')['result'];assert len(state['bank_transactions'])==501 and len(state['bank_versions'])==502
        bank=next(row for row in state['bank_transactions'] if row['external_id']=='bank-0')
        assert bank['revision']=='2'
        observed=[row for row in state['captured_records'] if row['bank_id']==bank['id']]
        assert {row['revision'] for row in observed}=={'1','2'}
        assert call(worker,'export',now=NOW)['ok']


def test_native_capture_rejects_other_worker_and_wrong_interval_then_preserves_partial_cancel(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        first=start(worker,setup(worker))['result'];l=lease(worker,first);interval=first['accounts'][0]['intervals'][0]
        assert call(worker,'capture-lease',id=first['id'],data=dict(worker_id=str(uuid4())),now=NOW)['code']=='capture_busy'
        assert page(worker,first,interval,dict(worker_id=str(uuid4()),lease_epoch=l['lease_epoch']),[record()])['code']=='lease_expired'
        other_connection=call(worker,'connections-discover',data=discovery('another',('another',)),now=NOW)['result']
        a=other_connection['accounts'][0]
        assert call(worker,'accounts-configure',id=a['id'],data=dict(expected_version=0,selection='enabled',zenmoney_account_id='a',import_start='2026-10-01'),now=NOW)['ok']
        other=start(worker,other_connection)['result'];other_interval=other['accounts'][0]['intervals'][0]
        assert page(worker,first,other_interval,l,[record()])['code']=='not_found'
        assert complete(worker,first,other_interval,l)['code']=='not_found'
        assert page(worker,first,interval,l,[record()],pages=2,total=2)['ok']
        stopped=call(worker,'capture-stop',id=first['id'],now=NOW);assert stopped['result']['capture_state']=='cancelled'
        state=call(worker,'capture-state')['result'];assert len(state['bank_transactions'])==1 and not state['coverage']
        assert page(worker,first,interval,l,[record()],pages=2,total=2)['result']['repeated']


def test_native_settings_change_cancels_capture_without_erasing_page_evidence(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker);job=start(worker,connection)['result'];l=lease(worker,job);interval=job['accounts'][0]['intervals'][0]
        assert page(worker,job,interval,l,[record()],pages=2,total=2)['ok']
        a=connection['accounts'][0]
        changed=call(worker,'accounts-configure',id=a['id'],data=dict(expected_version=1,selection='ignored',zenmoney_account_id=None,import_start=None),now=NOW);assert changed['ok'],changed
        state=call(worker,'capture-get',id=job['id'],now=NOW)['result']
        assert state['capture_state']=='cancelled' and state['delivery_state']=='blocked'
        assert any(e['code']=='settings_conflict' for e in state['errors'])
        assert complete(worker,job,interval,l,pages=2,total=2)['code']=='account_disabled'
        saved=call(worker,'capture-state')['result'];assert len(saved['capture_pages'])==len(saved['bank_versions'])==1 and not saved['coverage']
