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
    ok(worker,'journal-create',switchId=switch,peerId=pair.target,credentialRef=credential,mode='remote-to-local')
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
