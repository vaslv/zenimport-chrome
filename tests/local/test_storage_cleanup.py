"""Only explicitly abandoned, backed-up, aged inactive imports can be collected."""
import json
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_storage import call

GOLDEN=json.loads(Path('/app/contracts/business/v1/portable-golden-v2.json').read_text())


def test_native_cleanup_requires_discard_backup_ack_and_full_retention(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,_,page,_):
        original=call(page,'open')['value'];fence=original['context']
        stage=call(page,'stage',fence=fence,golden=GOLDEN)['value'];fields=dict(fence=fence,stageId=stage['id'])
        assert call(page,'ack-stage-backup',**fields)==dict(ok=False,code='dataset_not_writable')
        assert call(page,'collect-stage',**fields)==dict(ok=False,code='dataset_not_writable')
        assert call(page,'discard-stage',**fields)==dict(ok=True,value=True)
        assert call(page,'collect-stage',**fields)==dict(ok=False,code='dataset_not_writable')
        assert call(page,'ack-stage-backup',**fields,now='1792540900')==dict(ok=True,value=True)
        assert call(page,'collect-stage',**fields,now='1792627299')==dict(ok=False,code='dataset_not_writable')
        # A retry cannot reset an old acknowledgment or shorten the retention.
        assert call(page,'ack-stage-backup',**fields,now='1792540800')==dict(ok=True,value=True)
        dataset=next(item for item in call(page,'state')['value']['datasets'] if item['generation']==stage['id'])
        assert dataset['backupAcknowledgedAt']=='1792540900'
        assert call(page,'collect-stage',**fields,now='1792627300')==dict(ok=True,value=dict(removedRows=stage['rowCount'],complete=True))
        assert call(page,'stages')==dict(ok=True,value=[])
        assert len(call(page,'state')['value']['datasets'])==1
        assert call(page,'open')['value']['state']['rows']==original['state']['rows']
        assert call(page,'state')['value']['marker']['financialMayHaveStarted']


def test_native_cleanup_is_bounded_and_resumes_after_profile_restart(tmp_path):
    extension,profile=tmp_path/'extension',tmp_path/'profile'
    with sync_playwright() as p:
        with installed(p,extension,profile) as (_,_,page,identifier):
            original=call(page,'open')['value'];fence=original['context']
            stage=call(page,'stage',fence=fence,golden=GOLDEN,count=1000)['value'];fields=dict(fence=fence,stageId=stage['id'])
            assert call(page,'discard-stage',**fields)['ok']
            assert call(page,'ack-stage-backup',**fields)['ok']
            assert call(page,'collect-stage',**fields)==dict(ok=True,value=dict(removedRows='500',complete=False))
            assert call(page,'stages')['value'][0]['state']=='discarded'
        with installed(p,extension,profile,known_id=identifier) as (_,_,page,_):
            assert call(page,'open')['value']['context']==fence
            assert call(page,'collect-stage',**fields)==dict(ok=True,value=dict(removedRows='500',complete=False))
            assert call(page,'collect-stage',**fields)==dict(ok=True,value=dict(removedRows='4',complete=True))
            assert call(page,'stages')==dict(ok=True,value=[])
            assert call(page,'open')['value']['state']['rows']==original['state']['rows']


def test_native_cleanup_never_deletes_active_data_or_crosses_a_pending_switch(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,_,page,_):
        fence=call(page,'open')['value']['context']
        stage=call(page,'stage',fence=fence,golden=GOLDEN)['value']
        for action in ('discard-stage','ack-stage-backup','collect-stage'):
            assert call(page,action,fence=fence,stageId=fence['generation'])==dict(ok=False,code='dataset_not_writable')
            assert call(page,action,fence=fence|{'epoch':'2'},stageId=stage['id'])==dict(ok=False,code='stale_epoch')
        assert call(page,'kernel',fence=fence,mode='control',patch={'pendingSwitchId':'00000000-0000-4000-8000-000000000002'})['ok']
        for action in ('discard-stage','ack-stage-backup','collect-stage'):
            assert call(page,action,fence=fence,stageId=stage['id'])==dict(ok=False,code='stale_epoch')
        assert call(page,'stages')==dict(ok=True,value=[stage])


@pytest.mark.parametrize('lifecycle,hold',[('held',None),('armed',None),('retired',None),
    ('staging','00000000-0000-4000-8000-000000000002')])
def test_native_cleanup_cannot_discard_a_protected_generation(tmp_path,lifecycle,hold):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,page,_):
        fence=call(page,'open')['value']['context']
        stage=call(page,'stage',fence=fence,golden=GOLDEN)['value']
        worker.evaluate('''args=>new Promise((resolve,reject)=>{
          const request=indexedDB.open('l4-financial');request.onerror=()=>reject(Error('open-failed'));
          request.onsuccess=()=>{
            const db=request.result,tx=db.transaction('datasets','readwrite'),store=tx.objectStore('datasets');
            const current=store.get(args.id);current.onsuccess=()=>store.put({...current.result,lifecycle:args.lifecycle,holdId:args.hold});
            tx.oncomplete=()=>{db.close();resolve(true);};tx.onabort=()=>{db.close();reject(Error('patch-failed'));};
          };
        })''',dict(id=stage['id'],lifecycle=lifecycle,hold=hold))
        for action in ('discard-stage','ack-stage-backup','collect-stage'):
            assert call(page,action,fence=fence,stageId=stage['id'])==dict(ok=False,code='dataset_not_writable')
        dataset=next(item for item in call(page,'state')['value']['datasets'] if item['generation']==stage['id'])
        assert dataset['lifecycle']==lifecycle and dataset['holdId']==hold
