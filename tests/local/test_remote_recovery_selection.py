"""Native remote restore route binding; no financial API or real credentials."""
from copy import deepcopy
from hashlib import sha256
import json
from uuid import uuid4
import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_authority import ok,call


def setup(worker,owners=None):
    source,dataset,restored=str(uuid4()),str(uuid4()),str(uuid4())
    root=ok(worker,'create-remote',credentialRef=str(uuid4()),url='http://127.0.0.1:19999',peerId=str(uuid4()))['root']
    ok(worker,'bind-remote',request=dict(installationId=source,datasetId=dataset))
    request=dict(id=str(uuid4()),installation_id=source,expected_epoch='1',dataset_id=restored,archive_sha256='a'*64,
        archive_size='10',owner_ids=owners or ['1'],former_writers_retired=True,accept_post_snapshot_evidence_loss=True)
    intent=ok(worker,'recovery-select-begin',request=dict(root=root,request=request))
    held=ok(worker,'current')['root']
    assert held['pendingSwitchId']==request['id'] and int(held['epoch'])==int(root['epoch'])+1
    return root,dataset,request,intent


def proof(request,phase='activated',dataset=None):
    status=dict(id=request['id'],kind='recovery',phase=phase,installation_id=request['installation_id'],initial_epoch=request['expected_epoch'],
        dataset_id=request['dataset_id'],created_at='1792540800',archive_sha256=request['archive_sha256'],archive_size=request['archive_size'],
        chunks='1',dataset_digest='b'*64,acknowledged_at=None,error_code=None)
    identity=dict(protocol_version='2',archive_version='2',financial_schema_version='1',chunk_bytes='262144',max_archive_bytes='67108864',
        installation_id=request['installation_id'],dataset_id=dataset or request['dataset_id'],participant_epoch='3',state='active',operation_id=None,
        awaiting_sync=phase=='activated',legacy_hold=None,can_import=False,owner_ids=['1'],checked_at='1792540800')
    return dict(status=status,identity=identity)


def activate(worker,request,intent,**args):
    return call(worker,'recovery-select-activated',switchId=request['id'],credentialRef=intent['selectedRef'],peerId=intent['selectedContext'],request=proof(request),**args)


