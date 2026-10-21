"""Real IDB authority CAS/recovery; independent synthetic peers, offline only."""
import base64
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
from uuid import uuid4

import pytest
from playwright.sync_api import sync_playwright,Page
from test_runtime import installed

FIXTURE=json.loads(Path('/app/contracts/business/v1/portable-financial-v2.json').read_text())


def call(worker,action,name='source',**args):
    if isinstance(worker,Page):
        return worker.evaluate('data=>chrome.runtime.sendMessage(data)',dict(type='authority-probe',action=action,args=dict(name=name,**args)))
    return worker.evaluate('data=>authorityProbe.run(data.action,data.args)',dict(action=action,args=dict(name=name,**args)))


def ok(worker,action,name='source',**args):
    result=call(worker,action,name,**args);assert result['ok'],(action,result)
    return result['value']


def checkpoint(worker,page):
    for _ in range(400):
        if ok(worker,'checkpoint'):return
        page.wait_for_timeout(20)
    pytest.fail('Authority fault checkpoint was not reached')


class Pair:
    def __init__(self,worker):
        self.worker=worker;self.switch=str(uuid4());self.source=ok(worker,'create')['participantId']
        ok(worker,'seed',fixture=FIXTURE)
        ok(worker,'create','target')
        reserved=ok(worker,'reserve','target',switchId=self.switch,peerId=self.source,credentialRef=str(uuid4()))
        self.target,self.generation=reserved['participantId'],reserved['generation'];self.requests={}

    def status(self,name):return ok(self.worker,'status',name,participantId=self.source if name=='source' else self.target,switchId=self.switch)

    def request(self,name,command,**fields):
        return dict(request_id=str(uuid4()),switch_id=self.switch,expected_epoch=self.status(name)['participant_epoch'],**fields)

    def command(self,name,command,*,request=None,mode=None,**fields):
        request=request or self.request(name,command,**fields)
        return ok(self.worker,'command',name,participantId=self.source if name=='source' else self.target,command=command,request=request,mode=mode)

    def seal(self):
        self.command('source','source_start',peer_id=self.target)
        return ok(self.worker,'snapshot',participantId=self.source,switchId=self.switch)

    def upload(self):
        sealed=self.seal();self.command('target','destination_start',peer_receipt=sealed)
        count=(int(sealed['archive_size'])+262143)//262144;self.chunks=[]
        for number in range(count):
            raw=base64.b64decode(ok(self.worker,'download',participantId=self.source,switchId=self.switch,number=number))
            self.chunks.append(raw)
            ok(self.worker,'chunk','target',participantId=self.target,switchId=self.switch,epoch=self.status('target')['participant_epoch'],
                number=number,base64=base64.b64encode(raw).decode(),checksum=sha256(raw).hexdigest())
        assert sha256(b''.join(self.chunks)).hexdigest()==sealed['archive_sha256']
        return sealed

    def arm(self):self.upload();return self.command('target','destination_arm')
    def handoff(self):return self.command('source','source_handoff',peer_receipt=self.arm())


