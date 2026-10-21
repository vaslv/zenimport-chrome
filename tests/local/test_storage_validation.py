"""Persistent facts-only proofs never grant activation or fresh API ownership."""
from copy import deepcopy
import json
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_storage import call
from test_storage_relations import column

FIXTURE=json.loads(Path('/app/contracts/business/v1/portable-financial-v2.json').read_text())


@pytest.mark.parametrize('name',['portable-financial-v2','portable-legacy-v2'])
def test_native_validated_stage_survives_restart_without_switching_active_data(tmp_path,name):
    fixture=json.loads(Path('/app/contracts/business/v1',name+'.json').read_text())
    extension,profile=tmp_path/'extension',tmp_path/'profile'
    with sync_playwright() as p:
        with installed(p,extension,profile) as (_,_,page,identifier):
            original=call(page,'open')['value'];fence=original['context']
            stage=call(page,'stage',fence=fence,golden=fixture)['value']
            result=call(page,'validate-graph',fence=fence,stageId=stage['id']);assert result['ok'],result
            validated=result['value']
            assert validated==stage|dict(state='graph_valid',graphVersion='1',graphDigest=fixture['expected_digest'],graphVerifiedAt='1792540800')
            assert call(page,'validate-graph',fence=fence,stageId=stage['id'],now='1792540900')==result
            assert call(page,'open')['value']['context']==fence
            assert call(page,'open')['value']['state']['rows']==original['state']['rows']
            state=call(page,'state')['value']
            dataset=next(item for item in state['datasets'] if item['generation']==stage['id'])
            assert dataset['lifecycle']=='validated' and dataset['holdId'] is None
            assert call(page,'kernel',fence=fence|{'generation':stage['id']},operations=[])==dict(ok=False,code='stale_epoch')
        with installed(p,extension,profile,known_id=identifier) as (_,_,page,_):
            assert call(page,'open')['value']['context']==fence
            assert call(page,'stages')==dict(ok=True,value=[validated])
            assert call(page,'graph-proof',fence=fence,stageId=stage['id'])['ok']


def test_native_failed_graph_proof_cannot_mark_a_rehashed_archive_as_validated(tmp_path):
    fixture=deepcopy(FIXTURE)
    fixture['rows']['capture_pages'][0][column('capture_pages','digest')]=['text','0'*64]
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,_,page,_):
        original=call(page,'open')['value'];fence=original['context']
        stage=call(page,'stage',fence=fence,golden=fixture)['value']
        assert call(page,'validate-graph',fence=fence,stageId=stage['id'])==dict(ok=False,code='invalid_page_digest')
        failed=call(page,'stages')['value'][0]
        assert failed==stage|dict(state='failed',errorCode='invalid_page_digest')
        dataset=next(item for item in call(page,'state')['value']['datasets'] if item['generation']==stage['id'])
        assert dataset['lifecycle']=='staging'
        assert call(page,'open')['value']['state']['rows']==original['state']['rows']


@pytest.mark.parametrize('problem,code',[('epoch','stale_epoch'),('marker','recovery_required')])
def test_native_revoked_context_never_records_a_financial_verdict(tmp_path,problem,code):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,page,_):
        fence=call(page,'open')['value']['context']
        stage=call(page,'stage',fence=fence,golden=FIXTURE)['value']
        if problem=='marker':worker.evaluate('()=>chrome.storage.local.remove("localDatasetSentinel")')
        assert call(page,'validate-graph',fence=fence|({'epoch':'2'} if problem=='epoch' else {}),stageId=stage['id'])==dict(ok=False,code=code)
        assert call(page,'stages')==dict(ok=True,value=[stage])


