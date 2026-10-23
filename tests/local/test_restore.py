"""Explicit archive-only disaster recovery; no live peer proof or financial send."""
import base64
from uuid import uuid4
import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_authority import call,ok,FIXTURE,checkpoint
from test_backup import archive


def source_archive(worker,fixture=FIXTURE):
    ok(worker,'create');ok(worker,'seed',fixture=fixture);id=str(uuid4())
    ok(worker,'backup-begin',requestId=id);ready=ok(worker,'backup-build',requestId=id)
    _,rows=archive(worker,id)
    raw=b''.join(base64.b64decode(ok(worker,'backup-chunk',requestId=id,number=i)) for i in range(ready['chunks']))
    return base64.b64encode(raw).decode(),rows,ready


def begin(worker,raw,**fields):
    return ok(worker,'restore-begin','target',requestId=fields.pop('requestId',str(uuid4())),base64=raw,credentialRef=str(uuid4()),fixture=FIXTURE,**fields)


def load_preview(worker,raw,decision):
    loaded=ok(worker,'restore-load','target',requestId=decision['id'],base64=raw)
    assert loaded['phase'] in ('validated','preview')
    preview=ok(worker,'restore-preview','target',requestId=decision['id'],fixture=FIXTURE)
    assert preview['phase']=='preview' and preview['preview']['archiveSha256']==decision['archiveSha256']
    return preview


def test_archive_restore_preserves_every_fact_and_requires_explicit_preview_then_sync(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,_,_):
        raw,rows,backup=source_archive(worker);initial=ok(worker,'create','target')['root']
        decision=begin(worker,raw);root=ok(worker,'current','target')['root']
        assert root['activeGeneration']==initial['activeGeneration'] and root['pendingSwitchId']==decision['id']
        assert call(worker,'write','target')['code']=='stale_epoch'
        assert call(worker,'restore-activate','target',requestId=decision['id'],peerId=str(uuid4()))['code']=='migration_incomplete'
        preview=load_preview(worker,raw,decision);proof=preview['preview']
        assert proof['bankTransactions']==str(len(rows['bank_transactions'])) and len(proof['sdkSha256'])==64
        assert call(worker,'restore-activate','target',requestId=decision['id'],peerId=proof['id'],mode='no-summary')['code']=='migration_paused'
        active=ok(worker,'restore-activate','target',requestId=decision['id'],peerId=proof['id'])
        assert active['phase']=='activated'
        final=ok(worker,'current','target');assert final['root']['activeGeneration']==decision['generation']
        assert final['participantId']!=ok(worker,'current')['participantId']
        assert final['root']['epoch']==str(int(initial['epoch'])+2)
        facts=ok(worker,'inspect','target');assert facts['rows']==rows
        participant=next(row for row in facts['participants'] if row['generation']==decision['generation'])
        assert participant['awaitingSync'] and participant['everActivated'] and participant['state']=='active'
        assert not call(worker,'write','target')['ok']
        assert ok(worker,'restore-activate','target',requestId=decision['id'],peerId=proof['id'])==active
        assert call(worker,'restore-cancel','target',requestId=decision['id'])['code']=='migration_paused'


@pytest.mark.parametrize('mode',['no-retirement','no-loss-consent','wrong-owner'])
def test_restore_rejects_missing_declarations_and_wrong_account_before_root_changes(tmp_path,mode):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,_,_):
        raw,_,_=source_archive(worker);initial=ok(worker,'create','target')['root']
        result=call(worker,'restore-begin','target',requestId=str(uuid4()),base64=raw,credentialRef=str(uuid4()),fixture=FIXTURE,mode=mode)
        assert not result['ok'],result
        assert ok(worker,'current','target')['root']==initial
        assert ok(worker,'restore-current','target') is None


def test_restore_refuses_used_local_destination_and_keeps_its_history(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,_,_):
        raw,_,_=source_archive(worker);ok(worker,'create','target');ok(worker,'seed','target',fixture=FIXTURE)
        initial=ok(worker,'current','target')['root'];before=ok(worker,'inspect','target')['rows']
        result=call(worker,'restore-begin','target',requestId=str(uuid4()),base64=raw,credentialRef=str(uuid4()),fixture=FIXTURE)
        assert result['code']=='migration_not_empty'
        assert ok(worker,'current','target')['root']==initial and ok(worker,'inspect','target')['rows']==before


