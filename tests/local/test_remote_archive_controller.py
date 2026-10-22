"""Privileged archive saga against the actual isolated Python server."""
from base64 import b64encode
from hashlib import sha256
from uuid import uuid4
import pytest
pytest.importorskip('backend')
from backend import portable_codec as codec,storage
from delivery_factory import DeliveryHarness
from capture_factory import TOKEN
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_authority import ok,FIXTURE
from test_migration_remote import server

NAME='archive-saga'


def archive(tmp_path):
    path=tmp_path/'controlled.zip'
    rows={name:[[codec.unscalar(value) for value in row] for row in values] for name,values in FIXTURE['rows'].items()}
    codec.create_archive(path,rows,dataset_id=FIXTURE['dataset_id'],owners=['1'],session_id=str(uuid4()),archive_id=str(uuid4()),
        created_at='2026-10-21T00:00:00Z',version='isolated-archive-controller')
    return path.read_bytes()


def prepare(worker,url,raw):
    ok(worker,'create')
    candidate=ok(worker,'transfer-candidate',url=url,token=TOKEN)
    initial=ok(worker,'create-remote',NAME,credentialRef=candidate['ref'],url=url,peerId=candidate['contextId'])['root']
    ok(worker,'bind-remote',NAME,request=dict(installationId=candidate['identity']['installation_id'],datasetId=candidate['identity']['dataset_id']))
    id=str(uuid4());file=ok(worker,'file-begin',NAME,requestId=id,count=len(raw),checksum=sha256(raw).hexdigest())
    for number,start in enumerate(range(0,len(raw),262144)):
        ok(worker,'file-put',NAME,requestId=id,peerId=file['nonce'],number=number,base64=b64encode(raw[start:start+262144]).decode())
    ok(worker,'file-seal',NAME,requestId=id)
    ok(worker,'remote-recovery-begin',NAME,requestId=id)
    held=ok(worker,'current',NAME)['root'];assert held['pendingSwitchId']==id and held['epoch']!=initial['epoch']
    return id,initial,candidate['identity']


def advance(worker,page,id,phase):
    for _ in range(200):
        result=ok(worker,'remote-recovery-step',NAME,requestId=id)
        assert result['state']!='blocked',result
        if result['state']==phase:return result
        page.wait_for_timeout(30)
    pytest.fail(str(result))


def test_remote_archive_controller_resumes_lost_begin_and_durable_consent_after_browser_restart(tmp_path):
    raw=archive(tmp_path);target=DeliveryHarness(tmp_path/'target.sqlite3');target.app.state.archives.start()
    path,profile=tmp_path/'extension',tmp_path/'profile'
    try:
        with server(target) as url,sync_playwright() as p:
            with installed(p,path,profile,hosts=('http://127.0.0.1/*',)) as (_,worker,page,identifier):
                id,initial,identity=prepare(worker,url,raw)
                lost=ok(worker,'remote-recovery-step',NAME,requestId=id,mode='lose-begin')
                assert lost['state']=='blocked' and lost['error']=='backend_unavailable'
                assert target.app.state.archives.status(id)['phase']=='uploading'
                summary=advance(worker,page,id,'preview')
                assert summary['preview']['archive_sha256']==sha256(raw).hexdigest()
                assert target.app.state.portable.capabilities()['dataset_id']==identity['dataset_id']
                assert not target.remote.writes
                ok(worker,'remote-recovery-accept',NAME,requestId=id,peerId=summary['preview']['id'])
            with installed(p,path,profile,known_id=identifier) as (_,worker,page,_):
                ok(worker,'open',NAME)
                result=advance(worker,page,id,'complete');assert result['phase']=='activated'
                selected=ok(worker,'current',NAME)['root'];descriptor=ok(worker,'remote-context',NAME)
                assert selected['pendingSwitchId'] is None and selected['credentialRef']!=initial['credentialRef']
                assert descriptor['datasetId']==FIXTURE['dataset_id'] and descriptor['contextId']!=identity['dataset_id']
                assert ok(worker,'remote-recovery-ordinary',NAME)['accounts']
                assert target.app.state.portable.capabilities()['awaiting_sync']
                assert ok(worker,'file-status',NAME,requestId=id)['phase']=='cleaned'
                ok(worker,'file-begin',NAME,requestId=str(uuid4()),count=len(raw),checksum=sha256(raw).hexdigest())
                with storage.transaction(target.path,read_only=True) as db:
                    assert db.execute('SELECT count(*) FROM archive_records WHERE kind=\'recovery\'').fetchone()[0]==1
                    assert not target.app.state.archives._cache_pending(db)
                    assert db.execute('SELECT count(*) FROM bank_transactions').fetchone()[0]==len(FIXTURE['rows']['bank_transactions'])
                assert not target.remote.writes
    finally:target.close()


