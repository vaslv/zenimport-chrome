"""Native outbox commits identity, exact payload and attempt before dispatch rights."""
import json
import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_mirror import call,full
from test_capture import setup,record,NOW
from test_local_reports import capture,remote


def prepared_history(worker,count=1):
    connection=setup(worker)
    raw=json.loads(full());raw['account'][0]['user']=1
    assert call(worker,'refresh',raw=json.dumps(raw),now=NOW)['ok']
    capture(worker,connection,[record('bank-'+str(i)) for i in range(count)])
    assert call(worker,'authorize-drain',now=NOW)['ok']
    return connection


def prepare(worker,now=NOW,**options):return call(worker,'outbox-prepare',now=now,**options)


def test_native_outbox_preserves_exact_payload_attempt_and_single_dispatch_authority(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        prepared_history(worker);reply=prepare(worker);assert reply['ok'] and reply['result'],reply
        batch=reply['result'];assert batch['phase']=='prepared' and reply['calls']==0
        delivery=call(worker,'delivery-state')['result'][0];item=batch['items'][0]
        assert delivery['zen_id']==item['zen_id'] and delivery['payload']==item['payload'] and delivery['state']=='attempting' and delivery['ever_attempted']=='1'
        evidence=call(worker,'outbox-evidence',now=NOW)['result'];assert len(evidence['attempts'])==1 and evidence['attempts'][0]['outcome']=='intent' and evidence['attempts'][0]['payload']==item['payload']
        payload=json.loads(item['payload']);assert payload['viewed'] is False and payload['outcome']==100
        assert prepare(worker)['code']=='delivery_busy'
        assert call(worker,'refresh',now=NOW)['code']=='mirror_busy'
        # Popup polling updates progress; this must not strand an accepted intent.
        job=call(worker,'capture-state')['result']['capture_jobs'][0];assert call(worker,'capture-get',id=job['id'],now=NOW)['ok']
        granted=call(worker,'outbox-dispatch',id=batch['id'],now=NOW);assert granted['ok'] and granted['result']['phase']=='dispatching',granted
        assert call(worker,'outbox-dispatch',id=batch['id'],now=NOW)['code']=='delivery_unknown'
        assert call(worker,'outbox-finish',id=batch['id'],now=NOW)['ok']
        state=call(worker,'delivery-state')['result'][0];assert state==delivery|dict(state='uncertain')
        assert prepare(worker)['ok'] and prepare(worker)['result'] is None
        assert call(worker,'delivery-state')['result'][0]['payload']==item['payload']


@pytest.mark.parametrize('failure',['quota-outbox','quota-outbox-control'])
def test_native_outbox_quota_cannot_leave_a_partial_financial_intent(tmp_path,failure):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        prepared_history(worker);failed=prepare(worker,mode=failure);assert failed['code']=='quota_exceeded',failed
        assert not call(worker,'delivery-state')['result']
        assert call(worker,'outbox-status',now=NOW)['result'] is None
        processing=call(worker,'reconcile-state')['result']['processing'];assert processing[0]['state']=='pending'
        assert not call(worker,'reconcile-state')['result']['targets']
        assert prepare(worker)['ok']


@pytest.mark.parametrize('dispatched',[False,True])
def test_native_worker_shutdown_retains_uuid_and_recovers_only_to_verification(tmp_path,dispatched):
    path,profile=tmp_path/'extension',tmp_path/'profile'
    with sync_playwright() as p:
        with installed(p,path,profile) as (_,worker,_,identifier):
            prepared_history(worker);batch=prepare(worker)['result'];before=call(worker,'delivery-state')['result']
            if dispatched:assert call(worker,'outbox-dispatch',id=batch['id'],now=NOW)['ok']
        with installed(p,path,profile,known_id=identifier) as (_,worker,_,_):
            assert call(worker,'outbox-recover',now=NOW+59)['code']=='delivery_busy'
            recovered=call(worker,'outbox-recover',now=NOW+61);assert recovered['ok'] and recovered['result']['recovered']==1,recovered
            assert call(worker,'outbox-dispatch',id=batch['id'],now=NOW+61)['code']=='delivery_unknown'
            assert prepare(worker,now=NOW+61)['result'] is None
            after=call(worker,'delivery-state')['result'];assert after[0]['zen_id']==before[0]['zen_id'] and after[0]['payload']==before[0]['payload'] and after[0]['ever_attempted']=='1'
            assert after[0]['state']=='uncertain'


def test_native_outbox_adopts_existing_mirror_facts_and_bounds_creates_to_twenty(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        prepared_history(worker,21);reply=prepare(worker);assert reply['ok'] and len(reply['result']['items'])==20,reply
        assert reply['maxTransactionMs']<10000
        assert call(worker,'outbox-finish',id=reply['result']['id'],now=NOW)['ok']
        second=prepare(worker);assert second['ok'] and len(second['result']['items'])==1,second
        assert not set(item['zen_id'] for item in reply['result']['items'])&set(item['zen_id'] for item in second['result']['items'])


@pytest.mark.parametrize('existing',[False,True])
def test_native_current_success_resolves_old_scoped_errors(tmp_path,existing):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=prepared_history(worker);job=call(worker,'capture-state')['result']['capture_jobs'][0]
        for code in ('existing_ownership_unknown','zenmoney_account_unavailable','settings_conflict','account_disabled'):
            seeded=call(worker,'outbox-seed-error',id=job['id'],accountId=connection['accounts'][0]['id'],label=code,now=NOW);assert seeded['ok'],seeded
        if existing:assert call(worker,'refresh',raw=json.dumps(dict(serverTimestamp=101,transaction=[remote('existing')])),now=NOW)['ok']
        reply=prepare(worker);assert reply['ok'],reply
        if existing:assert reply['result'] is None and not call(worker,'delivery-state')['result']
        status=call(worker,'capture-get',id=job['id'],now=NOW)['result']
        assert {row['code'] for row in status['errors']}==({'delivery_uncertain'} if not existing else set()),status
        assert status['delivery_state']==('complete' if existing else 'running')


def test_native_expired_outbox_must_recover_before_migration_hold(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        prepared_history(worker);batch=prepare(worker)['result']
        assert call(worker,'export',now=NOW)['code']=='migration_busy'
        assert call(worker,'export',now=NOW+61)['code']=='migration_busy'
        recovered=call(worker,'outbox-recover',now=NOW+61);assert recovered['ok'],recovered
        exported=call(worker,'export',now=NOW+61);assert exported['ok'],exported
        assert batch['items'][0]['zen_id']


def test_native_new_authorization_between_candidate_scan_and_matching_cannot_bypass_reconciliation(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,page_context,_):
        connection=prepared_history(worker)
        assert call(worker,'refresh',raw=json.dumps(dict(serverTimestamp=101,transaction=[remote('existing-new-bank',amount=200)])),now=NOW)['ok']
        worker.evaluate('args=>{globalThis.pendingOutbox=mirrorProbe.run("outbox-prepare",args);return true;}',dict(name='l6-mirror',now=NOW,mode='pause-before-reconcile'))
        for _ in range(300):
            if worker.evaluate('mirrorProbe.checkpoint()'):break
            page_context.wait_for_timeout(20)
        assert worker.evaluate('mirrorProbe.checkpoint()')
        capture(worker,connection,[record('bank-0'),record('late-bank',amount='200')])
        assert call(worker,'authorize-drain',now=NOW)['ok']
        worker.evaluate('()=>mirrorProbe.resumeOutbox()');rejected=worker.evaluate('()=>globalThis.pendingOutbox')
        assert rejected['code']=='stale_epoch',rejected
        assert not call(worker,'delivery-state')['result']
        retry=prepare(worker);assert retry['ok'] and len(retry['result']['items'])==1,retry
        state=call(worker,'capture-state')['result'];late=next(row for row in state['bank_transactions'] if row['external_id']=='late-bank')
        assert retry['result']['items'][0]['bank_id']!=late['id']
        receipts=call(worker,'reconcile-state')['result']['receipts'];assert any(row['bank_id']==late['id'] and row['zen_id']=='existing-new-bank' for row in receipts)


@pytest.mark.parametrize('change',['settings','token','expired'])
def test_native_pre_dispatch_revalidation_blocks_changed_authority_or_settings(tmp_path,change):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=prepared_history(worker);batch=prepare(worker)['result'];at=NOW
        if change=='settings':
            reply=call(worker,'accounts-configure',id=connection['accounts'][0]['id'],data=dict(expected_version=1,selection='ignored',zenmoney_account_id=None,import_start=None),now=NOW);assert reply['ok'],reply
        if change=='token':assert call(worker,'verify',token='rotated-synthetic',now=NOW)['ok']
        if change=='expired':at+=61
        rejected=call(worker,'outbox-dispatch',id=batch['id'],now=at)
        assert rejected['code']==('delivery_unknown' if change=='expired' else 'stale_epoch'),rejected
        assert call(worker,'delivery-state')['result'][0]['payload']==batch['items'][0]['payload']


def test_native_another_complete_capture_does_not_invalidate_the_frozen_intent(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=prepared_history(worker);batch=prepare(worker)['result']
        capture(worker,connection,[record('bank-0'),record('new-bank',amount='200')])
        granted=call(worker,'outbox-dispatch',id=batch['id'],now=NOW);assert granted['ok'],granted
        assert granted['result']['items']==batch['items']


def test_native_concurrent_preparation_and_dispatch_grant_only_one_writer(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        prepared_history(worker)
        replies=worker.evaluate('args=>Promise.all([mirrorProbe.run("outbox-prepare",args),mirrorProbe.run("outbox-prepare",args)])',dict(name='l6-mirror',now=NOW))
        assert sorted(row['ok'] for row in replies)==[False,True],replies
        batch=next(row['result'] for row in replies if row['ok'])
        grants=worker.evaluate('args=>Promise.all([mirrorProbe.run("outbox-dispatch",args),mirrorProbe.run("outbox-dispatch",args)])',dict(name='l6-mirror',now=NOW,id=batch['id']))
        assert sorted(row['ok'] for row in grants)==[False,True],grants
        assert next(row['code'] for row in grants if not row['ok'])=='delivery_unknown'
        evidence=call(worker,'outbox-evidence',now=NOW)['result'];assert len(evidence['attempts'])==len(evidence['deliveries'])==1


@pytest.mark.parametrize('result,state',[('present','delivered'),('deleted','suppressed'),('absent','uncertain')])
def test_native_uncertain_payload_is_only_verified_and_never_recreated(tmp_path,result,state):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        prepared_history(worker);batch=prepare(worker)['result'];item=batch['items'][0]
        assert call(worker,'outbox-dispatch',id=batch['id'],now=NOW)['ok']
        assert call(worker,'outbox-finish',id=batch['id'],now=NOW)['ok']
        raw=dict(serverTimestamp=101,transaction=[])
        if result=='present':raw['transaction']=[remote(item['zen_id'],amount=999,viewed=True)]
        if result=='deleted':raw['deletion']=[dict(object='transaction',id=item['zen_id'])]
        assert call(worker,'refresh',raw=json.dumps(raw),now=NOW)['ok']
        retry=prepare(worker);assert retry['ok'] and retry['result'] is None,retry
        saved=call(worker,'delivery-state')['result'][0];assert saved['zen_id']==item['zen_id'] and saved['payload']==item['payload'] and saved['state']==state,saved
        assert len(call(worker,'outbox-evidence',now=NOW)['result']['attempts'])==2
