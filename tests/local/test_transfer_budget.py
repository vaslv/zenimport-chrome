"""Native whole-path fence budgets, no token/API/network usage."""
from uuid import uuid4
import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_authority import call,ok,FIXTURE,Pair
MAX=2**63-1


def fences(worker,name,*,epoch=None,credential=None,participant=None,id=None):
    worker.evaluate("""v=>new Promise((resolve,reject)=>{const r=indexedDB.open(v.name);r.onsuccess=()=>{
      const db=r.result,tx=db.transaction(['runtime','datasets','participant_controls'],'readwrite'),rs=tx.objectStore('runtime'),get=rs.get('runtime');
      get.onsuccess=()=>{const root=get.result;if(v.epoch!==null)root.epoch=v.epoch;if(v.credential!==null)root.credentialEpoch=v.credential;rs.put(root);
        if(v.participant!==null){const ps=tx.objectStore('participant_controls'),query=v.id?ps.get(v.id):ps.index('generation').get(root.activeGeneration);
          query.onsuccess=()=>{const p=query.result;p.epoch=v.participant;ps.put(p);const ds=tx.objectStore('datasets'),d=ds.get(p.generation);d.onsuccess=()=>{const value=d.result;value.participantEpoch=v.participant;ds.put(value);};};}
      };tx.oncomplete=()=>{db.close();resolve(true);};tx.onabort=()=>reject(Error('fixture-fence'));
    };})""",dict(name=name,epoch=None if epoch is None else str(epoch),credential=None if credential is None else str(credential),participant=None if participant is None else str(participant),id=id))


@pytest.mark.parametrize('mode',['source-hold','reserve-local','reserve-remote','journal'])
@pytest.mark.parametrize('boundary',['routing','credential'])
def test_unfinishable_fences_fail_before_any_hold_or_journal(tmp_path,mode,boundary):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,_,_):
        if mode=='reserve-remote':ok(worker,'create-remote',credentialRef=str(uuid4()),peerId=str(uuid4()),url='https://fixture.invalid')
        else:ok(worker,'create')
        if mode=='journal':
            ok(worker,'seed',fixture=FIXTURE);ok(worker,'rotate-for-setup',credentialRef=str(uuid4()))
        fences(worker,'source',**({'epoch':MAX-1} if boundary=='routing' else {'credential':MAX}))
        before=ok(worker,'current');switch=str(uuid4())
        if mode=='source-hold':
            result=call(worker,'command',participantId=before['participantId'],command='source_start',request=dict(request_id=str(uuid4()),switch_id=switch,expected_epoch='1',peer_id=str(uuid4())))
        elif mode=='journal':result=call(worker,'journal-create',switchId=switch,peerId=str(uuid4()),credentialRef=str(uuid4()))
        else:result=call(worker,'reserve',switchId=switch,peerId=str(uuid4()),credentialRef=str(uuid4()))
        assert not result['ok'],result
        assert ok(worker,'current')==before
        if mode=='journal':assert ok(worker,'journal-current') is None


@pytest.mark.parametrize('cancel',[False,True])
def test_last_safe_native_fences_allow_full_transfer_or_cancel(tmp_path,cancel):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,_,_):
        pair=Pair.__new__(Pair);pair.worker=worker;pair.switch=str(uuid4());pair.source=ok(worker,'create')['participantId'];pair.requests={}
        ok(worker,'seed',fixture=FIXTURE);fences(worker,'source',epoch=MAX-2,credential=MAX-1,participant=MAX-4)
        ok(worker,'create','target');fences(worker,'target',epoch=MAX-2,credential=MAX-1)
        destination=ok(worker,'reserve','target',switchId=pair.switch,peerId=pair.source,credentialRef=str(uuid4()))
        pair.target,pair.generation=destination['participantId'],destination['generation']
        fences(worker,'target',participant=MAX-3,id=pair.target)
        proof=pair.arm()
        # A credential repair cannot consume the final activation epoch.
        assert not call(worker,'credential','target',credentialRef=str(uuid4()))['ok']
        if cancel:
            stop=pair.command('source','source_cancel');discarded=pair.command('target','destination_discard',peer_receipt=stop)
            pair.command('source','source_resume',peer_receipt=discarded)
            assert pair.status('source')['participant_epoch']==str(MAX)
        else:
            handed=pair.command('source','source_handoff',peer_receipt=proof)
            pair.command('target','destination_activate',peer_receipt=handed)
            assert pair.status('target')['awaiting_sync']
            ok(worker,'select-remote',participantId=pair.source,switchId=pair.switch,credentialRef=str(uuid4()))
        for name in ['source','target']:assert ok(worker,'current',name)['root']['epoch']==str(MAX)
        assert pair.status('target')['participant_epoch']==str(MAX)