@pytest.mark.parametrize('failure',['history_started','epoch_advanced'])
def test_rejected_begin_withdraws_without_losing_the_original_route(tmp_path,failure):
    raw=archive(tmp_path);target=DeliveryHarness(tmp_path/'target.sqlite3')
    try:
        with server(target) as url,sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (_,worker,_,_):
            id,initial,identity=prepare(worker,url,raw)
            if failure=='history_started':target.capture(count=1)
            else:
                with storage.transaction(target.path) as db:db.execute('UPDATE migration_installation SET participant_epoch=participant_epoch+1 WHERE id=1')
            before=target.app.state.portable.capabilities()
            refused=ok(worker,'remote-recovery-step',NAME,requestId=id)
            assert refused['state']=='blocked' and refused['error'] in ('migration_not_empty','migration_busy'),refused
            assert ok(worker,'remote-recovery-current',NAME)['error']==refused['error']
            cancelled=ok(worker,'remote-recovery-cancel',NAME,requestId=id);assert cancelled['phase']=='cancelled'
            after=ok(worker,'current',NAME)['root']
            assert after['pendingSwitchId'] is None and after['credentialRef']==initial['credentialRef']
            assert ok(worker,'remote-context',NAME)['datasetId']==identity['dataset_id']
            assert target.app.state.portable.capabilities()==before
            assert target.app.state.archives.status(id)['phase']=='cleaned' and not target.remote.writes
    finally:target.close()


def test_remote_activation_with_native_quota_failure_retries_binding_without_reimport(tmp_path):
    raw=archive(tmp_path);target=DeliveryHarness(tmp_path/'target.sqlite3');target.app.state.archives.start()
    try:
        with server(target) as url,sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (_,worker,page,_):
            id,_,_=prepare(worker,url,raw);summary=advance(worker,page,id,'preview')
            ok(worker,'remote-recovery-accept',NAME,requestId=id,peerId=summary['preview']['id'])
            sent=ok(worker,'remote-recovery-step',NAME,requestId=id);assert sent['state']=='working'
            assert target.app.state.archives.status(id)['phase']=='activated'
            held=ok(worker,'current',NAME)['root']
            failed=ok(worker,'remote-recovery-step',NAME,requestId=id,mode='quota-selection');assert failed['state']=='blocked'
            assert ok(worker,'current',NAME)['root']==held
            assert advance(worker,page,id,'complete')['phase']=='activated'
            assert ok(worker,'remote-recovery-ordinary',NAME)['accounts']
            assert not target.remote.writes
    finally:target.close()