@pytest.mark.parametrize('fault',['quota-validated','quota-activate'])
def test_restore_quota_commit_can_resume_after_complete_browser_restart(tmp_path,fault):
    ext,profile=tmp_path/'ext',tmp_path/'profile'
    with sync_playwright() as p:
        with installed(p,ext,profile) as (_,worker,_,identifier):
            raw,rows,_=source_archive(worker);ok(worker,'create','target');decision=begin(worker,raw)
            if fault=='quota-validated':
                result=call(worker,'restore-load','target',requestId=decision['id'],base64=raw,mode=fault)
            else:
                preview=load_preview(worker,raw,decision)
                result=call(worker,'restore-activate','target',requestId=decision['id'],peerId=preview['preview']['id'],mode=fault)
            assert result['code']=='quota_exceeded',result
            assert ok(worker,'current','target')['root']['pendingSwitchId']==decision['id']
        with installed(p,ext,profile,known_id=identifier) as (_,worker,_,_):
            ok(worker,'open','target');preview=load_preview(worker,raw,decision)
            ok(worker,'restore-activate','target',requestId=decision['id'],peerId=preview['preview']['id'])
            assert ok(worker,'inspect','target')['rows']==rows


def test_cancelled_recovery_fences_late_sdk_preview_and_restores_only_prior_route(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,page,_):
        raw,_,_=source_archive(worker);initial=ok(worker,'create','target')['root'];decision=begin(worker,raw)
        ok(worker,'restore-load','target',requestId=decision['id'],base64=raw)
        worker.evaluate("data=>{globalThis.lateRestore=authorityProbe.run('restore-preview',data);}",dict(name='target',requestId=decision['id'],fixture=FIXTURE,mode='pause-restore-preview'))
        checkpoint(worker,page);cancelled=ok(worker,'restore-cancel','target',requestId=decision['id'])
        assert cancelled['phase']=='cancelled'
        root=ok(worker,'current','target')['root']
        assert root==initial|{'epoch':str(int(initial['epoch'])+2),'financialMayHaveStarted':True}
        ok(worker,'write','target');ok(worker,'release')
        assert not worker.evaluate('()=>globalThis.lateRestore')['ok']
        assert ok(worker,'current','target')['root']==root


def test_stale_preview_permission_and_different_file_never_activate_recovery(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,_,_):
        raw,_,_=source_archive(worker);ok(worker,'create','target');decision=begin(worker,raw)
        other=base64.b64encode(base64.b64decode(raw)+b'changed').decode()
        assert not call(worker,'restore-load','target',requestId=decision['id'],base64=other)['ok']
        preview=load_preview(worker,raw,decision);before=ok(worker,'current','target')['root']
        assert call(worker,'restore-activate','target',requestId=decision['id'],peerId=preview['preview']['id'],mode='permission-denied')['code']=='permission_required'
        assert not call(worker,'restore-activate','target',requestId=decision['id'],peerId=preview['preview']['id'],now='1792541101')['ok']
        assert ok(worker,'current','target')['root']==before
        assert ok(worker,'restore-cancel','target',requestId=decision['id'])['phase']=='cancelled'


def test_preview_deduplicates_the_same_physical_account_seen_in_two_connections(tmp_path):
    from copy import deepcopy
    fixture=deepcopy(FIXTURE);connection=deepcopy(fixture['rows']['connections'][0]);old=connection[0][1];new=str(uuid4())
    connection[0]=['text',new];connection[2]=['text','second-fixture-profile'];fixture['rows']['connections'].append(connection)
    for table in ['connection_accounts','connection_discovery','connection_labels']:
        for original in list(fixture['rows'][table]):
            if original[0][1]==old:
                row=deepcopy(original);row[0]=['text',new];fixture['rows'][table].append(row)
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,_,_):
        raw,rows,_=source_archive(worker,fixture);ok(worker,'create','target');decision=begin(worker,raw)
        proof=load_preview(worker,raw,decision)['preview']
        assert 0<proof['missingBank']<=len(rows['bank_transactions'])
        assert proof['uncheckedAccounts']<=len(rows['bank_accounts'])
        ok(worker,'restore-cancel','target',requestId=decision['id'])


