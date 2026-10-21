"""Coordinator effects persist before dispatch and survive native worker loss."""
from uuid import uuid4
import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_authority import ok,call,FIXTURE,pair


def start(worker):
    ok(worker,'create');ok(worker,'seed',fixture=FIXTURE)
    ok(worker,'rotate-for-setup',credentialRef=str(uuid4()))
    before=ok(worker,'current')
    switch=str(uuid4());plan=ok(worker,'journal-create',switchId=switch,peerId=str(uuid4()),credentialRef=str(uuid4()))
    assert ok(worker,'current')==before
    return switch,plan


def test_journal_leases_preserve_command_identity_after_worker_death(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (context,worker,page,_):
        switch,plan=start(worker)
        lease=ok(worker,'journal-claim',switchId=switch)
        assert ok(worker,'journal-claim',switchId=switch) is None
        request=ok(worker,'journal-command',lease=lease)
        assert request['switch_id']==switch
        session=context.new_cdp_session(page)
        target=next(row for row in session.send('Target.getTargets')['targetInfos'] if row['type']=='service_worker' and row['url']==worker.url)
        assert session.send('Target.closeTarget',dict(targetId=target['targetId']))['success']
        page.evaluate('()=>chrome.runtime.sendMessage({type:"probe-wake"})')
        ok(page,'open')
        assert ok(page,'journal-current')['commands'][0]['request']==request
        replacement=ok(page,'journal-claim',switchId=switch,now='1300')
        assert replacement and replacement['id']!=lease['id']
        assert call(page,'journal-command',lease=lease,now='1300')['code']=='migration_busy'
        assert ok(page,'journal-command',lease=replacement,now='1300',epoch='2')==request
        assert ok(page,'journal-release',lease=replacement,now='1300')
        assert ok(page,'journal-current')['lease'] is None
        assert call(page,'journal-create',switchId=str(uuid4()),peerId=str(uuid4()),credentialRef=str(uuid4()))['code']=='migration_busy'


def test_journal_quota_cannot_record_a_command_or_advance_without_proof(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        switch,_=start(worker);lease=ok(worker,'journal-claim',switchId=switch)
        before=ok(worker,'journal-current')
        assert call(worker,'journal-command',lease=lease,mode='quota')['code']=='quota_exceeded'
        assert ok(worker,'journal-current')==before
        assert call(worker,'journal-advance',lease=lease,phase='source_paused')['code']=='migration_invalid'
        assert ok(worker,'journal-current')==before
        assert ok(worker,'journal-advance',lease=lease,phase='destination_checked')
        assert ok(worker,'journal-current')['phase']=='destination_checked'


def test_journal_survives_a_full_browser_restart_without_selecting_a_writer(tmp_path):
    with sync_playwright() as p:
        path,profile=tmp_path/'extension',tmp_path/'profile'
        with installed(p,path,profile) as (_,worker,_,identifier):
            switch,_=start(worker);lease=ok(worker,'journal-claim',switchId=switch)
            request=ok(worker,'journal-command',lease=lease)
            root=ok(worker,'current')['root']
        with installed(p,path,profile,known_id=identifier) as (_,_,page,_):
            ok(page,'open');value=ok(page,'journal-current')
            assert value['plan']['id']==switch and value['commands'][0]['request']==request
            assert value['lease']['id']==lease['id']
            assert ok(page,'current')['root']==root


def test_root_rotation_fences_an_old_journal_and_its_existing_lease(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        switch,_=start(worker);lease=ok(worker,'journal-claim',switchId=switch)
        request=ok(worker,'journal-command',lease=lease)
        ok(worker,'credential',credentialRef=str(uuid4()))
        before=ok(worker,'journal-current')
        assert call(worker,'journal-command',lease=lease)['code']=='migration_busy'
        assert call(worker,'journal-advance',lease=lease,phase='destination_checked')['code']=='migration_busy'
        assert call(worker,'journal-claim',switchId=switch,now='1300')['code']=='migration_busy'
        assert ok(worker,'journal-current')==before
        assert before['commands'][0]['request']==request


def test_own_native_hold_is_recoverable_before_the_journal_ack(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        switch,plan=start(worker);lease=ok(worker,'journal-claim',switchId=switch)
        request=ok(worker,'journal-command',lease=lease)
        proof=ok(worker,'command',participantId=plan['plan']['sourceId'],command='source_start',request=request)
        assert ok(worker,'current')['root']['pendingSwitchId']==switch
        replacement=ok(worker,'journal-claim',switchId=switch,now='1300')
        assert ok(worker,'journal-command',lease=replacement,now='1300',epoch='2')==request
        assert ok(worker,'journal-accept',lease=replacement,now='1300',request=proof)==proof
        for phase in ['destination_checked','source_quiescing','source_paused']:
            assert ok(worker,'journal-advance',lease=replacement,now='1300',phase=phase)
        assert ok(worker,'journal-current')['phase']=='source_paused'
        assert call(worker,'write')['code']=='stale_epoch'


def test_remote_reservation_rejects_the_wrong_pair_without_poisoning_recovery(pair):
    pair,_,_=pair;worker=pair.worker;handed=pair.handoff()
    pair.command('target','destination_activate',peer_receipt=handed)
    ok(worker,'select-remote',participantId=pair.source,switchId=pair.switch,credentialRef=str(uuid4()))
    switch,credential=str(uuid4()),str(uuid4())
    from test_backup import acknowledged_inactive_backup
    acknowledged_inactive_backup(worker)
    # An earlier-sorted, later-acknowledged export cannot revoke the exact
    # backup evidence already accepted by the replacement decision.
    later='00000000-0000-4000-8000-000000000001'
    ok(worker,'backup-begin',requestId=later,generation=ok(worker,'current')['anchorGeneration'])
    ready=ok(worker,'backup-build',requestId=later)
    ok(worker,'journal-create',switchId=switch,peerId=pair.target,credentialRef=credential,mode='remote-to-local-replace')
    from test_backup import archive
    archive(worker,later)
    ok(worker,'backup-ack',requestId=later,checksum=ready['sha256'])
    lease=ok(worker,'journal-claim',switchId=switch)
    reserved=ok(worker,'reserve',switchId=switch,peerId=pair.target,credentialRef=credential)
    before=ok(worker,'journal-current')
    assert call(worker,'journal-reserve',lease=lease,participantId=reserved['participantId'],generation=str(uuid4()))['code']=='migration_busy'
    assert ok(worker,'journal-current')==before
    assert ok(worker,'journal-reserve',lease=lease,participantId=reserved['participantId'],generation=reserved['generation'])
    saved=ok(worker,'journal-current')
    assert saved['plan']['destinationId']==reserved['participantId'] and saved['destinationGeneration']==reserved['generation']


def test_durable_runner_transfers_native_graph_and_selects_only_the_destination(pair):
    pair,_,_=pair;worker=pair.worker
    ok(worker,'rotate-for-setup',credentialRef=str(uuid4()))
    before=ok(worker,'inspect')['rows']
    ok(worker,'journal-create',switchId=pair.switch,peerId=pair.target,credentialRef=str(uuid4()))
    phases=[]
    for _ in range(100):
        result=ok(worker,'journal-run',now='1792540800')
        assert result['state'] not in ('blocked','busy'),result
        phases.append(result.get('phase'))
        if result['state']=='complete':break
    else:raise AssertionError(phases)
    assert pair.status('source')['state']=='handed_off'
    assert pair.status('target')['state']=='active' and pair.status('target')['awaiting_sync']
    assert ok(worker,'current')['root']['activeMode']=='remote'
    assert ok(worker,'inspect','target')['rows']==before
    journal=ok(worker,'journal-current')
    assert journal['phase']=='complete' and journal['lease'] is None
    assert len(journal['commands'])==6
    assert not call(worker,'write',generation=pair.generation)['ok']
    assert not call(worker,'write','target')['ok']


@pytest.mark.parametrize('mode,phase',[('drop-start','source_quiescing'),('drop-handoff','destination_verified'),('drop-activate','active_pointer_committed')])
def test_runner_recovers_a_lost_mutation_reply_with_the_same_request(pair,mode,phase):
    pair,_,_=pair;worker=pair.worker
    ok(worker,'rotate-for-setup',credentialRef=str(uuid4()))
    ok(worker,'journal-create',switchId=pair.switch,peerId=pair.target,credentialRef=str(uuid4()))
    for _ in range(100):
        journal=ok(worker,'journal-current')
        if journal['phase']==phase:break
        result=ok(worker,'journal-run',now='1792540800');assert result['state']!='blocked',result
    else:raise AssertionError('fault phase not reached')
    dropped=ok(worker,'journal-run',now='1792540800',mode=mode)
    assert dropped['state']=='blocked' and dropped['code']=='backend_unavailable',dropped
    saved=ok(worker,'journal-current')['commands']
    for _ in range(100):
        result=ok(worker,'journal-run',now='1792540800');assert result['state']!='blocked',result
        if result['state']=='complete':break
    else:raise AssertionError('recovery did not complete')
    final=ok(worker,'journal-current')
    for command in saved:assert command in final['commands']
    assert len(final['commands'])==6
    assert pair.status('source')['state']=='handed_off' and pair.status('target')['awaiting_sync']
    assert ok(worker,'reads','target')==2


def test_runner_recovers_after_worker_death_following_irreversible_handoff(pair):
    pair,context,page=pair;worker=pair.worker
    ok(worker,'rotate-for-setup',credentialRef=str(uuid4()))
    ok(worker,'journal-create',switchId=pair.switch,peerId=pair.target,credentialRef=str(uuid4()))
    for _ in range(100):
        if ok(worker,'journal-current')['phase']=='destination_verified':break
        assert ok(worker,'journal-run',now='1792540800')['state']!='blocked'
    worker.evaluate('()=>{globalThis.pending=authorityProbe.run("journal-run",{name:"source",now:"1792540800",mode:"pause-handoff"});return true;}')
    for _ in range(300):
        if ok(worker,'checkpoint'):break
        page.wait_for_timeout(20)
    assert ok(worker,'checkpoint')
    session=context.new_cdp_session(page)
    target=next(row for row in session.send('Target.getTargets')['targetInfos'] if row['type']=='service_worker' and row['url']==worker.url)
    assert session.send('Target.closeTarget',dict(targetId=target['targetId']))['success']
    page.evaluate('()=>chrome.runtime.sendMessage({type:"probe-wake"})');ok(page,'open');ok(page,'open','target')
    pair.worker=page
    assert pair.status('source')['state']=='handed_off'
    for _ in range(100):
        result=ok(page,'journal-run',now='1792541100');assert result['state'] not in ('blocked','busy'),result
        if result['state']=='complete':break
    else:raise AssertionError('handoff recovery did not complete')
    assert pair.status('target')['awaiting_sync']
    assert ok(page,'journal-current')['phase']=='complete'


def test_source_cannot_freeze_an_incomplete_capture_behind_its_hold(pair):
    pair,_,_=pair;worker=pair.worker;ok(worker,'capture-for-migration')
    before=ok(worker,'current');request=pair.request('source','source_start',peer_id=pair.target)
    failed=call(worker,'command',participantId=pair.source,command='source_start',request=request)
    assert failed==dict(ok=False,code='migration_incomplete')
    assert ok(worker,'current')==before and pair.status('source')['state']=='active'
    ok(worker,'capture-for-migration',mode='complete')
    proof=pair.command('source','source_start',request=request)
    assert proof['state']=='export_hold'


@pytest.mark.parametrize('phase',['source_paused','export_ready','importing','destination_verified'])
def test_cancel_discards_activation_before_resuming_only_the_original_source(pair,phase):
    pair,_,_=pair;worker=pair.worker
    ok(worker,'rotate-for-setup',credentialRef=str(uuid4()))
    before=ok(worker,'inspect')['rows']
    ok(worker,'journal-create',switchId=pair.switch,peerId=pair.target,credentialRef=str(uuid4()))
    for _ in range(100):
        if ok(worker,'journal-current')['phase']==phase:break
        assert ok(worker,'journal-run',now='1792540800')['state']!='blocked'
    assert ok(worker,'journal-cancel',switchId=pair.switch,requestId=str(uuid4()))=='requested'
    for _ in range(100):
        result=ok(worker,'journal-run',now='1792540800');assert result['state'] not in ('blocked','busy'),result
        if result['state']=='cancelled':break
    else:raise AssertionError(result)
    journal=ok(worker,'journal-current')
    assert journal['phase']=='cancelled' and journal['lease'] is None
    assert not any(proof['command']=='source_handoff' for proof in journal['receipts'])
    assert pair.status('source')['state']=='active' and pair.status('source')['operation']['state']=='resumed'
    assert pair.status('target')['operation']['state']=='discarded'
    assert ok(worker,'inspect')['rows']==before
    assert ok(worker,'write') is True
    assert not call(worker,'write','target',generation=pair.generation)['ok']


def test_cancel_unused_journal_revokes_a_lease_and_rejects_late_native_commands(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        switch,plan=start(worker);lease=ok(worker,'journal-claim',switchId=switch)
        root=ok(worker,'current')['root']
        assert ok(worker,'journal-cancel',switchId=switch,requestId=str(uuid4()))=='cancelled'
        assert ok(worker,'current')['root']==root
        assert call(worker,'journal-command',lease=lease)['code']=='migration_busy'
        request=dict(request_id=str(uuid4()),switch_id=switch,expected_epoch='1',peer_id=plan['plan']['destinationId'])
        assert call(worker,'command',participantId=plan['plan']['sourceId'],command='source_start',request=request)['code']=='migration_paused'
        assert call(worker,'reserve',switchId=switch,peerId=plan['plan']['destinationId'],credentialRef=str(uuid4()))['code']=='migration_paused'


def test_cancel_after_a_lost_handoff_reply_recovers_forward_instead_of_resuming_source(pair):
    pair,_,_=pair;worker=pair.worker
    ok(worker,'rotate-for-setup',credentialRef=str(uuid4()))
    ok(worker,'journal-create',switchId=pair.switch,peerId=pair.target,credentialRef=str(uuid4()))
    for _ in range(100):
        if ok(worker,'journal-current')['phase']=='destination_verified':break
        assert ok(worker,'journal-run',now='1792540800')['state']!='blocked'
    assert ok(worker,'journal-run',now='1792540800',mode='drop-handoff')['state']=='blocked'
    assert pair.status('source')['state']=='handed_off'
    assert ok(worker,'journal-cancel',switchId=pair.switch,requestId=str(uuid4()))=='requested'
    for _ in range(100):
        result=ok(worker,'journal-run',now='1792540800');assert result['state'] not in ('blocked','busy'),result
        if result['state']=='complete':break
    else:raise AssertionError(result)
    assert pair.status('source')['state']=='handed_off'
    assert pair.status('target')['state']=='active' and pair.status('target')['awaiting_sync']
    assert ok(worker,'journal-cancellation',switchId=pair.switch)['state']=='forward'
    assert not any(proof['command']=='source_resume' for proof in ok(worker,'journal-current')['receipts'])


@pytest.mark.parametrize('mode,phase',[('seal-before-cancel','source_paused'),('arm-before-discard','importing')])
def test_cancel_recovers_a_proven_rejected_cas_after_a_late_participant_transition(pair,mode,phase):
    pair,_,_=pair;worker=pair.worker
    ok(worker,'rotate-for-setup',credentialRef=str(uuid4()))
    ok(worker,'journal-create',switchId=pair.switch,peerId=pair.target,credentialRef=str(uuid4()))
    for _ in range(100):
        value=ok(worker,'journal-current')
        if value['phase']==phase and (mode!='arm-before-discard' or len(value['chunks'])>0):break
        assert ok(worker,'journal-run',now='1792540800')['state']!='blocked'
    else:raise AssertionError('race phase not reached')
    if mode=='arm-before-discard':
        lease=ok(worker,'journal-claim',switchId=pair.switch,now='1792540800')
        ok(worker,'journal-command',lease=lease,side='destination',journalCommand='destination_arm',epoch='2',now='1792540800')
        ok(worker,'journal-release',lease=lease,now='1792540800')
    assert ok(worker,'journal-cancel',switchId=pair.switch,requestId=str(uuid4()))=='requested'
    injected=False
    for _ in range(100):
        value=ok(worker,'journal-current')
        inject=not injected and (mode=='seal-before-cancel' or any(proof['command']=='source_cancel' for proof in value['receipts']))
        result=ok(worker,'journal-run',now='1792540800',mode=mode if inject else None)
        if inject:injected=True
        assert result['state'] not in ('blocked','busy'),result
        if result['state']=='cancelled':break
    else:raise AssertionError(result)
    rejected=ok(worker,'journal-rejected',switchId=pair.switch)
    assert len(rejected)==1,rejected
    old=rejected[0]['value'];assert old['reason']=='superseded_epoch'
    assert int(old['observedEpoch'])>int(old['request']['expected_epoch'])
    replacement=next(row for row in ok(worker,'journal-current')['commands'] if row['command']==old['command'])
    assert replacement['request']['request_id']==old['replacementId']!=old['request']['request_id']
    assert pair.status('source')['state']=='active' and pair.status('target')['operation']['state']=='discarded'


@pytest.mark.parametrize('mode,command',[('drop-cancel','source_cancel'),('drop-discard','destination_discard'),('drop-resume','source_resume')])
def test_cancel_recovers_lost_decision_replies_without_repeating_them(pair,mode,command):
    pair,_,_=pair;worker=pair.worker
    ok(worker,'rotate-for-setup',credentialRef=str(uuid4()))
    ok(worker,'journal-create',switchId=pair.switch,peerId=pair.target,credentialRef=str(uuid4()))
    for _ in range(100):
        if ok(worker,'journal-current')['phase']=='destination_verified':break
        assert ok(worker,'journal-run',now='1792540800')['state']!='blocked'
    ok(worker,'journal-cancel',switchId=pair.switch,requestId=str(uuid4()));dropped=False
    for _ in range(100):
        result=ok(worker,'journal-run',now='1792540800',mode=mode if not dropped else None)
        if result['state']=='blocked':
            assert not dropped and result['code']=='backend_unavailable',result
            dropped=True
        if result['state']=='cancelled':break
    else:raise AssertionError(result)
    assert dropped
    journal=ok(worker,'journal-current')
    assert len([row for row in journal['commands'] if row['command']==command])==1
    assert pair.status('source')['state']=='active' and pair.status('target')['operation']['state']=='discarded'


def test_rejected_cas_audit_and_replacement_roll_back_together(pair):
    pair,_,_=pair;worker=pair.worker
    ok(worker,'rotate-for-setup',credentialRef=str(uuid4()))
    ok(worker,'journal-create',switchId=pair.switch,peerId=pair.target,credentialRef=str(uuid4()))
    for _ in range(100):
        if ok(worker,'journal-current')['phase']=='source_paused':break
        assert ok(worker,'journal-run',now='1792540800')['state']!='blocked'
    ok(worker,'journal-cancel',switchId=pair.switch,requestId=str(uuid4()))
    assert ok(worker,'journal-run',now='1792540800',mode='seal-before-cancel')['state']=='waiting'
    before=ok(worker,'journal-current')['commands']
    result=ok(worker,'journal-run',now='1792540800',mode='quota-rejected')
    assert result['state']=='blocked' and result['code']=='quota_exceeded',result
    assert ok(worker,'journal-current')['commands']==before
    assert ok(worker,'journal-rejected',switchId=pair.switch)==[]
    for _ in range(100):
        result=ok(worker,'journal-run',now='1792540800');assert result['state'] not in ('blocked','busy'),result
        if result['state']=='cancelled':break
    else:raise AssertionError(result)
    assert len(ok(worker,'journal-rejected',switchId=pair.switch))==1


def test_quiescence_accepts_only_monotonic_financial_activity(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        initial=ok(worker,'create')['root'];assert not initial['financialMayHaveStarted']
        ok(worker,'seed',fixture=FIXTURE)
        assert ok(worker,'current')['root']['financialMayHaveStarted']
        assert ok(worker,'quiesce-local',request=initial)
        ok(worker,'credential',credentialRef=str(uuid4()))
        assert call(worker,'quiesce-local',request=initial)['code']=='migration_busy'


@pytest.mark.parametrize('acknowledged',[False,True])
def test_unused_remote_destination_abort_fences_late_coordinator(pair,acknowledged):
    pair,_,_=pair;worker=pair.worker;proof=pair.handoff();pair.command('target','destination_activate',peer_receipt=proof)
    ok(worker,'select-remote',participantId=pair.source,switchId=pair.switch,credentialRef=str(uuid4()))
    before=ok(worker,'current')['root'];switch,credential=str(uuid4()),str(uuid4())
    from test_backup import acknowledged_inactive_backup
    acknowledged_inactive_backup(worker)
    ok(worker,'journal-create',switchId=switch,peerId=pair.target,credentialRef=credential,mode='remote-to-local-replace')
    lease=ok(worker,'journal-claim',switchId=switch)
    slot=ok(worker,'reserve',switchId=switch,peerId=pair.target,credentialRef=credential)
    if acknowledged:ok(worker,'journal-reserve',lease=lease,participantId=slot['participantId'],generation=slot['generation'])
    reserved=ok(worker,'current')['root']
    assert call(worker,'journal-cancel',switchId=switch,requestId=str(uuid4()),mode='quota')['code']=='quota_exceeded'
    assert ok(worker,'current')['root']==reserved
    assert ok(worker,'journal-current')['lease']['id']==lease['id']
    assert ok(worker,'journal-cancel',switchId=switch,requestId=str(uuid4()))=='cancelled'
    root=ok(worker,'current')['root'];assert root['activeMode']=='remote' and root['credentialRef']==before['credentialRef'] and root['pendingSwitchId'] is None
    assert int(root['epoch'])==int(before['epoch'])+2
    assert call(worker,'journal-command',lease=lease)['code']=='migration_busy'
    assert call(worker,'reserve',switchId=switch,peerId=pair.target,credentialRef=credential)['code']=='migration_invalid'
    assert pair.status('target')['state']=='active' and pair.status('source')['state']=='handed_off'


@pytest.mark.parametrize('field,value',[('acknowledgedAt','invalid'),('sha256','x'),('version','2'),('manifest.dataset_id','00000000-0000-4000-8000-000000000001')])
def test_replacement_rejects_corrupted_backup_evidence_before_reserving_a_writer(pair,field,value):
    pair,_,_=pair;worker=pair.worker;proof=pair.handoff();pair.command('target','destination_activate',peer_receipt=proof)
    ok(worker,'select-remote',participantId=pair.source,switchId=pair.switch,credentialRef=str(uuid4()))
    from test_backup import acknowledged_inactive_backup
    id=acknowledged_inactive_backup(worker);before=ok(worker,'current')['root']
    worker.evaluate("""args=>new Promise((resolve,reject)=>{
      const request=indexedDB.open('source');request.onsuccess=()=>{
        const db=request.result,tx=db.transaction('application_state','readwrite'),store=tx.objectStore('application_state'),read=store.get('local-backup:'+args.id);
        read.onsuccess=()=>{const item=read.result;if(args.field.startsWith('manifest.'))item.value.manifest[args.field.slice(9)]=args.value;else item.value[args.field]=args.value;store.put(item);};
        tx.oncomplete=()=>{db.close();resolve(true);};tx.onabort=()=>reject(Error('fixture-write'));
      };
    })""",dict(id=id,field=field,value=value))
    result=call(worker,'journal-create',switchId=str(uuid4()),peerId=pair.target,credentialRef=str(uuid4()),mode='remote-to-local-replace')
    assert not result['ok'],result
    assert ok(worker,'current')['root']==before
    assert ok(worker,'journal-current') is None


def test_saved_local_start_cannot_hold_a_rotated_root_and_can_be_cancelled(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        switch,plan=start(worker);lease=ok(worker,'journal-claim',switchId=switch)
        request=ok(worker,'journal-command',lease=lease)
        ok(worker,'credential',credentialRef=str(uuid4()))
        before=ok(worker,'current');facts=ok(worker,'inspect')
        assert call(worker,'command',participantId=plan['plan']['sourceId'],command='source_start',request=request)['code']=='migration_busy'
        assert ok(worker,'current')==before and ok(worker,'inspect')==facts
        assert call(worker,'journal-cancel',switchId=switch,requestId=str(uuid4()),mode='quota-rejected')['code']=='quota_exceeded'
        assert ok(worker,'journal-current')['commands'][0]['request']==request
        assert ok(worker,'journal-cancel',switchId=switch,requestId=str(uuid4()))=='cancelled'
        audit=ok(worker,'journal-rejected',switchId=switch)
        assert len(audit)==1 and audit[0]['value']['reason']=='stale_initial_root'
        assert audit[0]['value']['request']==request and audit[0]['value']['observedRoot']==before['root']
        assert ok(worker,'journal-cancellation',switchId=switch)['state']=='finished'
        assert call(worker,'command',participantId=plan['plan']['sourceId'],command='source_start',request=request)['code']=='migration_paused'
        assert ok(worker,'current')==before and ok(worker,'inspect')==facts


def test_remote_destination_cannot_reserve_after_its_saved_root_rotates(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        ok(worker,'create-remote',credentialRef=str(uuid4()),peerId=str(uuid4()),url='https://fixture.invalid')
        switch,source,credential=str(uuid4()),str(uuid4()),str(uuid4())
        ok(worker,'journal-create',switchId=switch,peerId=source,credentialRef=credential,mode='remote-to-local')
        ok(worker,'credential',credentialRef=str(uuid4()));before=ok(worker,'current');facts=ok(worker,'inspect',generation=before['anchorGeneration'])
        assert call(worker,'reserve',switchId=switch,peerId=source,credentialRef=credential)['code']=='migration_busy'
        assert ok(worker,'current')==before
        assert ok(worker,'inspect',generation=before['anchorGeneration'])==facts
        assert ok(worker,'journal-cancel',switchId=switch,requestId=str(uuid4()))=='cancelled'
        assert call(worker,'reserve',switchId=switch,peerId=source,credentialRef=credential)['code']=='migration_paused'
        assert ok(worker,'current')==before


def test_coordinator_destination_credentials_are_immutable_until_cancelled(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        ok(worker,'create-remote',credentialRef=str(uuid4()),peerId=str(uuid4()),url='https://fixture.invalid')
        switch,source,credential=str(uuid4()),str(uuid4()),str(uuid4())
        ok(worker,'journal-create',switchId=switch,peerId=source,credentialRef=credential,mode='remote-to-local')
        slot=ok(worker,'reserve',switchId=switch,peerId=source,credentialRef=credential);before=ok(worker,'current')
        assert call(worker,'credential',credentialRef=str(uuid4()))['code']=='migration_paused'
        assert ok(worker,'current')==before
        # The existing correctly bound slot remains idempotent and cancellable.
        assert ok(worker,'reserve',switchId=switch,peerId=source,credentialRef=credential)==slot
        assert ok(worker,'journal-cancel',switchId=switch,requestId=str(uuid4()))=='cancelled'
        assert ok(worker,'current')['root']['pendingSwitchId'] is None