def test_lost_cancellation_after_acceptance_survives_browser_restart_without_activation(tmp_path):
    raw=archive(tmp_path);target=DeliveryHarness(tmp_path/'target.sqlite3');target.app.state.archives.start()
    path,profile=tmp_path/'extension',tmp_path/'profile'
    try:
        with server(target) as url,sync_playwright() as p:
            with installed(p,path,profile,hosts=('http://127.0.0.1/*',)) as (_,worker,page,identifier):
                id,initial,_=prepare(worker,url,raw);summary=advance(worker,page,id,'preview')
                ok(worker,'remote-recovery-accept',NAME,requestId=id,peerId=summary['preview']['id'])
                result=ok(worker,'remote-recovery-cancel',NAME,requestId=id,mode='fail-withdraw')
                assert result['state']=='blocked' and result['cancelRequested']
                assert target.app.state.archives.status(id)['phase']=='preview'
            with installed(p,path,profile,known_id=identifier) as (_,worker,page,_):
                ok(worker,'open',NAME);cancelled=advance(worker,page,id,'complete')
                assert cancelled['phase']=='cancelled'
                assert ok(worker,'current',NAME)['root']['credentialRef']==initial['credentialRef']
                assert target.app.state.archives.status(id)['phase']=='cleaned'
                assert ok(worker,'file-status',NAME,requestId=id)['phase']=='cleaned'
                with storage.transaction(target.path,read_only=True) as db:
                    assert db.execute('SELECT count(*) FROM bank_transactions').fetchone()[0]==0
                    assert not target.app.state.archives._cache_pending(db)
                assert not target.remote.writes
    finally:target.close()


def test_revoked_consent_blocks_a_paused_old_activation_step_at_native_dispatch(tmp_path):
    from test_authority import checkpoint,call as authority_call
    raw=archive(tmp_path);target=DeliveryHarness(tmp_path/'target.sqlite3');target.app.state.archives.start()
    try:
        with server(target) as url,sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (_,worker,page,_):
            id,_,_=prepare(worker,url,raw);summary=advance(worker,page,id,'preview')
            ok(worker,'remote-recovery-accept',NAME,requestId=id,peerId=summary['preview']['id'])
            worker.evaluate('data=>{globalThis.oldArchiveStep=authorityProbe.run("remote-recovery-step",data);return true;}',dict(name=NAME,requestId=id,mode='pause-preview-status'))
            checkpoint(worker,page)
            revoked=authority_call(worker,'remote-recovery-retry',NAME,requestId=id,mode='fail-finalize')
            # Explicit refresh cleared consent before its failed HTTP finalize.
            assert not revoked['ok'] and revoked['code']=='backend_unavailable',revoked
            ok(worker,'release',NAME);stale=worker.evaluate('()=>globalThis.oldArchiveStep')
            assert stale['ok'] and stale['value']['state']=='blocked' and not stale['value']['activationStarted'],stale
            assert target.app.state.archives.status(id)['phase']=='preview'
            assert ok(worker,'remote-recovery-step',NAME,requestId=id)['state']=='preview'
            assert not target.remote.writes
    finally:target.close()


def test_unknown_activation_cannot_revoke_its_dispatch_and_is_recovered_forward(tmp_path):
    from test_authority import call as authority_call
    raw=archive(tmp_path);target=DeliveryHarness(tmp_path/'target.sqlite3');target.app.state.archives.start()
    try:
        with server(target) as url,sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (_,worker,page,_):
            id,_,_=prepare(worker,url,raw);summary=advance(worker,page,id,'preview')
            ok(worker,'remote-recovery-accept',NAME,requestId=id,peerId=summary['preview']['id'])
            lost=ok(worker,'remote-recovery-step',NAME,requestId=id,mode='lose-activate')
            assert lost['state']=='blocked' and target.app.state.archives.status(id)['phase']=='activated'
            recovered=ok(worker,'remote-recovery-retry',NAME,requestId=id,mode='refresh-preview')
            assert recovered['phase']=='activated'
            # A cancellation requested after the unknown committed activation can
            # only recover the permanent outcome forward, never undo the import.
            result=ok(worker,'remote-recovery-cancel',NAME,requestId=id);assert result['phase']=='activated'
            assert advance(worker,page,id,'complete')['phase']=='activated'
            assert ok(worker,'remote-recovery-ordinary',NAME)['accounts'] and not target.remote.writes
    finally:target.close()