@pytest.mark.parametrize('count',[1000,10000,100000])
def test_complete_large_recovery_stays_bounded_and_keeps_explicit_sync_fence(tmp_path,count):
    from pathlib import Path
    import time,json,os
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,_,_):
        initial=ok(worker,'create','target')['root'];id=str(uuid4());setup_started=time.monotonic()
        # Import starts with an existing ZIP. Do not time creation of synthetic
        # input files as restoration, or regenerate that file between begin/load.
        file=ok(worker,'fixture-restore-prepare','target',requestId=id,fixture=FIXTURE,count=count)
        started=time.monotonic();timings={'fixture_setup_seconds':started-setup_started,'archive_bytes':file['bytes']}
        try:
            decision=ok(worker,'restore-begin','target',requestId=id,credentialRef=str(uuid4()),fixture=FIXTURE,count=count,mode='prepared-file')
            timings['reserved_seconds']=time.monotonic()-started;print('restore resource',count,'reserved',timings['reserved_seconds'],flush=True)
            assert ok(worker,'restore-load','target',requestId=id,fixture=FIXTURE,count=count,mode='prepared-file')['phase']=='validated'
            timings['validated_seconds']=time.monotonic()-started;print('restore resource',count,'validated',timings['validated_seconds'],flush=True)
            preview=ok(worker,'restore-preview','target',requestId=id,fixture=FIXTURE)
            assert preview['preview']['bankTransactions']==str(len(FIXTURE['rows']['bank_transactions']))
            ok(worker,'restore-activate','target',requestId=id,peerId=preview['preview']['id'])
            assert not call(worker,'write','target')['ok']
            assert ok(worker,'current','target')['root']['activeGeneration']!=initial['activeGeneration']
            peak=int(Path('/sys/fs/cgroup/memory.peak').read_text());assert 0<peak<3*1024**3
            timings.update(count=count,elapsed_seconds=time.monotonic()-started,combined_elapsed_seconds=time.monotonic()-setup_started,
                           cgroup_peak_bytes=peak,user_agent=worker.evaluate('navigator.userAgent'))
            Path('/results').mkdir(exist_ok=True);label='chrome140' if os.getenv('CHROME_EXECUTABLE') else 'chromium'
            Path('/results',f'l10-restore-{label}-{count}.json').write_text(json.dumps(timings))
            print('restore resource result',json.dumps(timings),flush=True)
            assert timings['elapsed_seconds']<180
        finally:assert ok(worker,'fixture-restore-release','target',requestId=id) is True


def test_changed_manifest_text_never_reuses_cached_identity_or_activation_proof(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,_,_):
        raw,_,_=source_archive(worker);ok(worker,'create','target');decision=begin(worker,raw)
        preview=load_preview(worker,raw,decision);before=ok(worker,'current','target')['root']
        worker.evaluate(r"""id=>new Promise((resolve,reject)=>{
          const request=indexedDB.open('target');request.onsuccess=()=>{
            const db=request.result,tx=db.transaction('application_state','readwrite'),store=tx.objectStore('application_state'),read=store.get('archive-restore:'+id);
            read.onsuccess=()=>{const item=read.result,manifest=JSON.parse(item.value.manifest);manifest.zenmoney_identity.owner_ids=['2'];item.value.manifest=JSON.stringify(manifest)+'\n';store.put(item);};
            tx.oncomplete=()=>{db.close();resolve(true);};tx.onabort=()=>reject(Error('fixture-write'));
          };
        })""",decision['id'])
        assert not call(worker,'restore-preview','target',requestId=decision['id'],fixture=FIXTURE)['ok']
        assert not call(worker,'restore-activate','target',requestId=decision['id'],peerId=preview['preview']['id'])['ok']
        assert ok(worker,'current','target')['root']==before


def test_cancelled_stage_cleanup_requires_retaining_archive_and_never_touches_source(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,_,_):
        raw,source_rows,_=source_archive(worker);ok(worker,'create','target');decision=begin(worker,raw)
        load_preview(worker,raw,decision)
        assert call(worker,'restore-clean','target',requestId=decision['id'])['code']=='migration_paused'
        ok(worker,'restore-cancel','target',requestId=decision['id']);root=ok(worker,'current','target')['root']
        assert call(worker,'restore-clean','target',requestId=decision['id'],mode='no-retention')['code']=='migration_paused'
        calls=0
        while not ok(worker,'restore-clean','target',requestId=decision['id'])['complete']:
            calls+=1;assert calls<100
        assert calls>0 and ok(worker,'restore-clean','target',requestId=decision['id'])['complete']
        assert ok(worker,'current','target')['root']==root
        assert ok(worker,'inspect')['rows']==source_rows
        assert not call(worker,'restore-load','target',requestId=decision['id'],base64=raw)['ok']
        assert begin(worker,raw)['phase']=='loading'


