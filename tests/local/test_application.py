"""Real IDB Root/remote checkpoint upgrades, without network or financial writes."""
from playwright.sync_api import sync_playwright
from test_runtime import installed


def call(worker,action,**args):
    return worker.evaluate('data=>applicationProbe.run(data.action,data.args)',dict(action=action,args=dict(name='l5-application',**args)))


def test_native_remote_upgrade_retains_unknown_start_across_full_browser_restart(tmp_path):
    extension,profile=tmp_path/'extension',tmp_path/'profile';capture=dict(phase='planned',command=dict(request_id='unknown-ack'))
    with sync_playwright() as p:
        with installed(p,extension,profile) as (_,worker,_,identifier):
            initial=call(worker,'legacy',patch=dict(capture=capture,view=dict(connection=dict(id='old-connection'))));assert initial['ok'],initial
            assert initial['root']['activeMode']=='remote' and initial['root']['activeGeneration'] is None
            assert initial['datasets'][0]['lifecycle']=='retired' and sum(initial['financialRows'])==0
            assert initial['reads']==0 and initial['state']['capture']==capture
            offline=call(worker,'catalog',mode='offline');assert offline==dict(ok=False,code='backend_unavailable')
        with installed(p,extension,profile,known_id=identifier) as (_,worker,_,_):
            reopened=call(worker,'status');assert reopened['ok'],reopened
            assert reopened['root']==initial['root'] and reopened['context']['dataset_id']==initial['context']['dataset_id']
            assert reopened['state']['capture']==capture and sum(reopened['financialRows'])==0


def test_native_remote_selection_scopes_checkpoints_and_storage_loss_never_creates_a_local_writer(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        initial=call(worker,'legacy',url='https://a.invalid',patch=dict(capture=dict(phase='complete',job=dict(id='old-job'))));assert initial['ok']
        changed=call(worker,'configure',url='https://b.invalid');assert changed['ok'],changed
        assert changed['context']['dataset_id']!=initial['context']['dataset_id'] and changed['context']['mode_epoch']=='2'
        assert changed['state']['capture'] is None and len(changed['states'])==2
        assert sum(changed['financialRows'])==0
        assert call(worker,'delete-db')['ok']
        assert call(worker,'status')==dict(ok=False,code='recovery_required')


def test_native_missing_secret_keeps_nonsecret_context_and_allows_explicit_token_repair(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        capture=dict(phase='paused',command=dict(request_id='unknown-ack'))
        initial=call(worker,'legacy',patch=dict(capture=capture));assert initial['ok']
        worker.evaluate('ref=>chrome.storage.local.remove("l5-runtime:l5-application:remoteCredential:"+ref)',initial['root']['credentialRef'])
        missing=call(worker,'status');assert missing['ok'] and not missing['configured']
        assert missing['context']['dataset_id']==initial['context']['dataset_id'] and missing['state']['capture']==capture
        assert call(worker,'catalog')==dict(ok=False,code='unauthorized')
        repaired=call(worker,'configure',url='https://fixture.invalid');assert repaired['ok'] and repaired['configured']
        assert repaired['context']['dataset_id']==initial['context']['dataset_id'] and repaired['state']['capture']==capture
