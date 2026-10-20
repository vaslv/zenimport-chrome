"""Inactive native IDB imports; format success deliberately grants no activation."""
import json
import time
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_storage import call
import pytest

GOLDEN=json.loads(Path('/app/contracts/business/v1/portable-golden-v2.json').read_text())


def test_native_format_valid_import_is_a_fresh_inactive_generation_and_survives_restart(tmp_path):
    extension,profile=tmp_path/'extension',tmp_path/'profile'
    with sync_playwright() as p:
        with installed(p,extension,profile) as (_,_,page,identifier):
            original=call(page,'open')['value'];fence=original['context']
            imported=call(page,'stage',fence=fence,golden=GOLDEN);assert imported['ok'],imported
            stage=imported['value'];assert stage['state']=='format_valid' and stage['datasetDigest']==GOLDEN['expected_digest']
            assert stage['rowCount']==str(sum(len(rows) for rows in GOLDEN['rows'].values()))
            assert stage['datasetId']==GOLDEN['dataset_id'] and stage['id']!=fence['generation']
            state=call(page,'state')['value'];assert state['runtime']['activeGeneration']==fence['generation']
            assert next(item for item in state['datasets'] if item['generation']==stage['id'])['lifecycle']=='staging'
            assert call(page,'kernel',fence=fence|{'generation':stage['id']},operations=[])=={'ok':False,'code':'stale_epoch'}
            assert call(page,'open')['value']['state']['rows']==original['state']['rows']
        with installed(p,extension,profile,known_id=identifier) as (_,_,page,_):
            assert call(page,'open')['ok']
            assert call(page,'stages')=={'ok':True,'value':[stage]}
            assert call(page,'open')['value']['context']==fence


def test_native_bad_table_hash_keeps_partial_import_inactive_and_records_failure(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,_,page,_):
        original=call(page,'open')['value']
        result=call(page,'stage',fence=original['context'],golden=GOLDEN,mode='bad-hash')
        assert result=={'ok':False,'code':'table_integrity_mismatch'},result
        stages=call(page,'stages')['value'];assert len(stages)==1 and stages[0]['state']=='failed'
        assert stages[0]['archiveSha256'] is None and stages[0]['errorCode']=='table_integrity_mismatch'
        assert call(page,'open')['value']['state']['rows']==original['state']['rows']
        assert call(page,'open')['value']['context']==original['context']


def test_native_stale_import_fence_cannot_create_or_install_a_generation(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,_,page,_):
        original=call(page,'open')['value']
        assert call(page,'stage',fence=original['context']|{'epoch':'2'},golden=GOLDEN)=={'ok':False,'code':'stale_epoch'}
        assert call(page,'stages')=={'ok':True,'value':[]}
        assert len(call(page,'state')['value']['datasets'])==1


def test_native_quota_in_a_staging_batch_cannot_replace_active_data(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,_,page,_):
        original=call(page,'open')['value']
        result=call(page,'stage',fence=original['context'],golden=GOLDEN,mode='quota')
        assert result=={'ok':False,'code':'quota_exceeded'},result
        stages=call(page,'stages')['value'];assert len(stages)==1 and stages[0]['state']=='failed'
        assert stages[0]['rowCount']=='2' and stages[0]['errorCode']=='quota_exceeded'
        assert call(page,'stage',fence=original['context'],golden=GOLDEN)['ok']
        assert sorted(value['state'] for value in call(page,'stages')['value'])==['failed','format_valid']
        assert call(page,'open')['value']['state']['rows']==original['state']['rows']


