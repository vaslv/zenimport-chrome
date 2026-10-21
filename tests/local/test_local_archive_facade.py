"""Trusted local archive API exercised in installed offline native Chrome."""
from base64 import b64encode,b64decode
from hashlib import sha256
from uuid import uuid4
import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_authority import ok,call,FIXTURE
from test_restore import source_archive


def upload(worker,name,raw):
    raw=b64decode(raw);id=str(uuid4())
    value=ok(worker,'local-archive-upload-begin',name,requestId=id,count=len(raw),checksum=sha256(raw).hexdigest())
    for number,offset in enumerate(range(0,len(raw),262144)):
        ok(worker,'local-archive-upload-chunk',name,requestId=id,peerId=value['nonce'],number=number,base64=b64encode(raw[offset:offset+262144]).decode())
    assert ok(worker,'local-archive-upload-seal',name,requestId=id)['phase']=='ready'
    return id


def test_local_backup_facade_resumes_after_chrome_restart_and_acknowledges_only_explicit_download(tmp_path):
    ext,profile=tmp_path/'ext',tmp_path/'profile'
    with sync_playwright() as p:
        with installed(p,ext,profile) as (_,worker,_,identifier):
            ok(worker,'create');ok(worker,'seed',fixture=FIXTURE);credential=ok(worker,'transfer-credential')
            root=ok(worker,'current')['root'];id=str(uuid4())
            sources=ok(worker,'local-archive-status')['sources'];assert len(sources)==1 and sources[0]['active']
            started=ok(worker,'local-archive-backup-begin',requestId=id,generation=root['activeGeneration'])
            assert started==dict(state='building',id=id)
            assert ok(worker,'current')['root']['pendingSwitchId']==id
            state=ok(worker,'local-archive-status');assert state['backups'][0]['phase']=='building'
            assert credential['ref'] not in str(state) and 'synthetic-local-sdk-token' not in str(state)
        with installed(p,ext,profile,known_id=identifier) as (_,worker,_,_):
            ok(worker,'open');ready=ok(worker,'local-archive-backup-step',requestId=id)
            assert ready['phase']=='ready' and ok(worker,'current')['root']['pendingSwitchId'] is None
            assert not ok(worker,'local-archive-status')['backups'][0]['acknowledged']
            assert call(worker,'local-archive-backup-clean',requestId=id)['code']=='migration_paused'
            raw=b''.join(b64decode(ok(worker,'local-archive-backup-chunk',requestId=id,number=n)) for n in range(ready['chunks']))
            assert len(raw)==ready['bytes'] and sha256(raw).hexdigest()==ready['sha256']
            assert not call(worker,'local-archive-backup-ack',requestId=id,checksum='a'*64)['ok']
            assert ok(worker,'local-archive-backup-ack',requestId=id,checksum=ready['sha256'])['acknowledged']
            while not ok(worker,'local-archive-backup-clean',requestId=id)['complete']:pass
            assert ok(worker,'local-archive-status')['backups'][0]['phase']=='cleaned'


def test_local_restore_facade_keeps_file_and_decision_across_restart_and_requires_explicit_acceptance(tmp_path):
    ext,profile=tmp_path/'ext',tmp_path/'profile'
    with sync_playwright() as p:
        with installed(p,ext,profile) as (_,worker,_,identifier):
            raw,_,_=source_archive(worker);initial=ok(worker,'create','target')['root'];id=upload(worker,'target',raw)
            started=ok(worker,'local-archive-restore-begin','target',requestId=id,token='synthetic-recovery-only',fixture=FIXTURE)
            assert started['phase']=='loading'
            assert call(worker,'local-archive-discard','target',requestId=id)['code']=='migration_paused'
        with installed(p,ext,profile,known_id=identifier) as (_,worker,_,_):
            ok(worker,'open','target')
            assert ok(worker,'local-archive-restore-step','target',requestId=id,fixture=FIXTURE)['phase']=='validated'
            preview=ok(worker,'local-archive-restore-step','target',requestId=id,fixture=FIXTURE)
            assert preview['phase']=='preview' and preview['preview']['bankTransactions']==str(len(FIXTURE['rows']['bank_transactions']))
            assert 'sourceHash' not in preview['preview'] and 'credentialRef' not in preview
            assert ok(worker,'local-archive-restore-step','target',requestId=id)['phase']=='preview'
            assert ok(worker,'current','target')['root']['activeGeneration']==initial['activeGeneration']
            assert not call(worker,'local-archive-restore-accept','target',requestId=id,peerId=str(uuid4()))['ok']
            active=ok(worker,'local-archive-restore-accept','target',requestId=id,peerId=preview['preview']['id'])
            assert active['phase']=='activated'
            selected=ok(worker,'current','target')['root'];assert selected['activeGeneration']!=initial['activeGeneration']
            participant=next(row for row in ok(worker,'inspect','target')['participants'] if row['generation']==selected['activeGeneration'])
            assert participant['awaitingSync'] and participant['everActivated']
            assert call(worker,'local-archive-restore-cancel','target',requestId=id)['code']=='migration_paused'


def test_local_restore_cancellation_retains_original_upload_and_cleans_only_unactivated_stage(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,_,_):
        raw,_,_=source_archive(worker);initial=ok(worker,'create','target')['root'];id=upload(worker,'target',raw)
        assert call(worker,'local-archive-restore-begin','target',requestId=id,token='synthetic-wrong-owner',mode='wrong-owner')['code']=='migration_wrong_account'
        assert ok(worker,'current','target')['root']==initial
        ok(worker,'local-archive-restore-begin','target',requestId=id,token='synthetic-recovery-only',fixture=FIXTURE)
        ok(worker,'local-archive-restore-step','target',requestId=id,fixture=FIXTURE)
        assert ok(worker,'local-archive-restore-cancel','target',requestId=id)['phase']=='cancelled'
        while not ok(worker,'local-archive-restore-clean','target',requestId=id)['complete']:pass
        assert ok(worker,'local-archive-status','target')['file']['phase']=='ready'
        assert ok(worker,'current','target')['root']['activeGeneration']==initial['activeGeneration']
        while not ok(worker,'local-archive-discard','target',requestId=id)['complete']:pass
        assert ok(worker,'local-archive-status','target')['file']['phase']=='cleaned'