@pytest.fixture
def pair(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (context,worker,page,_):
        yield Pair(worker),context,page


def test_native_transfer_preserves_facts_and_requires_explicit_sync_before_a_writer(pair):
    pair,_,_=pair;worker=pair.worker;handed=pair.handoff()
    request=pair.request('target','destination_activate',peer_receipt=handed)
    receipt=pair.command('target','destination_activate',request=request)
    status=pair.status('target');assert status['state']=='active' and status['awaiting_sync']
    assert status['operation']['state']=='activated' and pair.status('source')['state']=='handed_off'
    current=ok(worker,'current','target');assert current['root']['activeGeneration']==pair.generation
    assert current['anchorGeneration']!=pair.generation
    assert call(worker,'write','target')['code']=='dataset_not_writable'
    assert call(worker,'write')['code']=='stale_epoch'
    before=ok(worker,'reads','target')
    assert pair.command('target','destination_activate',request=request)==receipt
    assert ok(worker,'reads','target')==before==2
    assert call(worker,'command','target',participantId=pair.target,command='destination_activate',
        request=request|{'expected_epoch':'4'})==dict(ok=False,code='migration_invalid')
    assert ok(worker,'reads','target')==before
    source=ok(worker,'inspect')['rows'];destination=ok(worker,'inspect','target')['rows']
    assert source==destination
    assert not any(row[0]==['text','forbidden-probe-write'] for row in destination['dataset_metadata'])


def test_native_cancel_and_discard_restore_only_the_original_source(pair):
    pair,_,_=pair;pair.arm();cancel=pair.command('source','source_cancel')
    discarded=pair.command('target','destination_discard',peer_receipt=cancel)
    pair.command('source','source_resume',peer_receipt=discarded)
    assert pair.status('source')['state']=='active' and pair.status('source')['participant_epoch']=='5'
    assert pair.status('target')['operation']['state']=='discarded'
    assert ok(pair.worker,'write') is True
    assert not call(pair.worker,'write','target',generation=pair.generation)['ok']


def test_native_discard_before_import_prevents_delayed_destination_start(pair):
    pair,_,_=pair;pair.command('source','source_start',peer_id=pair.target)
    cancel=pair.command('source','source_cancel');discard=pair.command('target','destination_discard',peer_receipt=cancel)
    pair.command('source','source_resume',peer_receipt=discard)
    delayed=pair.request('target','destination_start',peer_receipt=cancel)
    assert not call(pair.worker,'command','target',participantId=pair.target,command='destination_start',request=delayed)['ok']
    assert pair.status('target')['operation']['state']=='discarded'


@pytest.mark.parametrize('mode,code',[('wrong-owner','migration_wrong_account'),('offline','zenmoney_unavailable'),('rotate-owner','migration_busy')])
def test_native_fresh_owner_and_credential_epoch_are_required_before_arm(pair,mode,code):
    pair,_,_=pair;pair.upload();ok(pair.worker,'mode','target',mode=mode)
    request=pair.request('target','destination_arm')
    assert call(pair.worker,'command','target',participantId=pair.target,command='destination_arm',request=request)==dict(ok=False,code=code)
    assert pair.status('target')['state']=='import_hold'
    assert ok(pair.worker,'current','target')['root']['activeGeneration']!=pair.generation
    assert not call(pair.worker,'write','target',generation=pair.generation)['ok']


def test_native_chunk_ack_is_immutable_and_claimed_ownership_cannot_be_rebound(pair):
    pair,_,_=pair;pair.upload();raw=pair.chunks[0];epoch=pair.status('target')['participant_epoch']
    fields=dict(participantId=pair.target,switchId=pair.switch,epoch=epoch,number=0,base64=base64.b64encode(raw).decode(),checksum=sha256(raw).hexdigest())
    assert call(pair.worker,'chunk','target',**fields)['ok']
    altered=b'x'*len(raw);fields.update(base64=base64.b64encode(altered).decode(),checksum=sha256(altered).hexdigest())
    assert call(pair.worker,'chunk','target',**fields)==dict(ok=False,code='migration_invalid')
    assert call(pair.worker,'download','target',participantId=pair.target,switchId=pair.switch,number=0)==dict(ok=False,code='migration_incomplete')


def test_native_cancel_and_handoff_compete_for_one_source_decision(pair):
    pair,_,_=pair;armed=pair.arm()
    requests=[pair.request('source','source_cancel'),pair.request('source','source_handoff',peer_receipt=armed)]
    values=pair.worker.evaluate('''args=>Promise.all(args.commands.map(([command,request])=>authorityProbe.run('command',
      {name:'source',participantId:args.id,command,request})))''',dict(id=pair.source,commands=list(zip(['source_cancel','source_handoff'],requests))))
    assert sum(value['ok'] for value in values)==1,values
    source=pair.status('source');assert source['state'] in ('cancel_pending','handed_off')
    assert not call(pair.worker,'write')['ok'] and not call(pair.worker,'write','target')['ok']


def test_native_activation_quota_rolls_back_pointer_receipt_and_retirement_together(pair):
    pair,_,_=pair;handed=pair.handoff();before=ok(pair.worker,'current','target');request=pair.request('target','destination_activate',peer_receipt=handed)
    assert call(pair.worker,'command','target',participantId=pair.target,command='destination_activate',request=request,mode='quota')==dict(ok=False,code='quota_exceeded')
    assert ok(pair.worker,'current','target')==before
    assert pair.status('target')['state']=='armed' and pair.status('target')['participant_epoch']=='3'
    pair.command('target','destination_activate',request=request)
    assert pair.status('target')['awaiting_sync']


@pytest.mark.parametrize('mode,committed',[('pause-commit',False),('lost-reply',True)])
def test_native_worker_death_at_activation_recovers_exactly_one_authority_and_replay(pair,mode,committed):
    pair,context,page=pair;worker=pair.worker;handed=pair.handoff();request=pair.request('target','destination_activate',peer_receipt=handed)
    worker.evaluate('args=>{globalThis.pending=authorityProbe.run("command",args);return true;}',
        dict(name='target',participantId=pair.target,command='destination_activate',request=request,mode=mode))
    checkpoint(worker,page)
    before=worker.evaluate('boot');session=context.new_cdp_session(page)
    target=next(item for item in session.send('Target.getTargets')['targetInfos'] if item['url']==worker.url and item['type']=='service_worker')
    assert session.send('Target.closeTarget',{'targetId':target['targetId']})['success']
    assert page.evaluate('()=>chrome.runtime.sendMessage({type:"probe-wake"})')['boot']!=before
    worker=page;pair.worker=page
    ok(worker,'open');ok(worker,'open','target')
    assert pair.status('target')['state']==('active' if committed else 'armed')
    receipt=pair.command('target','destination_activate',request=request)
    assert receipt['state']=='activated' and pair.status('source')['state']=='handed_off'
    assert ok(worker,'reads','target')==(0 if committed else 1)


def test_native_late_import_cannot_delete_the_discarded_stage_header(pair):
    pair,_,page=pair;pair.upload();request=pair.request('target','destination_arm')
    assert call(pair.worker,'command','target',participantId=pair.target,command='destination_arm',request=request,mode='quota-import')==dict(ok=False,code='quota_exceeded')
    stages=ok(pair.worker,'inspect','target',generation=pair.generation)['stages']
    assert next(stage for stage in stages if stage['id']==pair.generation)['state']=='failed'
    pair.worker.evaluate('args=>{globalThis.pending=authorityProbe.run("command",args);return true;}',
        dict(name='target',participantId=pair.target,command='destination_arm',request=request,mode='pause-erase-header'))
    checkpoint(pair.worker,page)
    cancel=pair.command('source','source_cancel');pair.command('target','destination_discard',peer_receipt=cancel)
    ok(pair.worker,'release');result=pair.worker.evaluate('()=>globalThis.pending')
    assert not result['ok'] and result['code']=='stale_epoch'
    stages=ok(pair.worker,'inspect','target',generation=pair.generation)['stages']
    assert next(stage for stage in stages if stage['id']==pair.generation)['state']=='discarded'
    assert pair.status('target')['operation']['state']=='discarded'


def test_native_partial_source_snapshot_is_not_downloadable_and_restarts_after_worker_death(pair):
    pair,context,page=pair;worker=pair.worker
    pair.command('source','source_start',peer_id=pair.target)
    worker.evaluate('args=>{globalThis.pending=authorityProbe.run("snapshot",args);return true;}',
        dict(name='source',participantId=pair.source,switchId=pair.switch,mode='pause-chunk'))
    checkpoint(worker,page)
    status=pair.status('source');assert status['operation']['dataset_digest'] is None
    assert call(worker,'download',participantId=pair.source,switchId=pair.switch,number=0)==dict(ok=False,code='migration_incomplete')
    before=worker.evaluate('boot');session=context.new_cdp_session(page)
    target=next(item for item in session.send('Target.getTargets')['targetInfos'] if item['url']==worker.url and item['type']=='service_worker')
    assert session.send('Target.closeTarget',{'targetId':target['targetId']})['success']
    assert page.evaluate('()=>chrome.runtime.sendMessage({type:"probe-wake"})')['boot']!=before
    pair.worker=page;ok(pair.worker,'open');ok(pair.worker,'open','target')
    sealed=ok(pair.worker,'snapshot',participantId=pair.source,switchId=pair.switch)
    assert sealed['state']=='export_hold' and sealed['dataset_digest'] is not None
    assert base64.b64decode(ok(pair.worker,'download',participantId=pair.source,switchId=pair.switch,number=0))
    assert not call(pair.worker,'write')['ok']


@pytest.mark.parametrize('mode,code',[('wrong-owner','migration_wrong_account'),('offline','zenmoney_unavailable'),('rotate-owner','migration_busy')])
def test_native_fresh_owner_is_required_again_at_activation(pair,mode,code):
    pair,_,_=pair;handed=pair.handoff();ok(pair.worker,'mode','target',mode=mode)
    request=pair.request('target','destination_activate',peer_receipt=handed)
    assert call(pair.worker,'command','target',participantId=pair.target,command='destination_activate',request=request)==dict(ok=False,code=code)
    assert pair.status('target')['state']=='armed' and pair.status('source')['state']=='handed_off'
    assert not call(pair.worker,'write','target',generation=pair.generation)['ok']


def test_native_remote_route_never_reactivates_the_retained_source_and_anchor_is_required(pair):
    pair,_,_=pair;handed=pair.handoff();pair.command('target','destination_activate',peer_receipt=handed)
    old=ok(pair.worker,'current')['root']['activeGeneration']
    ok(pair.worker,'select-remote',participantId=pair.source,switchId=pair.switch,credentialRef=str(uuid4()))
    current=ok(pair.worker,'open');assert current['root']['activeMode']=='remote' and current['root']['activeGeneration'] is None
    assert call(pair.worker,'write',generation=old)['code']=='stale_epoch'
    assert pair.status('source')['state']=='handed_off'
    ok(pair.worker,'drop-marker')
    assert call(pair.worker,'open')==dict(ok=False,code='recovery_required')


def test_native_return_from_remote_uses_a_fresh_generation_and_keeps_old_handoff_final(pair):
    pair,_,_=pair;worker=pair.worker;handed=pair.handoff();pair.command('target','destination_activate',peer_receipt=handed)
    original=ok(worker,'current');ok(worker,'select-remote',participantId=pair.source,switchId=pair.switch,credentialRef=str(uuid4()))
    # A separate fixture models a server after a later explicit sync; L4 itself
    # cannot clear awaiting_sync on a newly activated participant.
    remote=ok(worker,'create','server')['participantId'];ok(worker,'seed','server',fixture=FIXTURE)
    switch=str(uuid4());slot=ok(worker,'reserve',switchId=switch,peerId=remote,credentialRef=str(uuid4()));local=slot['participantId']
    def command(name,id,command,**fields):
        epoch=ok(worker,'status',name,participantId=id,switchId=switch)['participant_epoch']
        return ok(worker,'command',name,participantId=id,command=command,
            request=dict(request_id=str(uuid4()),switch_id=switch,expected_epoch=epoch,**fields))
    command('server',remote,'source_start',peer_id=local)
    seal=ok(worker,'snapshot','server',participantId=remote,switchId=switch);command('source',local,'destination_start',peer_receipt=seal)
    for number in range((int(seal['archive_size'])+262143)//262144):
        raw=base64.b64decode(ok(worker,'download','server',participantId=remote,switchId=switch,number=number))
        ok(worker,'chunk',participantId=local,switchId=switch,epoch='2',number=number,base64=base64.b64encode(raw).decode(),checksum=sha256(raw).hexdigest())
    arm=command('source',local,'destination_arm');handed=command('server',remote,'source_handoff',peer_receipt=arm)
    command('source',local,'destination_activate',peer_receipt=handed)
    current=ok(worker,'open');assert current['root']['activeGeneration']==slot['generation']!=original['root']['activeGeneration']
    assert current['anchorGeneration']==original['anchorGeneration'] and local!=pair.source
    assert pair.status('source')['state']=='handed_off'
    assert not call(worker,'write',generation=original['root']['activeGeneration'])['ok']
    assert not call(worker,'write')['ok']


@pytest.mark.parametrize('table,column,value,code',[
    ('capture_jobs','capture_state','collecting','capture_not_quiescent'),
    ('deliveries','state','attempting','delivery_not_quiescent'),
])
def test_native_source_snapshot_requires_quiescent_financial_history(pair,table,column,value,code):
    pair,_,_=pair;fixture=deepcopy(FIXTURE)
    # The packaged schema defines exact tagged column positions.
    contract=json.loads(Path('/app/contracts/business/v1/sqlite-v7.json').read_text())
    columns=contract['tables'][table]['columns']
    position=[item['name'] if isinstance(item,dict) else item for item in columns].index(column)
    fixture['rows'][table][0][position]=['text',value];ok(pair.worker,'seed',fixture=fixture)
    pair.command('source','source_start',peer_id=pair.target)
    assert call(pair.worker,'snapshot',participantId=pair.source,switchId=pair.switch)==dict(ok=False,code=code)
    assert pair.status('source')['operation']['dataset_digest'] is None
    assert not call(pair.worker,'write')['ok']


@pytest.mark.parametrize('mode',['valid','unknown-hold'])
def test_native_v4_authority_upgrade_never_invents_a_hold_decision(pair,mode):
    pair,_,_=pair;result=ok(pair.worker,'upgrade-authority',mode=mode)
    if mode=='valid':
        assert result['code'] is None and result['version']==6
        assert len(result['participants'])==1 and result['participants'][0]['state']=='active'
    else:
        assert result['code']=='storage_corrupt' and result['version']==4
        assert result['participants'] is None and result['datasets'][0]['lifecycle']=='held'
