"""Native financial-store bootstrap/loss detection. No SDK request or bank session."""
from playwright.sync_api import sync_playwright
from test_runtime import installed,message


def call(page,action,name='l4-financial',**fields):
    return message(page,dict(type='storage-probe',action=action,args=dict(name=name,**fields)))


def test_native_initialization_has_49_scoped_financial_stores_and_acknowledged_marker(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,_,page,_):
        result=call(page,'open');assert result['ok'],result
        value=result['value'];assert value['state']['tables']==49
        assert sum(value['state']['rows'].values())==3
        assert value['context']['epoch']=='1'
        snapshot=call(page,'state')['value']
        assert snapshot['marker']['state']=='ready'
        assert snapshot['runtime']['installationId']==snapshot['marker']['installationId']
        assert snapshot['datasets'][0]['participantId']!=snapshot['marker']['installationId']
        assert snapshot['datasets'][0]['datasetId']==snapshot['marker']['datasetId']
        assert snapshot['tableCount']==57
        assert not snapshot['marker']['financialMayHaveStarted']


def test_native_concurrent_open_and_profile_restart_do_not_create_another_dataset(tmp_path):
    extension,profile=tmp_path/'extension',tmp_path/'profile'
    with sync_playwright() as p:
        with installed(p,extension,profile) as (_,_,page,identifier):
            result=call(page,'concurrent');assert result['ok'],result
            first,second=result['value'];assert first['context']==second['context']
            original=call(page,'state')['value']
        with installed(p,extension,profile,known_id=identifier) as (_,_,page,_):
            assert call(page,'open')['ok']
            assert call(page,'state')['value']==original


def test_native_loss_after_activity_and_token_removal_never_bootstraps_an_empty_journal(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,page,_):
        assert call(page,'open')['ok']
        assert call(page,'mark')['ok']
        # Credential removal is independent of the marker and financial stores.
        worker.evaluate('async()=>{await chrome.storage.local.set({localZenMoneyCredentials:"synthetic-credential"});await chrome.storage.local.remove("localZenMoneyCredentials");}')
        assert call(page,'delete')['ok']
        assert call(page,'open')=={'ok':False,'code':'recovery_required'}
        current=call(page,'state')['value']
        assert not current['exists'] and current['marker']['financialMayHaveStarted']


def test_native_ready_ack_failure_leaves_an_explicit_recovery_state(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,_,page,_):
        assert call(page,'open',mode='fail-ready')=={'ok':False,'code':'quota_exceeded'}
        first=call(page,'state')['value']
        assert first['exists'] and first['marker']['state']=='initializing'
        assert call(page,'open')=={'ok':False,'code':'recovery_required'}
        assert call(page,'state')['value']==first


def test_native_worker_death_after_marker_before_idb_cannot_be_mistaken_for_first_install(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (context,worker,page,_):
        worker.evaluate("()=>{globalThis.opening=storageProbe.run('open',{name:'l4-financial',mode:'pause-after-sentinel'});return true;}")
        for _ in range(100):
            if call(page,'checkpoint').get('value') is True:break
            page.wait_for_timeout(20)
        assert call(page,'checkpoint')=={'ok':True,'value':True}
        before=call(page,'state')['value']
        assert not before['exists'] and before['marker']['state']=='initializing'
        session=context.new_cdp_session(page)
        target=next(target for target in session.send('Target.getTargets')['targetInfos'] if target['url']==worker.url and target['type']=='service_worker')
        assert session.send('Target.closeTarget',{'targetId':target['targetId']})['success']
        assert call(page,'open')=={'ok':False,'code':'recovery_required'}
        current=call(page,'state')['value']
        assert not current['exists'] and current['marker']['state']=='initializing'


def test_native_stale_activity_fence_is_conservative_and_never_changes_control(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,_,page,_):
        original=call(page,'open')['value']
        fence=original['context']|{'epoch':'2'}
        assert call(page,'mark',fence=fence)=={'ok':False,'code':'stale_epoch'}
        state=call(page,'state')['value']
        assert state['marker']['financialMayHaveStarted']
        assert not state['runtime']['financialMayHaveStarted']
        assert state['runtime']['epoch']=='1'