def test_native_remote_restore_rebinds_only_after_permanent_activation_and_survives_reopen(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        root,_,request,intent=setup(worker)
        assert activate(worker,request,intent)['ok']
        selected=ok(worker,'current')['root'];descriptor=ok(worker,'remote-context')
        assert selected['credentialRef']==intent['selectedRef'] and selected['pendingSwitchId'] is None
        assert int(selected['epoch'])==int(root['epoch'])+2 and int(selected['credentialEpoch'])==int(root['credentialEpoch'])+1
        assert descriptor['datasetId']==request['dataset_id'] and descriptor['contextId']==intent['selectedContext']
        ok(worker,'open')
        assert ok(worker,'recovery-select-current')['phase']=='activated'
        assert activate(worker,request,intent)['ok']
        assert ok(worker,'current')['root']==selected


@pytest.mark.parametrize('field',['status_phase','status_hash','status_id','peer_installation','peer_dataset','peer_epoch','peer_owner','peer_hold'])
def test_native_bad_or_stale_remote_restore_proof_cannot_release_the_route_hold(tmp_path,field):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        _,_,request,intent=setup(worker);before=ok(worker,'current')['root'];input=proof(request)
        if field=='status_phase':input['status']['phase']='preview'
        if field=='status_hash':input['status']['archive_sha256']='c'*64
        if field=='status_id':input['status']['id']=str(uuid4())
        if field=='peer_installation':input['identity']['installation_id']=str(uuid4())
        if field=='peer_dataset':input['identity']['dataset_id']=str(uuid4())
        if field=='peer_epoch':input['identity']['participant_epoch']='2'
        if field=='peer_owner':input['identity']['owner_ids']=['2']
        if field=='peer_hold':input['identity'].update(state='import_hold',operation_id=request['id'])
        result=call(worker,'recovery-select-activated',switchId=request['id'],credentialRef=intent['selectedRef'],peerId=intent['selectedContext'],request=input)
        assert not result['ok'] and result['code']=='migration_invalid',result
        assert ok(worker,'current')['root']==before
        assert ok(worker,'recovery-select-current')['phase']=='pending'


def test_native_restore_selection_quota_rolls_back_the_descriptor_and_root_together(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        _,_,request,intent=setup(worker);before=ok(worker,'current')['root']
        result=activate(worker,request,intent,mode='quota-selection');assert result['code']=='quota_exceeded',result
        assert ok(worker,'current')['root']==before and ok(worker,'recovery-select-current')['phase']=='pending'
        # The same reserved descriptor is still free after rollback.
        assert activate(worker,request,intent)['ok']


def test_native_confirmed_cancellation_keeps_original_dataset_and_never_grants_a_new_writer(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        root,dataset,request,_=setup(worker)
        result=ok(worker,'recovery-select-cancelled',switchId=request['id'],request=proof(request,'cancelled',dataset))
        assert result['phase']=='cancelled'
        after=ok(worker,'current')['root']
        assert after['credentialRef']==root['credentialRef'] and after['credentialEpoch']==root['credentialEpoch']
        assert after['pendingSwitchId'] is None and int(after['epoch'])==int(root['epoch'])+2
        assert ok(worker,'remote-context')['datasetId']==dataset
        assert call(worker,'recovery-select-cancelled',switchId=request['id'],request=proof(request,'cancelled',dataset))['ok']


@pytest.mark.parametrize('bad',[None,'hash','dataset','epoch','quota'])
def test_unused_withdrawal_releases_only_the_exact_rejected_begin(tmp_path,bad):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        root,dataset,request,_=setup(worker);before=ok(worker,'current')['root']
        checked=proof(request,'cancelled',dataset)['identity'];checked['participant_epoch']='1'
        digest=sha256(json.dumps(request,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
        withdrawal=dict(withdrawal_version='1',decision='withdrawn',id=request['id'],request_sha256=digest,
            installation_id=request['installation_id'],dataset_id=dataset,participant_epoch='1')
        if bad=='hash':withdrawal['request_sha256']='f'*64
        if bad=='dataset':withdrawal['dataset_id']=str(uuid4())
        if bad=='epoch':withdrawal['participant_epoch']='2'
        result=call(worker,'recovery-select-withdrawn',switchId=request['id'],request=dict(proof=withdrawal,identity=checked),
            **({'mode':'quota-selection'} if bad=='quota' else {}))
        if bad:
            assert not result['ok'],result
            assert ok(worker,'current')['root']==before and ok(worker,'recovery-select-current')['phase']=='pending'
        else:
            assert result['ok'],result
            after=ok(worker,'current')['root'];assert after['pendingSwitchId'] is None
            assert after['credentialRef']==root['credentialRef'] and after['credentialEpoch']==root['credentialEpoch']
            assert call(worker,'recovery-select-withdrawn',switchId=request['id'],request=dict(proof=withdrawal,identity=checked))['ok']


def test_wrong_archive_owner_does_not_trap_an_authenticated_unused_withdrawal(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        root,dataset,request,_=setup(worker,owners=['2'])
        checked=proof(request,'cancelled',dataset)['identity'];checked['participant_epoch']='1'
        digest=sha256(json.dumps(request,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
        withdrawal=dict(withdrawal_version='1',decision='withdrawn',id=request['id'],request_sha256=digest,
            installation_id=request['installation_id'],dataset_id=dataset,participant_epoch='1')
        assert ok(worker,'recovery-select-withdrawn',switchId=request['id'],request=dict(proof=withdrawal,identity=checked))['phase']=='cancelled'
        after=ok(worker,'current')['root']
        assert after['credentialRef']==root['credentialRef'] and after['credentialEpoch']==root['credentialEpoch'] and after['pendingSwitchId'] is None
