"""Private resumable file cache; offline native Chrome, no financial sends."""
import base64
import hashlib
from uuid import uuid4
import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_authority import call,ok,checkpoint

CHUNK=262144
DATA=bytes(range(256))*1200


def start(worker,data=DATA):
    id=str(uuid4());value=ok(worker,'file-begin',requestId=id,count=len(data),checksum=hashlib.sha256(data).hexdigest())
    return value


def put(worker,value,number,data=DATA,**fields):
    return call(worker,'file-put',requestId=value['id'],peerId=value['nonce'],number=number,
        base64=base64.b64encode(data[number*CHUNK:(number+1)*CHUNK]).decode(),**fields)


def test_file_upload_resumes_after_browser_restart_and_preserves_root(tmp_path):
    ext,profile=tmp_path/'ext',tmp_path/'profile'
    with sync_playwright() as p:
        with installed(p,ext,profile) as (_,worker,_,identifier):
            initial=ok(worker,'create')['root'];value=start(worker)
            assert put(worker,value,1)['ok']
            assert ok(worker,'file-status',requestId=value['id'])['received']==[1]
            assert call(worker,'file-seal',requestId=value['id'])['code']=='migration_incomplete'
        with installed(p,ext,profile,known_id=identifier) as (_,worker,_,_):
            ok(worker,'open');assert ok(worker,'file-status',requestId=value['id'])['received']==[1]
            assert put(worker,value,0)['ok'] and put(worker,value,0)['ok']
            ready=ok(worker,'file-seal',requestId=value['id']);assert ready['phase']=='ready'
            assert ok(worker,'file-seal',requestId=value['id'])==ready
            assert ok(worker,'file-blob',requestId=value['id'])==dict(bytes=len(DATA),checksum=hashlib.sha256(DATA).hexdigest())
            assert ok(worker,'current')['root']==initial
            assert call(worker,'file-clean',requestId=value['id'])['code']=='migration_paused'
            assert not put(worker,value,0)['ok']
            assert call(worker,'file-begin',requestId=str(uuid4()),count=1,checksum='a'*64)['code']=='migration_busy'
            ok(worker,'file-cancel',requestId=value['id'])
            assert not put(worker,value,0)['ok'] and not call(worker,'file-blob',requestId=value['id'])['ok']
            assert ok(worker,'file-clean',requestId=value['id'])=={'complete':False}
            assert ok(worker,'file-clean',requestId=value['id'])=={'complete':False}
            assert ok(worker,'file-clean',requestId=value['id'])=={'complete':True}
            assert ok(worker,'file-clean',requestId=value['id'])=={'complete':True}
            assert start(worker,b'next')['phase']=='uploading'
            assert ok(worker,'current')['root']==initial


def test_upload_bounds_conflicting_retries_digest_and_quota_fail_closed(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,_,_):
        initial=ok(worker,'create')['root']
        for size in [0,-1,67108865]:
            assert not call(worker,'file-begin',requestId=str(uuid4()),count=size,checksum='a'*64)['ok']
        value=start(worker);assert put(worker,value,0,mode='quota')['code']=='quota_exceeded'
        assert ok(worker,'file-status',requestId=value['id'])['received']==[]
        assert put(worker,value,0)['ok']
        assert not put(worker,value,0,data=b'x'*len(DATA))['ok']
        assert not call(worker,'file-begin',requestId=value['id'],count=len(DATA),checksum='a'*64)['ok']
        assert put(worker,value,1)['ok'];ok(worker,'file-seal',requestId=value['id'])
        # Corrupted persisted bytes do not become a downloadable archive.
        worker.evaluate("""id=>new Promise((resolve,reject)=>{const r=indexedDB.open('source');r.onsuccess=()=>{
          const db=r.result,tx=db.transaction('archive_file_chunks','readwrite'),store=tx.objectStore('archive_file_chunks'),q=store.get([id,0]);
          q.onsuccess=()=>{const row=q.result;row.data[0]^=1;store.put(row);};tx.oncomplete=()=>{db.close();resolve(true);};tx.onabort=()=>reject(Error('fixture-write'));
        };})""",value['id'])
        assert call(worker,'file-blob',requestId=value['id'])['code']=='migration_incomplete'
        assert ok(worker,'current')['root']==initial
        ok(worker,'file-cancel',requestId=value['id'])
        while not ok(worker,'file-clean',requestId=value['id'])['complete']:pass
        wrong=ok(worker,'file-begin',requestId=str(uuid4()),count=len(DATA),checksum='a'*64)
        assert put(worker,wrong,0)['ok'] and put(worker,wrong,1)['ok']
        assert call(worker,'file-seal',requestId=wrong['id'])['code']=='migration_invalid'
        assert ok(worker,'file-status',requestId=wrong['id'])['phase']=='uploading'
        assert ok(worker,'current')['root']==initial


@pytest.mark.parametrize('action',['file-seal','file-blob'])
def test_cancel_revokes_late_file_reads_and_never_changes_routing(tmp_path,action):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,page,_):
        initial=ok(worker,'create')['root'];value=start(worker)
        assert put(worker,value,0)['ok'] and put(worker,value,1)['ok']
        if action=='file-blob':ok(worker,'file-seal',requestId=value['id'])
        worker.evaluate("data=>{globalThis.lateFile=authorityProbe.run(data.action,data.args);}",dict(action=action,args=dict(name='source',requestId=value['id'],mode='pause-file-read')))
        checkpoint(worker,page);ok(worker,'file-cancel',requestId=value['id']);ok(worker,'release')
        assert worker.evaluate('()=>globalThis.lateFile')['code']=='migration_paused'
        assert ok(worker,'file-status',requestId=value['id'])['phase']=='cancelled'
        assert ok(worker,'current')['root']==initial


@pytest.mark.parametrize('action',['file-put','file-cancel','file-seal','file-clean'])
def test_captured_file_mutations_reject_a_rotated_root(tmp_path,action):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,page,_):
        root=ok(worker,'create')['root'];value=start(worker)
        if action=='file-clean':ok(worker,'file-cancel',requestId=value['id'])
        args=dict(name='source',requestId=value['id'],request=dict(root=root),mode='pause-bound-file',
            peerId=value['nonce'],number=0,base64=base64.b64encode(DATA[:CHUNK]).decode())
        before=ok(worker,'file-current')
        worker.evaluate("data=>{globalThis.staleFile=authorityProbe.run(data.action,data.args);return true;}",dict(action=action,args=args))
        checkpoint(worker,page);ok(worker,'credential',credentialRef=str(uuid4()));ok(worker,'release')
        assert worker.evaluate('()=>globalThis.staleFile')['code']=='stale_context'
        assert ok(worker,'file-current')==before
        assert ok(worker,'file-status',requestId=value['id'])['received']==[]
        ok(worker,'file-cancel',requestId=value['id'])
        assert ok(worker,'file-clean',requestId=value['id'])['complete']
