"""Local account configuration keeps catalog/version/history safety gates."""
from playwright.sync_api import sync_playwright
import pytest
from test_runtime import installed
from test_mirror import ready,call
from test_connections import discovery


def account(worker):
    ready(worker)
    result=call(worker,'connections-discover',data=discovery());assert result['ok'],result
    return result['result']['accounts'][0]


def configure(worker,id,version=0,selection='enabled',target='a',start='1970-01-01',**options):
    return call(worker,'accounts-configure',id=id,data=dict(expected_version=version,selection=selection,zenmoney_account_id=target,import_start=start),**options)


def test_native_settings_are_versioned_and_repeated_ack_is_idempotent(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        a=account(worker);saved=configure(worker,a['id']);assert saved['ok'],saved
        assert saved['result']['settings_version']=='1' and saved['result']['selection']=='enabled'
        assert configure(worker,a['id'])['result']==saved['result']
        assert configure(worker,a['id'],selection='ignored',target=None,start=None)['code']=='settings_conflict'
        ignored=configure(worker,a['id'],1,'ignored',None,None);assert ignored['ok'],ignored
        assert ignored['result']['settings_version']=='2'
        enabled=configure(worker,a['id'],2);assert enabled['ok'] and enabled['result']['settings_version']=='3',enabled


def test_native_missing_stale_and_wrong_currency_targets_cannot_be_selected(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        a=account(worker)
        assert configure(worker,a['id'],target='missing')['code']=='zenmoney_account_unavailable'
        assert configure(worker,a['id'],start='2026-10-21')['code']=='validation_error'
        assert configure(worker,a['id'],now=1301)['code']=='zenmoney_unavailable'
        refreshed=call(worker,'refresh',raw='{"serverTimestamp":101,"account":[{"id":"usd","instrument":3,"type":"checking"}],"instrument":[{"id":3,"shortTitle":"USD"}]}');assert refreshed['ok'],refreshed
        assert configure(worker,a['id'],target='usd')['code']=='zenmoney_account_unavailable'
        assert configure(worker,a['id'])['ok']


@pytest.mark.parametrize('mode',['uncertain','attempted-prepared'])
def test_native_old_binding_with_uncertain_delivery_blocks_target_change_even_after_ignoring(tmp_path,mode):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        a=account(worker);assert configure(worker,a['id'])['ok']
        seeded=call(worker,'seed-predictions',size=1,accountId=a['id']);assert seeded['ok'],seeded
        seeded=call(worker,'seed-delivery',mode=mode);assert seeded['ok'],seeded
        original=call(worker,'delivery-state')['result']
        assert configure(worker,a['id'],1,'ignored',None,None)['ok']
        assert call(worker,'refresh',raw='{"serverTimestamp":101,"account":[{"id":"b","instrument":2,"type":"checking"}]}')['ok']
        changed=configure(worker,a['id'],2,target='b');assert changed['code']=='delivery_uncertain',changed
        # Restoring the same historical target remains permitted.
        assert configure(worker,a['id'],2)['ok']
        assert call(worker,'delivery-state')['result']==original


def test_native_large_account_rebind_invalidates_only_unattempted_prepared_rows_atomically(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        a=account(worker);assert configure(worker,a['id'])['ok']
        seeded=call(worker,'seed-predictions',size=100000,accountId=a['id'],mode='prepared',summary=True);assert seeded['ok'],seeded
        assert seeded['maxTransactionMs']<10000
        saved=configure(worker,a['id'],1,'ignored',None,None,summary=True);assert saved['ok'],saved
        assert saved['result']['settings_version']=='2' and saved['maxTransactionMs']<10000,saved['maxTransactionMs']
        rows=call(worker,'delivery-state',summary=True)['result'];assert len(rows)==100000
        assert all(row['state']=='prepared' and row['ever_attempted']=='0' and row['needs_rebuild']=='1' and row['authorized_job_id'] is None for row in rows)


def test_native_maximum_settings_version_fails_before_acquiring_hold(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        a=account(worker);assert call(worker,'seed-account-version',id=a['id'],version='9223372036854775807')['ok']
        failed=configure(worker,a['id'],version='9223372036854775807',selection='ignored',target=None,start=None)
        assert failed['code']=='settings_conflict',failed
        assert call(worker,'accounts-state')['result']['dataset']['holdId'] is None
        assert call(worker,'connections-list')['ok']


def test_native_identical_concurrent_settings_share_one_terminal_receipt(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        a=account(worker)
        result=call(worker,'accounts-concurrent',id=a['id'],data=dict(expected_version=0,selection='enabled',zenmoney_account_id='a',import_start='1970-01-01'))
        assert result['ok'],result
        left,right=result['result'];assert left['status']==right['status']=='fulfilled',result
        assert left['value']==right['value'] and left['value']['settings_version']=='1'


@pytest.mark.parametrize('mode',['pause-settings','quota-settings'])
def test_native_settings_resume_after_worker_death_or_quota_without_losing_hold(tmp_path,mode):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (context,worker,page,_):
        a=account(worker);assert configure(worker,a['id'])['ok']
        assert call(worker,'seed-predictions',size=1000,accountId=a['id'],mode='prepared',summary=True)['ok']
        data=dict(expected_version=1,selection='ignored',zenmoney_account_id=None,import_start=None)
        if mode=='quota-settings':
            failed=call(worker,'accounts-configure',id=a['id'],data=data,mode=mode,summary=True);assert failed['code']=='quota_exceeded',failed
        else:
            worker.evaluate('args=>{globalThis.pendingSettings=mirrorProbe.run("accounts-configure",args);return true;}',dict(name='l6-mirror',id=a['id'],data=data,mode=mode,summary=True))
            for _ in range(300):
                if worker.evaluate('mirrorProbe.checkpoint()'):break
                page.wait_for_timeout(20)
            assert worker.evaluate('mirrorProbe.checkpoint()')
        state=call(worker,'accounts-state');assert state['result']['dataset']['holdId'] and state['result']['operation']['phase']=='invalidate'
        assert call(worker,'connections-list')['code']=='dataset_not_writable'
        session=context.new_cdp_session(page)
        target=next(row for row in session.send('Target.getTargets')['targetInfos'] if row['url']==worker.url and row['type']=='service_worker')
        assert session.send('Target.closeTarget',dict(targetId=target['targetId']))['success']
        assert page.evaluate('()=>chrome.runtime.sendMessage({type:"probe-wake"})')
        recovered=call(page,'accounts-concurrent',id=a['id'],data=data,mode='recover',summary=True);assert recovered['ok'],recovered
        left,right=recovered['result'];assert left['status']==right['status']=='fulfilled',recovered
        assert left['value']==right['value'] and left['value']['settings_version']=='2'
        assert call(page,'accounts-state')['result']['dataset']['holdId'] is None
        assert all(row['needs_rebuild']=='1' for row in call(page,'delivery-state')['result'])


def test_startup_recovery_without_settings_hold_is_read_only_on_fresh_and_imported_copies(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        initial=call(worker,'init');assert initial['ok'] and not initial['root']['financialMayHaveStarted']
        before=call(worker,'accounts-state')['result']
        recovered=call(worker,'accounts-recover');assert recovered['ok'] and recovered['result'] is None,recovered
        assert call(worker,'accounts-state')['result']==before
        assert call(worker,'status')['sentinel']==initial['sentinel']
        ready(worker);assert call(worker,'awaiting')['ok']
        before=call(worker,'accounts-state')['result']
        # This synthetic imported copy deliberately has no local-import-setup permit.
        recovered=call(worker,'accounts-recover');assert recovered['ok'] and recovered['result'] is None,recovered
        assert call(worker,'accounts-state')['result']==before
        assert call(worker,'write-fences')['result']==['dataset_not_writable','dataset_not_writable']