@pytest.mark.parametrize('expiry',['before-consent','after-dispatch'])
def test_expired_preview_rebuilds_without_reupload_and_requires_new_consent(tmp_path,expiry):
    raw=archive(tmp_path);target=DeliveryHarness(tmp_path/'target.sqlite3');target.app.state.archives.start()
    try:
        with server(target) as url,sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (_,worker,page,_):
            id,_,_=prepare(worker,url,raw);summary=advance(worker,page,id,'preview');old=summary['preview']['id']
            if expiry=='after-dispatch':
                ok(worker,'remote-recovery-accept',NAME,requestId=id,peerId=old)
                target.now+=301
                blocked=ok(worker,'remote-recovery-step',NAME,requestId=id)
                assert blocked['state']=='blocked' and blocked['error']=='migration_wrong_account'
                assert ok(worker,'remote-recovery-current',NAME)['activationStarted']
                ok(worker,'remote-recovery-retry',NAME,requestId=id)
            else:
                target.now+=301
                ok(worker,'remote-recovery-accept',NAME,requestId=id,peerId=old)
                assert not ok(worker,'remote-recovery-current',NAME)['activationStarted']
            fresh=advance(worker,page,id,'preview')
            assert fresh['preview']['id']!=old and fresh['awaitingConfirmation'] and not fresh['activationStarted']
            assert target.app.state.archives.status(id)['phase']=='preview'
            assert ok(worker,'current',NAME)['root']['pendingSwitchId']==id
            # A late callback carrying the retired preview cannot activate it.
            rejected=target.client.post('/api/v1/migration/archives/'+id+'/activate',json=dict(preview_id=old,accept_summary=True))
            assert rejected.status_code==409
            ok(worker,'remote-recovery-accept',NAME,requestId=id,peerId=fresh['preview']['id'])
            assert advance(worker,page,id,'complete')['phase']=='activated'
            with storage.transaction(target.path,read_only=True) as db:
                assert db.execute("SELECT count(*) FROM archive_records WHERE kind='recovery'").fetchone()[0]==1
            assert not target.remote.writes
    finally:target.close()


@pytest.mark.parametrize('stage',['upload','activated','cancelled'])
def test_replacement_server_token_resumes_same_recovery_and_terminal_cleanup(tmp_path,stage):
    from test_migration_remote import rotate_server_token
    from test_authority import call as authority_call
    raw=archive(tmp_path);target=DeliveryHarness(tmp_path/'target.sqlite3');target.app.state.archives.start()
    try:
        with server(target) as url,sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (_,worker,page,_):
            id,_,_=prepare(worker,url,raw)
            if stage=='activated':
                preview=advance(worker,page,id,'preview')
                ok(worker,'remote-recovery-accept',NAME,requestId=id,peerId=preview['preview']['id'])
                advance(worker,page,id,'cleaning')
            elif stage=='cancelled':
                ok(worker,'remote-recovery-cancel',NAME,requestId=id)
            root=ok(worker,'current',NAME)['root']
            token='rotated-synthetic-recovery-token'
            rotate_server_token(target,token)
            blocked=ok(worker,'remote-recovery-step',NAME,requestId=id)
            assert blocked['state']=='blocked' and blocked['error']=='unauthorized',blocked
            denied=authority_call(worker,'remote-recovery-repair',NAME,requestId=id,token='wrong-synthetic-token')
            assert not denied['ok'] and denied['code']=='unauthorized',denied
            assert ok(worker,'remote-recovery-repair',NAME,requestId=id,token=token)['repaired']
            assert ok(worker,'current',NAME)['root']==root
            if stage=='upload':
                preview=advance(worker,page,id,'preview')
                ok(worker,'remote-recovery-accept',NAME,requestId=id,peerId=preview['preview']['id'])
            if stage=='activated':
                ok(worker,'remote-recovery-step',NAME,requestId=id)
                rotate_server_token(target,token+'-again')
                assert ok(worker,'remote-recovery-repair',NAME,requestId=id,token=token+'-again')['repaired']
            result=advance(worker,page,id,'complete')
            assert result['phase']==('cancelled' if stage=='cancelled' else 'activated')
            assert ok(worker,'file-status',NAME,requestId=id)['phase']=='cleaned'
            if stage!='cancelled':assert ok(worker,'remote-recovery-ordinary',NAME)['accounts']
            assert not target.remote.writes
    finally:target.close()
