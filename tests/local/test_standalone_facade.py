"""Standalone selection through the actual facade and installed native storage."""
from uuid import uuid4
import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_connections import discovery


def call(worker,action,name='standalone-facade',**args):
    return worker.evaluate('args=>applicationProbe.run(args.action,args)',dict(action=action,name=name,mode='standalone',**args))


def ok(worker,action,**args):
    value=call(worker,action,**args);assert value['ok'],value
    return value


def test_fresh_local_selection_needs_no_server_and_verified_token_retains_exact_catalog(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        before=ok(worker,'current');assert before['root']['activeMode']=='local' and not before['configured']
        assert before['reads']==0 and before['context']['generation']==before['root']['activeGeneration']
        selected=ok(worker,'verify-local');assert selected['configured'] and selected['owners']==['1']
        assert selected['context']['dataset_id']==before['context']['dataset_id']
        assert selected['context']['credential_epoch']!=before['context']['credential_epoch']
        catalog=ok(worker,'catalog')['catalog'];assert catalog['accounts'][0]['instrument']=='2'
        assert catalog['accounts'][0]['id']=='a'
        ok(worker,'patch',patch={'capture':{'phase':'planned','command':{'request_id':str(uuid4())}}})
        # Mirror activity's monotonic bit cannot invalidate scoped checkpoints.
        after=ok(worker,'current');assert after['state']['capture']['command']['request_id']
        assert after['root']['financialMayHaveStarted']


def test_malformed_prior_remote_configuration_never_initializes_a_local_writer(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        result=call(worker,'malformed-legacy');assert not result['ok'] and result['code']=='recovery_required'
        assert worker.evaluate('async()=>!(await indexedDB.databases()).some(value=>value.name==="standalone-facade")')


def test_named_local_facade_discovers_and_saves_accounts_without_financial_http(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        ok(worker,'current')
        detected=ok(worker,'local-discover',data=discovery(keys=('primary',)))
        assert detected['reads']==0 and not detected['configured']
        ok(worker,'verify-local')
        state=ok(worker,'local-discover',data=discovery(keys=('primary',)))
        assert state['configured'] and state['state']['capture'] is None
        # Inspect only fixture-owned rows to exercise the public configure DTO.
        account=worker.evaluate("""()=>new Promise(resolve=>{const r=indexedDB.open('standalone-facade');r.onsuccess=()=>{const db=r.result,t=db.transaction('f_bank_accounts'),q=t.objectStore('f_bank_accounts').getAll();q.onsuccess=()=>resolve(q.result[0].row[0][1]);t.oncomplete=()=>db.close();};})""")
        result=ok(worker,'local-settings',id=account,data=dict(expected_version='0',selection='enabled',zenmoney_account_id='a',import_start='2026-10-01'))
        assert result['root']['activeMode']=='local'
        assert result['state']['capture'] is None


def replace_local_generation(worker):
    return worker.evaluate("""()=>new Promise((resolve,reject)=>{const open=indexedDB.open('standalone-facade');open.onsuccess=async()=>{
      const db=open.result,tx=db.transaction(Array.from(db.objectStoreNames),'readwrite');
      const query=req=>new Promise((yes,no)=>{req.onsuccess=()=>yes(req.result);req.onerror=()=>no(req.error);});
      try{const roots=tx.objectStore('runtime'),root=await query(roots.get('runtime')),datasets=tx.objectStore('datasets'),old=await query(datasets.get(root.activeGeneration));
        const generation=crypto.randomUUID(),participantId=crypto.randomUUID();
        for(const name of Array.from(db.objectStoreNames).filter(value=>value.startsWith('f_'))){const store=tx.objectStore(name),rows=await query(store.getAll());for(const row of rows)if(row.generation===old.generation)store.put({...row,generation});}
        datasets.put({...old,lifecycle:'retired'});datasets.add({...old,generation,datasetId:crypto.randomUUID(),participantId,participantEpoch:'1',lifecycle:'active',holdId:null});
        tx.objectStore('participant_controls').add({id:participantId,generation,epoch:'1',state:'active',operationId:null,everActivated:true,awaitingSync:true});
        const next={...root,activeGeneration:generation,epoch:String(BigInt(root.epoch)+1n),credentialEpoch:String(BigInt(root.credentialEpoch)+1n)};roots.put(next);
        tx.oncomplete=()=>{db.close();resolve({root:next,participantId});};tx.onabort=()=>reject(tx.error);
      }catch(error){tx.abort();reject(error);}
    };})""")


@pytest.mark.parametrize('operation',['verify','sync'])
def test_suspended_old_facade_cannot_change_new_local_credentials_or_release_first_sync(tmp_path,operation):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,page,_):
        ok(worker,'current');ok(worker,'verify-local');ok(worker,'catalog')
        ok(worker,'pause-local-operation',token=operation,data=dict(request_id=str(uuid4()),connection_id=str(uuid4())))
        for _ in range(200):
            if ok(worker,'operation-checkpoint')['paused']:break
            page.wait_for_timeout(20)
        else:pytest.fail('Facade checkpoint not reached')
        target=replace_local_generation(worker)
        ok(worker,'operation-release');result=call(worker,'operation-result')
        assert not result['ok'] and result['code'] in ('stale_epoch','stale_context'),result
        observed=worker.evaluate("""id=>new Promise(resolve=>{const r=indexedDB.open('standalone-facade');r.onsuccess=()=>{const db=r.result,t=db.transaction(['runtime','participant_controls']),a=t.objectStore('runtime').get('runtime'),b=t.objectStore('participant_controls').get(id);t.oncomplete=()=>{resolve({root:a.result,participant:b.result});db.close();};};})""",target['participantId'])
        assert observed['root']==target['root'] and observed['participant']['awaitingSync']


@pytest.mark.parametrize('operation',['discover','rename'])
def test_same_generation_token_rotation_fences_late_metadata_operations(tmp_path,operation):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,page,_):
        ok(worker,'current');ok(worker,'verify-local');ok(worker,'local-discover',data=discovery(keys=('primary',)))
        connection=worker.evaluate("""()=>new Promise(resolve=>{const r=indexedDB.open('standalone-facade');r.onsuccess=()=>{const db=r.result,t=db.transaction('f_connections'),q=t.objectStore('f_connections').getAll();q.onsuccess=()=>resolve(q.result[0].row[0][1]);t.oncomplete=()=>db.close();};})""")
        data=discovery(keys=('primary',));data['label']='stale-label-must-not-commit'
        ok(worker,'pause-local-operation',token=operation,id=connection,data=data)
        for _ in range(200):
            if ok(worker,'operation-checkpoint')['paused']:break
            page.wait_for_timeout(20)
        else:pytest.fail('Metadata checkpoint not reached')
        before=ok(worker,'verify-local')['root']
        ok(worker,'operation-release');result=call(worker,'operation-result')
        assert not result['ok'] and result['code']=='stale_epoch',result
        assert ok(worker,'current')['root']==before
        labels=worker.evaluate("""()=>new Promise(resolve=>{const r=indexedDB.open('standalone-facade');r.onsuccess=()=>{const db=r.result,t=db.transaction('f_connection_labels'),q=t.objectStore('f_connection_labels').getAll();q.onsuccess=()=>resolve(q.result.map(row=>row.row));t.oncomplete=()=>db.close();};})""")
        assert 'stale-label-must-not-commit' not in str(labels)


def imported_state(worker,participant):
    return worker.evaluate("""id=>new Promise(resolve=>{const r=indexedDB.open('standalone-facade');r.onsuccess=()=>{const db=r.result,t=db.transaction(['participant_controls','application_state','f_capture_jobs']),p=t.objectStore('participant_controls').get(id),s=t.objectStore('application_state').getAll(),j=t.objectStore('f_capture_jobs').getAll();t.oncomplete=()=>{resolve({participant:p.result,receipts:s.result.filter(row=>row.scope.startsWith('local-first-sync:')),jobs:j.result});db.close();};};})""",participant)


def ready_imported(worker):
    ok(worker,'current');ok(worker,'verify-local');ok(worker,'local-discover',data=discovery(keys=('primary',)))
    ids=worker.evaluate("""()=>new Promise(resolve=>{const r=indexedDB.open('standalone-facade');r.onsuccess=()=>{const db=r.result,t=db.transaction(['f_connections','f_bank_accounts']),c=t.objectStore('f_connections').getAll(),a=t.objectStore('f_bank_accounts').getAll();t.oncomplete=()=>{resolve({connection:c.result[0].row[0][1],account:a.result[0].row[0][1]});db.close();};};})""")
    ok(worker,'local-settings',id=ids['account'],data=dict(expected_version='0',selection='enabled',zenmoney_account_id='a',import_start='2026-10-01'))
    target=replace_local_generation(worker);participant=target['participantId']
    return ids,target


def test_imported_sync_acceptance_and_barrier_release_are_one_native_transaction(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        ids,target=ready_imported(worker);participant=target['participantId']
        for data,code in [(dict(request_id=str(uuid4())),'validation_error'),(dict(request_id=str(uuid4()),connection_id=str(uuid4())),'not_found')]:
            result=call(worker,'local-start',data=data);assert not result['ok'] and result['code']==code,result
            state=imported_state(worker,participant);assert state['participant']['awaitingSync'] and not state['receipts'] and not state['jobs']
        request=dict(request_id=str(uuid4()),connection_id=ids['connection'])
        result=call(worker,'local-start',data=request,token='quota-first-sync')
        assert not result['ok'] and result['code']=='quota_exceeded',result
        state=imported_state(worker,participant);assert state['participant']['awaitingSync'] and not state['receipts'] and not state['jobs']
        ok(worker,'local-start',data=request)
        state=imported_state(worker,participant);assert not state['participant']['awaitingSync']
        assert len(state['jobs'])==1 and state['receipts'][0]['value']['requestId']==request['request_id']


@pytest.mark.parametrize('point',['before-transaction','during-job-write'])
def test_imported_sync_expiry_before_or_during_acceptance_rolls_back_the_whole_job(tmp_path,point):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,page,_):
        ids,target=ready_imported(worker);participant=target['participantId']
        request=dict(request_id=str(uuid4()),connection_id=ids['connection'])
        started=ok(worker,'pause-sync-acceptance',token=point,data=request)
        if point=='before-transaction':
            for _ in range(200):
                if ok(worker,'operation-checkpoint')['paused']:break
                page.wait_for_timeout(20)
            else:pytest.fail('Native acceptance checkpoint not reached')
            ok(worker,'clock',now=started['at']+600);ok(worker,'operation-release')
        result=call(worker,'operation-result');assert not result['ok'] and result['code']=='dataset_not_writable',result
        assert ok(worker,'operation-checkpoint')['paused'], 'Expiry injection did not reach the native write'
        state=imported_state(worker,participant)
        assert state['participant']['awaitingSync'] and not state['receipts'] and not state['jobs']
