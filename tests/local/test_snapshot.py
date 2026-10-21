"""Optimistic derived work never applies to a changed source or authority."""
import json
import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_mirror import call,full
from test_capture import setup,start,lease,page,record,NOW


def stamp(worker):
    result=call(worker,'snapshot-begin',now=NOW);assert result['ok'],result
    return result['result']


def test_native_snapshot_rejects_concurrent_change_and_reuses_noop_stamp(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker);account=connection['accounts'][0];before=stamp(worker)
        noop=call(worker,'snapshot-write',id=account['id'],data=dict(stamp=before),now=NOW);assert noop['ok'] and noop['result']['stamp']==before,noop
        changed=call(worker,'snapshot-write',id=account['id'],label='Changed',data=dict(stamp=before),now=NOW);assert changed['ok'],changed
        assert int(changed['result']['stamp']['revision'])==int(before['revision'])+1
        assert call(worker,'snapshot-check',data=dict(stamp=before),now=NOW)['code']=='stale_epoch'
        assert call(worker,'snapshot-scan',data=dict(stamp=before,table='bank_accounts'),now=NOW)['code']=='stale_epoch'
        assert call(worker,'snapshot-write',id=account['id'],label='Must not commit',data=dict(stamp=before),now=NOW)['code']=='stale_epoch'
        assert call(worker,'connections-get',id=connection['id'],now=NOW)['result']['accounts'][0]['label']==account['label']
        # Discovery labels are a separate projection; inspect the actual mutated row.
        rows=call(worker,'capture-state')['result']['bank_accounts'];assert rows[0]['label']=='Changed'


def test_native_snapshot_only_one_concurrent_commit_can_consume_a_revision(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker);before=stamp(worker)
        values=worker.evaluate('''args=>Promise.all(['one','two'].map(label=>mirrorProbe.run('snapshot-write',{name:'l6-mirror',now:args.now,id:args.id,label,data:{stamp:args.stamp}})))''',dict(now=NOW,id=connection['accounts'][0]['id'],stamp=before))
        assert sorted(r['ok'] for r in values)==[False,True],values
        assert next(r for r in values if not r['ok'])['code']=='stale_epoch'


def test_native_snapshot_quota_rolls_back_mutation_and_revision_together(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker);before=stamp(worker)
        failed=call(worker,'snapshot-write',id=connection['accounts'][0]['id'],label='Never committed',data=dict(stamp=before),mode='quota-snapshot',now=NOW)
        assert failed['code']=='quota_exceeded',failed
        assert stamp(worker)==before
        assert call(worker,'snapshot-write',id=connection['accounts'][0]['id'],label='Retried',data=dict(stamp=before),now=NOW)['ok']


def test_native_snapshot_detects_same_cursor_and_clock_mirror_change_and_rotation(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        setup(worker);before=stamp(worker)
        raw=json.dumps(dict(serverTimestamp=100,transaction=[dict(id='new',date='2026-10-20',incomeAccount='a',outcomeAccount='a',incomeInstrument=2,outcomeInstrument=2,income=0,outcome=100)]))
        refreshed=call(worker,'refresh',raw=raw,now=NOW);assert refreshed['ok'],refreshed
        assert call(worker,'snapshot-check',data=dict(stamp=before),now=NOW)['code']=='stale_epoch'
        before=stamp(worker);assert call(worker,'verify',token='rotated',now=NOW)['ok']
        assert call(worker,'snapshot-check',data=dict(stamp=before),now=NOW)['code']=='stale_epoch'


def test_native_snapshot_cache_writes_do_not_invalidate_source_and_pages_are_bounded(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        job=start(worker,setup(worker))['result'];owned=lease(worker,job);interval=job['accounts'][0]['intervals'][0]
        assert page(worker,job,interval,owned,[record()])['ok']
        bank=call(worker,'capture-state')['result']['bank_transactions'][0];before=stamp(worker)
        saved=call(worker,'snapshot-cache',id=bank['id'],data=dict(stamp=before),now=NOW);assert saved['ok'] and saved['result']['stamp']==before,saved
        assert call(worker,'snapshot-check',data=dict(stamp=before),now=NOW)['ok']
        assert call(worker,'snapshot-scan',data=dict(stamp=before,table='category_predictions'),now=NOW)['code']=='schema_unsupported'
        # This fixture seed only constructs volume; the source writer guard itself
        # is tested above through named repository operations, not direct IDB edits.
        assert call(worker,'seed-predictions',accountId=bank['account_id'],size=1001,now=NOW)['ok']
        before=stamp(worker);after=None;seen=set();sizes=[]
        while True:
            result=call(worker,'snapshot-scan',data=dict(stamp=before,table='bank_transactions',after=after),now=NOW);assert result['ok'],result
            rows=result['result']['rows'];sizes.append(len(rows));assert len(rows)<=500
            if not rows:break
            for row in rows:assert row['id'] not in seen;seen.add(row['id'])
            after=result['result']['after']
        assert len(seen)==1002 and sizes==[500,500,2,0],sizes


def test_native_snapshot_survives_browser_restart_and_settings_invalidate_it(tmp_path):
    with sync_playwright() as p:
        with installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,identifier):
            connection=setup(worker);before=stamp(worker);account=connection['accounts'][0]
        with installed(p,tmp_path/'extension',tmp_path/'profile',known_id=identifier) as (_,worker,_,_):
            assert stamp(worker)==before
            from test_account_settings import configure
            assert configure(worker,account['id'],version=1,selection='ignored',target=None,start=None,now=NOW)['ok']
            assert call(worker,'snapshot-check',data=dict(stamp=before),now=NOW)['code']=='stale_epoch'


def test_native_capture_read_preserves_snapshot_but_new_observation_invalidates_it(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        job=start(worker,setup(worker))['result'];owned=lease(worker,job);before=stamp(worker)
        assert call(worker,'capture-get',id=job['id'],now=NOW)['ok']
        assert stamp(worker)==before
        assert page(worker,job,job['accounts'][0]['intervals'][0],owned,[record()])['ok']
        assert call(worker,'snapshot-check',data=dict(stamp=before),now=NOW)['code']=='stale_epoch'


@pytest.mark.parametrize('revision',['-1','broken','9223372036854775808','9223372036854775807'])
def test_native_snapshot_corrupt_or_exhausted_revision_never_commits_fact(tmp_path,revision):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,page,_) :
        account=setup(worker)['accounts'][0];before=stamp(worker)
        page.evaluate('''args=>new Promise((resolve,reject)=>{
          const request=indexedDB.open('l6-mirror');request.onerror=()=>reject(request.error);
          request.onsuccess=()=>{const db=request.result,tx=db.transaction('application_state','readwrite');
            tx.objectStore('application_state').put({scope:'financial-revision:'+args.generation,value:{revision:args.revision}});
            tx.oncomplete=()=>{db.close();resolve(true);};tx.onabort=()=>{db.close();reject(tx.error);};};
        })''',dict(generation=before['generation'],revision=revision))
        if revision=='9223372036854775807':
            before=stamp(worker)
            failed=call(worker,'snapshot-write',id=account['id'],label='Never committed',data=dict(stamp=before),now=NOW)
        else:failed=call(worker,'snapshot-begin',now=NOW)
        assert failed['code']=='storage_corrupt',failed
        assert call(worker,'capture-state')['result']['bank_accounts'][0]['label']!='Never committed'