def test_native_stage_upgrade_adds_no_proof_and_malformed_upgrade_rolls_back(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,_,page,_):
        fence=call(page,'open')['value']['context']
        stage=call(page,'stage',fence=fence,golden=FIXTURE)['value']
        for mode in ('upgrade-stage-v3','failed-upgrade-stage-v3'):
            result=call(page,'kernel',fence=fence,mode=mode);assert result['ok'],result
            value=result['value'];old=value['stages'][0]
            assert old['id']==stage['id'] and old['state']=='format_valid'
            if mode=='upgrade-stage-v3':
                assert value['code'] is None and value['version']==6
                assert all(old[key] is None for key in ('graphVersion','graphDigest','graphVerifiedAt'))
            else:
                assert value['code']=='storage_corrupt' and value['version']==3
                assert not any(key in old for key in ('graphVersion','graphDigest','graphVerifiedAt'))
                assert old['unexpected']=='reject'


def test_native_cached_verdict_never_skips_a_fresh_integrity_check(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,page,_):
        original=call(page,'open')['value'];fence=original['context']
        stage=call(page,'stage',fence=fence,golden=FIXTURE)['value']
        assert call(page,'validate-graph',fence=fence,stageId=stage['id'])['ok']
        worker.evaluate('''id=>new Promise((resolve,reject)=>{
          const request=indexedDB.open('l4-financial');request.onerror=()=>reject(Error('open-failed'));
          request.onsuccess=()=>{
            const db=request.result,tx=db.transaction('f_dataset_metadata','readwrite'),store=tx.objectStore('f_dataset_metadata');
            const cursor=store.index('generation').openCursor(IDBKeyRange.only(id));
            cursor.onsuccess=()=>{const item=cursor.result;if(!item){tx.abort();return;}
              const value=item.value;value.row[1]=['text','tampered'];item.update(value);};
            tx.oncomplete=()=>{db.close();resolve(true);};tx.onabort=()=>{db.close();reject(Error('tamper-failed'));};
          };
        })''',stage['id'])
        assert call(page,'validate-graph',fence=fence,stageId=stage['id'])==dict(ok=False,code='table_integrity_mismatch')
        failed=call(page,'stages')['value'][0]
        assert failed['state']=='failed' and failed['graphVersion'] is None and failed['graphVerifiedAt'] is None
        assert call(page,'open')['value']['state']['rows']==original['state']['rows']


def test_native_quota_at_final_verdict_rolls_back_stage_and_lifecycle_together(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,_,page,_):
        fence=call(page,'open')['value']['context']
        stage=call(page,'stage',fence=fence,golden=FIXTURE)['value']
        assert call(page,'validate-graph',fence=fence,stageId=stage['id'],mode='quota-final-commit')==dict(ok=False,code='quota_exceeded')
        assert call(page,'stages')==dict(ok=True,value=[stage])
        dataset=next(item for item in call(page,'state')['value']['datasets'] if item['generation']==stage['id'])
        assert dataset['lifecycle']=='staging'
        assert call(page,'validate-graph',fence=fence,stageId=stage['id'])['ok']


def test_native_worker_death_before_verdict_commit_retains_retryable_unverified_stage(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (context,worker,page,_):
        fence=call(page,'open')['value']['context']
        stage=call(page,'stage',fence=fence,golden=FIXTURE)['value']
        worker.evaluate('args=>{globalThis.verdict=storageProbe.run("validate-graph",args);return true;}',
            dict(name='l4-financial',fence=fence,stageId=stage['id'],mode='pause-final-commit'))
        for _ in range(300):
            if call(page,'graph-checkpoint')['value']:break
            page.wait_for_timeout(20)
        assert call(page,'graph-checkpoint')==dict(ok=True,value=True)
        assert call(page,'stages')==dict(ok=True,value=[stage])
        session=context.new_cdp_session(page)
        target=next(item for item in session.send('Target.getTargets')['targetInfos'] if item['url']==worker.url and item['type']=='service_worker')
        assert session.send('Target.closeTarget',{'targetId':target['targetId']})['success']
        assert call(page,'open')['value']['context']==fence
        assert call(page,'stages')==dict(ok=True,value=[stage])
        assert call(page,'validate-graph',fence=fence,stageId=stage['id'])['ok']