@pytest.mark.parametrize('point',['anchor-read','final-write'])
def test_preview_expiry_during_native_activation_rolls_back_even_after_final_write(tmp_path,point):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,page,_):
        raw,_,_=source_archive(worker);ok(worker,'create','target');decision=begin(worker,raw)
        preview=load_preview(worker,raw,decision);proof=preview['preview'];root=ok(worker,'current','target')['root']
        args=dict(name='target',requestId=decision['id'],peerId=proof['id'],now=str(int(proof['checkedAt'])+299))
        if point=='anchor-read':
            worker.evaluate("args=>{globalThis.lateRestoreExpiry=authorityProbe.run('restore-activate',args);}",args|dict(mode='pause-restore-activate'))
            checkpoint(worker,page);ok(worker,'restore-clock','target',now=str(int(proof['checkedAt'])+301));ok(worker,'release')
            result=worker.evaluate('()=>globalThis.lateRestoreExpiry')
        else:result=call(worker,'restore-activate',**args,mode='expire-after-restore-write')
        assert not result['ok'],result
        assert ok(worker,'current','target')['root']==root
        assert ok(worker,'restore-current','target')['phase']=='preview'
        fresh=ok(worker,'restore-preview','target',requestId=decision['id'],fixture=FIXTURE)
        assert fresh['preview']['id']!=proof['id']
        assert ok(worker,'restore-activate','target',requestId=decision['id'],peerId=fresh['preview']['id'])['phase']=='activated'


def test_restore_begin_binds_the_callers_root_before_reading_the_archive(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,page,_):
        raw,_,_=source_archive(worker);root=ok(worker,'create','target')['root']
        args=dict(name='target',requestId=str(uuid4()),base64=raw,credentialRef=str(uuid4()),fixture=FIXTURE,
            request=dict(root=root),mode='pause-restore-begin')
        worker.evaluate("args=>{globalThis.staleRestore=authorityProbe.run('restore-begin',args);return true;}",args)
        checkpoint(worker,page);ok(worker,'credential','target',credentialRef=str(uuid4()));ok(worker,'release')
        assert worker.evaluate('()=>globalThis.staleRestore')['code']=='stale_context'
        selected=ok(worker,'current','target')['root']
        assert selected['activeGeneration']==root['activeGeneration'] and selected['pendingSwitchId'] is None
        assert ok(worker,'restore-current','target') is None


def test_preview_request_time_cannot_be_renewed_by_slow_owner_verification(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,_,_):
        raw,_,_=source_archive(worker);ok(worker,'create','target');decision=begin(worker,raw)
        ok(worker,'restore-load','target',requestId=decision['id'],base64=raw)
        before=ok(worker,'current','target')['root']
        failed=call(worker,'restore-preview','target',requestId=decision['id'],fixture=FIXTURE,mode='expire-during-restore-preview')
        assert failed['code']=='migration_incomplete'
        assert ok(worker,'restore-current','target')['phase']=='validated'
        assert ok(worker,'current','target')['root']==before
        fresh=ok(worker,'restore-preview','target',requestId=decision['id'],fixture=FIXTURE)
        assert ok(worker,'restore-activate','target',requestId=decision['id'],peerId=fresh['preview']['id'])['phase']=='activated'


@pytest.mark.parametrize('action',['restore-cancel','restore-activate'])
def test_late_captured_restore_cannot_operate_on_a_newer_held_recovery(tmp_path,action):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,page,_):
        raw,_,_=source_archive(worker);ok(worker,'create','target');first=begin(worker,raw)
        held=ok(worker,'current','target')['root'];next_id=str(uuid4())
        # The stale facade is suspended after opening, before its first native unit.
        args=dict(name='target',requestId=next_id,peerId=str(uuid4()),request=dict(root=held),mode='pause-restore-begin')
        worker.evaluate("data=>{globalThis.oldRestore=authorityProbe.run(data.action,data.args);return true;}",dict(action=action,args=args))
        checkpoint(worker,page);ok(worker,'restore-cancel','target',requestId=first['id'])
        second=begin(worker,raw,requestId=next_id);load_preview(worker,raw,second)
        # Cancellation must not mutate B; activation must reject Root before proof lookup.
        before=ok(worker,'current','target')['root'];ok(worker,'release')
        assert worker.evaluate('()=>globalThis.oldRestore')['code']=='stale_context'
        assert ok(worker,'current','target')['root']==before
        assert ok(worker,'restore-current','target')['phase']=='preview'
