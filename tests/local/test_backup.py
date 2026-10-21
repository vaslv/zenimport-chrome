"""Native archive snapshots: no peer receipt and no new financial writer."""
import base64
from hashlib import sha256
from io import BytesIO
import json
from uuid import uuid4
from zipfile import ZipFile
import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_authority import call,ok,FIXTURE,checkpoint,Pair


def setup(worker):
    root=ok(worker,'create')['root'];ok(worker,'seed',fixture=FIXTURE)
    return ok(worker,'current')['root'],ok(worker,'inspect')['rows']


def archive(worker,id):
    ready=next(row for row in ok(worker,'backup-list') if row['id']==id)
    data=b''.join(base64.b64decode(ok(worker,'backup-chunk',requestId=id,number=i)) for i in range(ready['chunks']))
    assert len(data)==ready['bytes'] and sha256(data).hexdigest()==ready['sha256']
    with ZipFile(BytesIO(data)) as zip:
        manifest=json.loads(zip.read('manifest.json'))
        assert manifest==ready['manifest']
        rows={name: [json.loads(line) for line in zip.read('tables/'+name+'.ndjson').splitlines()] for name in FIXTURE['rows']}
    return ready,rows


def test_active_backup_preserves_exact_graph_and_releases_only_its_own_hold(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,_,_):
        root,before=setup(worker);id=str(uuid4());started=ok(worker,'backup-begin',requestId=id)
        assert started['held'] and started['initialRoot']==root
        assert call(worker,'write')['code']=='stale_epoch'
        assert ok(worker,'backup-begin',requestId=id)==started
        ready=ok(worker,'backup-build',requestId=id);assert ready['phase']=='ready'
        after=ok(worker,'current')['root'];assert after==root|{'epoch':str(int(root['epoch'])+2)}
        assert ok(worker,'inspect')['rows']==before
        data,rows=archive(worker,id)
        assert rows['bank_transactions']==before['bank_transactions']
        assert rows['deliveries']==before['deliveries']
        assert data['acknowledgedAt'] is None
        assert call(worker,'backup-clean',requestId=id)['code']=='migration_paused'
        assert call(worker,'backup-ack',requestId=id,checksum='0'*64)['code']=='migration_incomplete'
        ack=ok(worker,'backup-ack',requestId=id,checksum=ready['sha256'],now='1792540900')
        assert ack['acknowledgedAt']=='1792540900'
        assert ok(worker,'backup-ack',requestId=id,checksum=ready['sha256'])==ack
        while not ok(worker,'backup-clean',requestId=id)['complete']:pass
        assert call(worker,'backup-chunk',requestId=id,number=0)['code']=='migration_incomplete'
        assert ok(worker,'inspect')['rows']==before


@pytest.mark.parametrize('fault',['quota','quota-ready'])
def test_failed_backup_remains_paused_and_can_resume_after_full_browser_restart(tmp_path,fault):
    ext,profile=tmp_path/'ext',tmp_path/'profile';id=str(uuid4())
    with sync_playwright() as p:
        with installed(p,ext,profile) as (_,worker,_,identifier):
            root,before=setup(worker);ok(worker,'backup-begin',requestId=id)
            assert call(worker,'backup-build',requestId=id,mode=fault)['code']=='quota_exceeded'
            assert ok(worker,'current')['root']['pendingSwitchId']==id
        with installed(p,ext,profile,known_id=identifier) as (_,worker,_,_):
            ok(worker,'open');ready=ok(worker,'backup-build',requestId=id)
            assert ready['phase']=='ready' and ok(worker,'current')['root']['pendingSwitchId'] is None
            _,rows=archive(worker,id);assert rows['bank_transactions']==before['bank_transactions']
            assert ok(worker,'inspect')['rows']==before


def test_cancelled_backup_fences_a_late_builder_and_preserves_new_writer(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,page,_):
        root,_=setup(worker);id=str(uuid4());ok(worker,'backup-begin',requestId=id)
        worker.evaluate("id=>{globalThis.lateBackup=authorityProbe.run('backup-build',{name:'source',requestId:id,mode:'pause-backup'});}",id)
        checkpoint(worker,page)
        assert ok(worker,'backup-cancel',requestId=id)['phase']=='cancelled'
        assert ok(worker,'current')['root']['epoch']==str(int(root['epoch'])+2)
        ok(worker,'write');ok(worker,'release')
        result=worker.evaluate('()=>globalThis.lateBackup');assert result['code']=='migration_paused'
        assert ok(worker,'current')['root']['pendingSwitchId'] is None
        assert ok(worker,'backup-list')[0]['phase']=='cancelled'


def test_pending_transfer_blocks_backup_before_either_source_changes_root(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,_,_):
        root,_=setup(worker);ok(worker,'rotate-for-setup',credentialRef=str(uuid4()));root=ok(worker,'current')['root']
        ok(worker,'journal-create',switchId=str(uuid4()),peerId=str(uuid4()),credentialRef=str(uuid4()))
        assert call(worker,'backup-begin',requestId=str(uuid4()))['code']=='migration_busy'
        assert ok(worker,'current')['root']==root


def test_retired_source_backup_never_grants_write_authority_or_touches_active_remote_root(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,_,_):
        pair=Pair(worker);original=ok(worker,'current')['root'];before=ok(worker,'inspect')['rows']
        pair.upload();armed=pair.command('target','destination_arm')
        pair.command('source','source_handoff',peer_receipt=armed)
        ok(worker,'select-remote',participantId=pair.source,switchId=pair.switch,credentialRef=str(uuid4()))
        root=ok(worker,'current')['root'];id=str(uuid4())
        value=ok(worker,'backup-begin',requestId=id,generation=original['activeGeneration']);assert not value['held']
        ready=ok(worker,'backup-build',requestId=id);assert ready['phase']=='ready'
        assert ok(worker,'current')['root']==root
        _,rows=archive(worker,id);assert rows['bank_transactions']==before['bank_transactions']
        assert call(worker,'write',generation=original['activeGeneration'])['code']=='stale_epoch'


@pytest.mark.parametrize('epoch,allowed',[('9223372036854775806',False),('9223372036854775805',True)])
def test_backup_reserves_both_root_epochs_before_taking_a_hold(tmp_path,epoch,allowed):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,_,_):
        setup(worker)
        worker.evaluate("""epoch=>new Promise((resolve,reject)=>{
          const request=indexedDB.open('source');request.onsuccess=()=>{
            const db=request.result,tx=db.transaction('runtime','readwrite'),store=tx.objectStore('runtime'),read=store.get('runtime');
            read.onsuccess=()=>store.put({...read.result,epoch});tx.oncomplete=()=>{db.close();resolve(true);};tx.onabort=()=>reject(Error('fixture-write'));
          };
        })""",epoch)
        id=str(uuid4());result=call(worker,'backup-begin',requestId=id)
        if allowed:
            assert result['ok'],result
            assert ok(worker,'backup-cancel',requestId=id)['phase']=='cancelled'
            assert ok(worker,'current')['root']['epoch']=='9223372036854775807'
        else:
            assert result['code']=='invalid_row'
            assert ok(worker,'current')['root']['pendingSwitchId'] is None
            assert ok(worker,'current')['root']['epoch']==epoch
