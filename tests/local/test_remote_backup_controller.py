"""Resumable snapshot export against actual isolated Python; no live API."""
from base64 import b64decode
from hashlib import sha256
from uuid import uuid4
import pytest
pytest.importorskip('backend')
from backend import storage,portable_codec as codec,portable_graph as graph
from delivery_factory import DeliveryHarness
from capture_factory import TOKEN
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_authority import ok,call,checkpoint
from test_migration_remote import server

NAME='remote-backup-saga'


def fixture(tmp_path):
    target=DeliveryHarness(tmp_path/'target.sqlite3')
    job,*_=target.capture(count=2);target.due();target.client.post('/api/v1/jobs/'+job['id']+'/stop',json={})
    with storage.transaction(target.path) as db:db.execute("DELETE FROM service_meta WHERE key='fixture-network-write-lock-free'")
    return target


def prepare(worker,url):
    ok(worker,'create');candidate=ok(worker,'transfer-candidate',url=url,token=TOKEN)
    ok(worker,'create-remote',NAME,credentialRef=candidate['ref'],url=url,peerId=candidate['contextId'])
    ok(worker,'bind-remote',NAME,request=dict(installationId=candidate['identity']['installation_id'],datasetId=candidate['identity']['dataset_id']))
    return candidate


def advance(worker,page,id,state):
    for _ in range(200):
        value=ok(worker,'remote-backup-step',NAME,requestId=id)
        assert value['state']!='blocked',value
        if value['state']==state:return value
        page.wait_for_timeout(30)
    pytest.fail(str(value))


def test_remote_backup_resumes_lost_begin_and_ack_after_chrome_restart(tmp_path):
    target=fixture(tmp_path);target.app.state.archives.start();writes=len(target.remote.writes)
    ext,profile=tmp_path/'ext',tmp_path/'profile'
    try:
        with server(target) as url,sync_playwright() as p:
            with installed(p,ext,profile,hosts=('http://127.0.0.1/*',)) as (_,worker,page,identifier):
                prepare(worker,url);root=ok(worker,'current',NAME)['root'];id=str(uuid4())
                ok(worker,'remote-backup-begin',NAME,requestId=id)
                lost=ok(worker,'remote-backup-step',NAME,requestId=id,mode='lose-begin')
                assert lost['state']=='blocked' and lost['error']=='backend_unavailable'
            with installed(p,ext,profile,known_id=identifier) as (_,worker,page,_):
                ok(worker,'open',NAME);ready=advance(worker,page,id,'download')
                assert target.app.state.portable.capabilities()['state']=='active'
                selected=ok(worker,'current',NAME)['root'];assert selected==root|dict(financialMayHaveStarted=True)
                raw=b''.join(b64decode(ok(worker,'remote-backup-chunk',NAME,requestId=id,number=n)) for n in range(int(ready['chunks'])))
                assert sha256(raw).hexdigest()==ready['sha256'] and len(raw)==int(ready['bytes'])
                file=tmp_path/'download.zip';file.write_bytes(raw);stage=codec.read_archive(file,tmp_path/'checked');graph.validate_stage(stage)
                assert len(list(stage.rows('bank_transactions')))==2
                assert target.app.state.archives.status(id)['acknowledged_at'] is None
                ok(worker,'remote-backup-ack',NAME,requestId=id,checksum=ready['sha256'])
                lost=ok(worker,'remote-backup-step',NAME,requestId=id,mode='lose-ack')
                assert lost['error']=='backend_unavailable'
            with installed(p,ext,profile,known_id=identifier) as (_,worker,page,_):
                ok(worker,'open',NAME);result=advance(worker,page,id,'complete')
                assert result['decision']=='downloaded' and target.app.state.archives.status(id)['phase']=='cleaned'
                assert ok(worker,'file-current',NAME)['phase']=='cleaned'
                assert len(target.remote.writes)==writes
    finally:target.close()


@pytest.mark.parametrize('phase',['unused','building','ready','stale'])
def test_remote_backup_cancel_never_needs_a_fake_download_ack(tmp_path,phase):
    target=fixture(tmp_path);writes=len(target.remote.writes)
    try:
        with server(target) as url,sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (_,worker,page,_):
            prepare(worker,url);id=str(uuid4());ok(worker,'remote-backup-begin',NAME,requestId=id)
            if phase=='stale':
                with storage.transaction(target.path) as db:db.execute('UPDATE migration_installation SET participant_epoch=participant_epoch+1 WHERE id=1')
                rejected=ok(worker,'remote-backup-step',NAME,requestId=id);assert rejected['state']=='blocked'
            if phase in ('building','ready'):
                ok(worker,'remote-backup-step',NAME,requestId=id)
                if phase=='ready':target.app.state.archives.start();advance(worker,page,id,'download')
            ok(worker,'remote-backup-cancel',NAME,requestId=id)
            offline=ok(worker,'remote-backup-step',NAME,requestId=id,mode='fail-withdraw');assert offline['error']=='backend_unavailable'
            result=advance(worker,page,id,'complete');assert result['decision']=='withdrawn'
            assert target.app.state.archives.status(id)['phase']=='cleaned'
            assert target.app.state.archives.status(id)['acknowledged_at'] is None
            assert target.app.state.portable.capabilities()['state']=='active' and len(target.remote.writes)==writes
    finally:target.close()


