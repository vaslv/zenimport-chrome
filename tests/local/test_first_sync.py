"""Imported setup never grants financial writes before an explicit sync."""
from uuid import uuid4
import pytest
from test_authority import pair,ok,call


def activate(pair):
    handoff=pair.handoff()
    pair.command('target','destination_activate',peer_receipt=handoff)


def test_imported_setup_requires_fresh_token_bound_mirror_and_explicit_sync(pair):
    pair,_,_=pair;worker=pair.worker;activate(pair)
    assert call(worker,'setup-write','target')['code']=='dataset_not_writable'
    assert call(worker,'prepare-setup','target')['code']=='dataset_not_writable'
    ok(worker,'refresh-for-setup','target')
    assert call(worker,'prepare-setup','target',mode='wrong-owner')['code']=='dataset_not_writable'
    assert ok(worker,'prepare-setup','target')=={'prepared':True}
    before=ok(worker,'inspect','target')['rows']
    assert ok(worker,'setup-write','target') is True
    after=ok(worker,'inspect','target')['rows']
    for table in before:
        if table!='connection_labels':assert after[table]==before[table],table
    assert call(worker,'setup-write','target',mode='forbidden')['code']=='dataset_not_writable'
    assert call(worker,'write','target')['code']=='dataset_not_writable'
    assert pair.status('target')['awaiting_sync'] is True
    request=str(uuid4())
    assert ok(worker,'first-sync','target',requestId=request)=={'released':True}
    assert ok(worker,'first-sync','target',requestId=request)=={'released':False}
    assert pair.status('target')['awaiting_sync'] is False
    assert ok(worker,'write','target') is True
    assert not call(worker,'write')['ok']


@pytest.mark.parametrize('mode',['stale','wrong-token'])
def test_stale_or_different_token_mirror_cannot_unlock_imported_setup(pair,mode):
    pair,_,_=pair;activate(pair);ok(pair.worker,'refresh-for-setup','target',mode=mode)
    assert call(pair.worker,'prepare-setup','target')['code']=='dataset_not_writable'
    assert call(pair.worker,'first-sync','target',requestId=str(uuid4()))['code']=='dataset_not_writable'
    assert pair.status('target')['awaiting_sync'] is True


def test_rotated_credentials_revoke_an_existing_setup_permit(pair):
    pair,_,_=pair;activate(pair);worker=pair.worker
    ok(worker,'refresh-for-setup','target');ok(worker,'prepare-setup','target')
    ok(worker,'rotate-for-setup','target',credentialRef=str(uuid4()))
    assert call(worker,'setup-write','target')['code']=='dataset_not_writable'
    assert call(worker,'first-sync','target',requestId=str(uuid4()))['code']=='dataset_not_writable'
    assert pair.status('target')['awaiting_sync'] is True


def test_sync_ack_and_audit_roll_back_together_on_quota(pair):
    pair,_,_=pair;activate(pair);worker=pair.worker
    ok(worker,'refresh-for-setup','target');ok(worker,'prepare-setup','target')
    request=str(uuid4())
    assert call(worker,'first-sync','target',requestId=request,mode='quota')['code']=='quota_exceeded'
    assert pair.status('target')['awaiting_sync'] is True
    assert call(worker,'write','target')['code']=='dataset_not_writable'
    assert ok(worker,'first-sync','target',requestId=request)=={'released':True}


def test_imported_account_configuration_remains_setup_only(pair):
    pair,_,_=pair;activate(pair);worker=pair.worker
    ok(worker,'refresh-for-setup','target');ok(worker,'prepare-setup','target')
    before=ok(worker,'inspect','target')['rows']
    result=ok(worker,'setup-configure','target')
    assert result['selection']=='ignored'
    after=ok(worker,'inspect','target')['rows']
    for table in ['delivery_attempts','processing_receipts','processing_targets','bank_transactions']:
        assert before[table]==after[table],table
    assert pair.status('target')['awaiting_sync'] is True
    assert call(worker,'write','target')['code']=='dataset_not_writable'
