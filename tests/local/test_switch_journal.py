"""Coordinator effects persist before dispatch and survive native worker loss."""
from uuid import uuid4
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