def test_pending_export_blocks_file_replacement_and_mode_start_but_allows_token_repair(tmp_path):
    target=fixture(tmp_path)
    try:
        with server(target) as url,sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (_,worker,page,_):
            prepare(worker,url);id=str(uuid4());ok(worker,'remote-backup-begin',NAME,requestId=id)
            ok(worker,'remote-backup-step',NAME,requestId=id);assert target.app.state.archives.run_once()
            # A delayed byte response must be rejected after the selected token epoch changes.
            worker.evaluate("data=>{globalThis.oldBackup=authorityProbe.run('remote-backup-step',data);return true;}",dict(name=NAME,requestId=id,mode='pause-download'))
            checkpoint(worker,page)
            assert call(worker,'file-cancel',NAME,requestId=id)['code']=='migration_paused'
            assert call(worker,'file-begin',NAME,requestId=str(uuid4()),count=1,checksum='a'*64)['code']=='migration_paused'
            assert call(worker,'transfer-to-browser',NAME)['code']=='migration_busy'
            repaired=ok(worker,'remote-backup-repair',NAME,url=url,token=TOKEN)
            ok(worker,'release');assert worker.evaluate('()=>globalThis.oldBackup')['code']=='stale_context'
            ready=advance(worker,page,id,'download');assert ready['sha256']
            assert ok(worker,'current',NAME)['root']==repaired
            ok(worker,'remote-backup-cancel',NAME,requestId=id);advance(worker,page,id,'complete')
    finally:target.close()


def test_missing_backup_withdrawal_support_does_not_save_a_begin_intent(tmp_path):
    target=fixture(tmp_path)
    try:
        with server(target) as url,sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (_,worker,_,_):
            prepare(worker,url);before=ok(worker,'current',NAME)['root']
            assert call(worker,'remote-backup-begin',NAME,requestId=str(uuid4()),mode='unsupported')['code']=='unsupported_migration_version'
            assert ok(worker,'remote-backup-current',NAME) is None and ok(worker,'current',NAME)['root']==before
            with storage.transaction(target.path,read_only=True) as db:assert db.execute('SELECT count(*) FROM archive_records').fetchone()[0]==0
    finally:target.close()


@pytest.mark.parametrize('mode',['pause-backup-ready-status','pause-backup-file-begin'])
def test_late_ready_status_cannot_recreate_file_cache_after_completed_withdrawal(tmp_path,mode):
    target=fixture(tmp_path)
    try:
        with server(target) as url,sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (_,worker,page,_):
            prepare(worker,url);id=str(uuid4());ok(worker,'remote-backup-begin',NAME,requestId=id)
            ok(worker,'remote-backup-step',NAME,requestId=id);assert target.app.state.archives.run_once()
            worker.evaluate("data=>{globalThis.lateSnapshot=authorityProbe.run('remote-backup-step',data);return true;}",dict(name=NAME,requestId=id,mode=mode))
            checkpoint(worker,page);ok(worker,'remote-backup-cancel',NAME,requestId=id);advance(worker,page,id,'complete')
            assert ok(worker,'file-current',NAME) is None
            ok(worker,'release');worker.evaluate('()=>globalThis.lateSnapshot')
            assert ok(worker,'file-current',NAME) is None
            assert ok(worker,'remote-backup-current',NAME)['phase']=='complete'
            assert ok(worker,'remote-backup-begin',NAME,requestId=str(uuid4()))['phase']=='working'
    finally:target.close()


def test_external_server_cancel_still_returns_a_resumable_step_state(tmp_path):
    target=fixture(tmp_path)
    try:
        with server(target) as url,sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (_,worker,page,_):
            prepare(worker,url);id=str(uuid4());ok(worker,'remote-backup-begin',NAME,requestId=id)
            ok(worker,'remote-backup-step',NAME,requestId=id);target.app.state.archives.cancel(id)
            state=ok(worker,'remote-backup-step',NAME,requestId=id)
            assert state['state']=='working' and state['cancelRequested']
            assert advance(worker,page,id,'complete')['decision']=='withdrawn'
    finally:target.close()