@pytest.mark.parametrize('count',[1000,10000,100000])
def test_native_large_financial_envelopes_remain_inactive_and_exact(tmp_path,count):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,page,_):
        original=call(page,'open')['value']
        result=worker.evaluate('args=>storageProbe.run("stage",args)',dict(name='l4-financial',fence=original['context'],golden=GOLDEN,count=count))
        assert result['ok'],result
        stage=result['value'];assert stage['state']=='format_valid' and stage['rowCount']==str(count+4)
        assert int(stage['byteCount'])>count*1900
        assert stage['maxTransactionMs']<10000
        assert call(page,'open')['value']['state']['rows']==original['state']['rows']
        assert call(page,'open')['value']['context']==original['context']
        Path('/results').mkdir(exist_ok=True)
        peak=int(Path('/sys/fs/cgroup/memory.peak').read_text());assert 0<peak<3*1024**3
        label='chrome140' if os.getenv('CHROME_EXECUTABLE') else 'chromium145'
        Path('/results',f'l4-staging-{label}-{count}.json').write_text(json.dumps(dict(count=count,bytes=stage['byteCount'],elapsed_ms=stage['elapsedMs'],
            max_transaction_ms=stage['maxTransactionMs'],cgroup_peak_bytes=peak,user_agent=worker.evaluate('navigator.userAgent'))))


def test_native_worker_death_during_import_retains_only_an_inactive_loading_generation(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (context,worker,page,_):
        original=call(page,'open')['value'];fence=original['context']
        worker.evaluate('args=>{globalThis.loading=storageProbe.run("stage",args);return true;}',
                        dict(name='l4-financial',fence=fence,golden=GOLDEN,count=100000))
        deadline=time.monotonic()+180;stage=None
        while time.monotonic()<deadline:
            values=call(page,'stages')['value']
            if values and int(values[0]['rowCount'])>=500:stage=values[0];break
            page.wait_for_timeout(10)
        assert stage and stage['state']=='loading' and 500<=int(stage['rowCount'])<=5000,stage
        session=context.new_cdp_session(page)
        target=next(target for target in session.send('Target.getTargets')['targetInfos'] if target['url']==worker.url and target['type']=='service_worker')
        assert session.send('Target.closeTarget',{'targetId':target['targetId']})['success']
        assert call(page,'open')['value']['context']==fence
        assert call(page,'open')['value']['state']['rows']==original['state']['rows']
        retained=call(page,'stages')['value'];assert len(retained)==1 and retained[0]['state']=='loading'
        assert call(page,'stage',fence=fence,golden=GOLDEN)['ok']
        assert sorted(value['state'] for value in call(page,'stages')['value'])==['format_valid','loading']


def test_native_removing_the_independent_marker_stops_an_import_before_completion(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,page,_):
        original=call(page,'open')['value'];fence=original['context']
        worker.evaluate('args=>{globalThis.loading=storageProbe.run("stage",args);return true;}',
                        dict(name='l4-financial',fence=fence,golden=GOLDEN,count=10000))
        deadline=time.monotonic()+90;stage=None
        while time.monotonic()<deadline:
            values=call(page,'stages')['value']
            if values and int(values[0]['rowCount'])>=500:stage=values[0];break
            page.wait_for_timeout(10)
        assert stage and stage['state']=='loading' and int(stage['rowCount'])<9000,stage
        worker.evaluate('()=>chrome.storage.local.remove("localDatasetSentinel")')
        assert worker.evaluate('()=>globalThis.loading')=={'ok':False,'code':'recovery_required'}
        # Inspect existing native control without invoking bootstrap or repairing
        # the intentionally removed marker. This readonly probe cannot create data.
        persisted=worker.evaluate('''id=>new Promise((resolve,reject)=>{
          const request=indexedDB.open('l4-financial');request.onupgradeneeded=()=>{request.transaction.abort();reject(Error('unexpected-create'));};
          request.onerror=()=>reject(Error('native-read-failed'));
          request.onsuccess=()=>{
            const db=request.result,transaction=db.transaction(['runtime','portable_stages'],'readonly');
            const root=transaction.objectStore('runtime').get('runtime'),stage=transaction.objectStore('portable_stages').get(id);
            transaction.oncomplete=()=>{db.close();resolve({root:root.result,stage:stage.result});};
            transaction.onabort=()=>{db.close();reject(Error('native-read-aborted'));};
          };
        })''',stage['id'])
        assert persisted['root']['activeGeneration']==fence['generation']
        assert persisted['stage']['state']=='failed' and persisted['stage']['errorCode']=='recovery_required'
        assert call(page,'open')=={'ok':False,'code':'recovery_required'}
