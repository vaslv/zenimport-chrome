"""Read-only mirror/credentials through the installed MV3 worker and native IDB."""
import json
import time
import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed


def call(worker,action,**args):
    return worker.evaluate('data=>typeof mirrorProbe!=="undefined"?mirrorProbe.run(data.action,data.args):chrome.runtime.sendMessage({type:"mirror-probe",...data})',dict(action=action,args=dict(name='l6-mirror',**args)))


def full(cursor=100,**changes):
    return json.dumps(dict(serverTimestamp=cursor,user=[dict(id=1)],instrument=[dict(id=2,shortTitle='VND')],
        account=[dict(id='a',title='Fixture',type='checking',instrument=2)],tag=[],transaction=[])|changes)


def many(size=1000,cursor=101):
    return '{"serverTimestamp":'+str(cursor)+',"transaction":['+','.join('{"id":"t-'+str(i)+'","date":"2026-10-20","incomeAccount":"a","outcomeAccount":"b","income":0,"outcome":1.000000000001,"tag":["x"]}' for i in range(size))+']}'


def ready(worker):
    assert call(worker,'init')['ok']
    assert call(worker,'verify')['ok']
    result=call(worker,'refresh');assert result['ok'],result
    return result


def test_native_full_diff_raw_values_tombstones_and_catalog_survive_browser_restart(tmp_path):
    path,profile=tmp_path/'extension',tmp_path/'profile'
    with sync_playwright() as p:
        with installed(p,path,profile) as (_,worker,_,identifier):
            ready(worker)
            raw='{"serverTimestamp":9007199254740993,"transaction":[{"id":"t","date":"2026-10-20","incomeAccount":"a","outcomeAccount":"b","incomeInstrument":2,"outcomeInstrument":3,"income":1.00000000000000000001,"outcome":27000,"tag":["x"],"viewed":false}]}'
            saved=call(worker,'refresh',raw=raw);assert saved['ok'],saved
            assert saved['tables']['zen_sync_runs'][-1]['payload']==raw or any(row['payload']==raw for row in saved['tables']['zen_sync_runs'])
            movement=saved['tables']['zen_movements'][0];assert movement['income']=='1.00000000000000000001' and movement['outcome']=='27000'
            before=saved['tables']['zen_entities']
            bad=call(worker,'refresh',raw='{"serverTimestamp":9007199254740994,"transaction":null}');assert bad['code']=='zenmoney_response'
            failed=call(worker,'status');assert failed['tables']['zen_entities']==before and not failed['readiness']['ready']
        with installed(p,path,profile,known_id=identifier) as (_,worker,_,_):
            recovered=call(worker,'refresh',now=1100,raw='{"serverTimestamp":9007199254740994,"deletion":[{"object":"transaction","id":"t"}]}');assert recovered['ok'],recovered
            assert not recovered['tables']['zen_movements'] and len(recovered['tables']['zen_tombstones'])==1
            # Full absence is not another deletion, and permanent evidence remains.
            assert call(worker,'verify',now=1101,token='replacement')['ok']
            refreshed=call(worker,'refresh',now=1102,raw=full(9007199254740995));assert refreshed['ok'],refreshed
            assert len(refreshed['tables']['zen_tombstones'])==1 and refreshed['readiness']['ready']
            catalog=call(worker,'catalog',now=1103);assert catalog['ok'],catalog
            assert catalog['result']['accounts']==[dict(id='a',title='Fixture',currency='VND',instrument='2')]


def test_native_rotation_wrong_owner_removal_and_secret_drafts_preserve_financial_data(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        initial=ready(worker)
        assert call(worker,'draft')['ok']
        wrong=call(worker,'verify',raw=full().replace('"id": 1','"id": 2'));assert wrong['code']=='zenmoney_wrong_owner'
        unchanged=call(worker,'status');assert unchanged['root']==initial['root'] and unchanged['readiness']['ready']
        rotated=call(worker,'verify',token='synthetic-new-token');assert rotated['ok'],rotated
        assert rotated['root']['credentialEpoch']=='3' and not rotated['readiness']['ready']
        assert call(worker,'draft-read')['result'] is None
        removed=call(worker,'remove');assert removed['ok'] and not removed['readiness']['configured']
        assert removed['tables']==initial['tables'] and removed['sentinel']==initial['sentinel']
        assert removed['root']['credentialRef'] is None


def test_native_refresh_lease_fences_late_replies_and_recovers_after_worker_death(tmp_path):
    path,profile=tmp_path/'extension',tmp_path/'profile'
    with sync_playwright() as p:
        with installed(p,path,profile) as (_,worker,_,identifier):
            ready(worker);claimed=call(worker,'claim');assert claimed['ok'],claimed
            blocked=call(worker,'refresh');assert blocked['code']=='mirror_busy'
        with installed(p,path,profile,known_id=identifier) as (_,worker,_,_):
            assert call(worker,'refresh',now=1059)['code']=='mirror_busy'
            newer=call(worker,'refresh',now=1061,raw='{"serverTimestamp":101}');assert newer['ok'],newer
            stale=call(worker,'apply',now=1062,raw='{"serverTimestamp":102}',**claimed['result']);assert stale['code']=='stale_epoch'
            current=call(worker,'status');assert current['tables']['zen_mirror_state'][0]['cursor']=='101'
            simultaneous=call(worker,'concurrent',now=1063,raw='{"serverTimestamp":102}',delay=50);assert simultaneous['ok'],simultaneous
            assert sorted(simultaneous['result'])==['mirror_busy','ok'] and simultaneous['calls']==1


def test_native_quota_failure_rolls_back_run_and_projection_together(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        initial=ready(worker)
        failed=call(worker,'refresh',quota=True,raw='{"serverTimestamp":101,"transaction":[{"id":"new","date":"2026-10-20","income":0,"outcome":1}]}')
        assert not failed['ok']
        after=call(worker,'status');assert after['tables']['zen_sync_runs']==initial['tables']['zen_sync_runs']
        assert after['tables']['zen_entities']==initial['tables']['zen_entities'] and after['tables']['zen_movements']==[]
        assert after['tables']['zen_mirror_state'][0]['cursor']=='100' and not after['readiness']['ready']


@pytest.mark.parametrize('size',[1000,10000,100000])
def test_native_bounded_large_mirror_commits_once_and_replaces_without_resurrection(tmp_path,size):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        ready(worker)
        # Use only wire JSON. No approximate decimal values enter the fixture.
        raw=many(size)
        started=time.monotonic();saved=call(worker,'refresh',raw=raw,summary=True);assert saved['ok'],saved
        assert saved['tables']['zen_movements']==size and saved['tables']['zen_tags']==size and saved['tables']['zen_sync_runs']==2
        assert saved['readiness']['ready'];assert time.monotonic()-started<120
        assert saved['maxTransactionMs']<10000,saved['maxTransactionMs']
        # Rotation forces an explicit full projection replacement, without
        # inventing deletion evidence from absent rows in that snapshot.
        assert call(worker,'verify',token='rotated',summary=True)['ok']
        replaced=call(worker,'refresh',raw=full(102),summary=True);assert replaced['ok'],replaced
        assert replaced['tables']['zen_movements']==0 and replaced['tables']['zen_tags']==0 and replaced['tables']['zen_tombstones']==0


@pytest.mark.parametrize('mode,published',[('pause-stage',False),('lost-reply',True)])
def test_native_worker_death_during_staging_or_after_atomic_publication(tmp_path,mode,published):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (context,worker,page,_):
        ready(worker)
        worker.evaluate('args=>{globalThis.pendingMirror=mirrorProbe.run("refresh",args);return true;}',dict(name='l6-mirror',raw=many(),mode=mode,summary=True))
        for _ in range(300):
            if worker.evaluate('mirrorProbe.checkpoint()'):break
            page.wait_for_timeout(20)
        assert worker.evaluate('mirrorProbe.checkpoint()')
        session=context.new_cdp_session(page)
        target=next(row for row in session.send('Target.getTargets')['targetInfos'] if row['url']==worker.url and row['type']=='service_worker')
        assert session.send('Target.closeTarget',dict(targetId=target['targetId']))['success']
        assert page.evaluate('()=>chrome.runtime.sendMessage({type:"probe-wake"})')
        current=call(page,'status',summary=True)
        assert current['ok'],current
        assert current['tables']['zen_movements']==(1000 if published else 0)
        assert current['tables']['zen_sync_runs']==(2 if published else 1)
        recovered=call(page,'refresh',raw=many(),now=1061,summary=True);assert recovered['ok'],recovered
        assert recovered['tables']['zen_movements']==1000 and recovered['tables']['zen_sync_runs']==(3 if published else 2)


def test_native_publication_quota_preserves_old_view_and_gc_never_collects_current(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        initial=ready(worker)
        failed=call(worker,'refresh',raw=many(),mode='quota-publish',summary=True);assert not failed['ok']
        old=call(worker,'status',summary=True);assert old['tables']['zen_movements']==0 and old['tables']['zen_sync_runs']==1
        assert any(row['state']=='loading' for row in old['versions'])
        assert call(worker,'collect',now=2000,summary=True)['result']['complete']
        completed=call(worker,'refresh',raw=many(),now=1100,summary=True);assert completed['ok'],completed
        # A small diff on a large existing projection does not clone history.
        small=call(worker,'refresh',raw='{"serverTimestamp":102}',now=1101,summary=True);assert small['ok'],small
        assert small['projection']==completed['projection'] and len(small['versions'])==len(completed['versions'])
        for _ in range(50):
            collected=call(worker,'collect',now=90000,summary=True);assert collected['ok'],collected
            if collected['result']['complete']:break
        assert collected['result']['complete']
        assert collected['tables']['zen_movements']==1000 and collected['tables']['zen_sync_runs']==3
        assert len(collected['versions'])==1 and collected['versions'][0]['state']=='active'
        inspected=call(worker,'inspect',summary=True);assert inspected['result']['rows']['zen_movements']==1000


@pytest.mark.parametrize('status,delay,code',[(401,30,'zenmoney_auth'),(403,30,'zenmoney_auth'),(429,60,'zenmoney_rate_limited'),(503,10,'zenmoney_unavailable')])
def test_native_error_cooldown_survives_restart_without_early_network(tmp_path,status,delay,code):
    extension,profile=tmp_path/'extension',tmp_path/'profile'
    with sync_playwright() as p:
        with installed(p,extension,profile) as (_,worker,_,identifier):
            initial=ready(worker);failed=call(worker,'refresh',status=status);assert failed['code']==code
            current=call(worker,'status');assert not current['readiness']['ready'] and current['readiness']['nextAt']==str(1000+delay)
            assert current['tables']['zen_sync_runs']==initial['tables']['zen_sync_runs']
        with installed(p,extension,profile,known_id=identifier) as (_,worker,_,_):
            blocked=call(worker,'refresh',now=1000+delay-1);assert blocked['code']=='mirror_cooldown' and blocked['calls']==0
            assert call(worker,'refresh',now=1000+delay,raw='{"serverTimestamp":101}')['ok']


def test_native_permission_revocation_blocks_fresh_cache_and_same_token_rebind_forces_full(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        ready(worker)
        denied=call(worker,'status',permission=False);assert denied['readiness']['configured'] and not denied['readiness']['ready']
        assert denied['readiness']['error']=='zenmoney_permission'
        denied=call(worker,'catalog',permission=False);assert denied['code']=='zenmoney_permission' and denied['calls']==0
        assert call(worker,'remove')['ok']
        bound=call(worker,'verify');assert bound['ok'] and not bound['readiness']['ready']
        assert call(worker,'refresh',force=False,raw='{"serverTimestamp":101}')['code']=='zenmoney_response'
        assert call(worker,'refresh',now=1010,force=False,raw=full(101))['ok']


def test_native_current_shadow_mirror_can_export_and_validate_all_logical_tables(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        ready(worker);assert call(worker,'refresh',raw=many(),summary=True)['ok']
        flags='{"serverTimestamp":102,"reminder":[{"id":"r","startDate":"2026-10-20","income":0,"outcome":1,"viewed":true,"hold":false}],"reminderMarker":[{"id":"m","date":"2026-10-20","income":0,"outcome":1,"viewed":true,"hold":false}]}'
        assert call(worker,'refresh',raw=flags,summary=True)['ok']
        exported=call(worker,'export',now=1100);assert exported['ok'],exported
        assert exported['result']['state']=='export_hold' and exported['result']['dataset_digest']


@pytest.mark.parametrize('change',['verify','remove'])
@pytest.mark.parametrize('status',[200,503])
def test_native_token_change_fences_both_success_and_failure_from_old_network(tmp_path,change,status):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,page,_):
        initial=ready(worker);before=worker.evaluate('mirrorProbe.networkCount()')
        worker.evaluate('args=>{globalThis.pendingMirror=mirrorProbe.run("refresh",args);return true;}',
            dict(name='l6-mirror',raw='{"serverTimestamp":102}',status=status,mode='pause-network'))
        for _ in range(100):
            if worker.evaluate('mirrorProbe.networkCount()')>before:break
            page.wait_for_timeout(20)
        assert worker.evaluate('mirrorProbe.networkCount()')>before
        changed=call(worker,change,token='replacement');assert changed['ok'],changed
        if change=='verify':assert call(worker,'refresh',raw=full(101))['ok']
        worker.evaluate('mirrorProbe.releaseNetwork()');old=worker.evaluate('pendingMirror');assert not old['ok']
        final=call(worker,'status');assert final['ok'],final
        if change=='verify':
            assert final['readiness']['ready'] and final['readiness']['nextAt']=='0'
            assert final['tables']['zen_mirror_state'][0]['cursor']=='101'
        else:assert not final['readiness']['configured'] and final['tables']==initial['tables']
        assert final['credentialCount']==(1 if change=='verify' else 0)


def test_native_failed_verification_cas_erases_only_its_unused_secret(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,page,_):
        ready(worker);before=worker.evaluate('mirrorProbe.networkCount()')
        worker.evaluate('args=>{globalThis.pendingMirror=mirrorProbe.run("verify",args);return true;}',dict(name='l6-mirror',token='loser',mode='pause-network'))
        for _ in range(100):
            if worker.evaluate('mirrorProbe.networkCount()')>before:break
            page.wait_for_timeout(20)
        winner=call(worker,'verify',token='winner');assert winner['ok'],winner
        worker.evaluate('mirrorProbe.releaseNetwork()');assert worker.evaluate('pendingMirror')['code']=='stale_epoch'
        final=call(worker,'status');assert final['root']['credentialRef']==winner['root']['credentialRef'] and final['credentialCount']==1


def test_native_interrupted_secret_candidate_is_collected_without_erasing_selected_token(tmp_path):
    extension,profile=tmp_path/'extension',tmp_path/'profile'
    with sync_playwright() as p:
        with installed(p,extension,profile) as (context,worker,page,identifier):
            initial=ready(worker)
            worker.evaluate('args=>{globalThis.pendingMirror=mirrorProbe.run("verify",args);return true;}',dict(name='l6-mirror',token='unselected',mode='pause-adopt'))
            for _ in range(100):
                if worker.evaluate('mirrorProbe.checkpoint()'):break
                page.wait_for_timeout(20)
            assert worker.evaluate('mirrorProbe.checkpoint()')
            session=context.new_cdp_session(page);target=next(row for row in session.send('Target.getTargets')['targetInfos'] if row['url']==worker.url and row['type']=='service_worker')
            assert session.send('Target.closeTarget',dict(targetId=target['targetId']))['success']
        with installed(p,extension,profile,known_id=identifier) as (_,worker,_,_):
            assert call(worker,'status')['credentialCount']==2
            assert call(worker,'cleanup-credentials',now=2000)['credentialCount']==2
            cleaned=call(worker,'cleanup-credentials',now=90000);assert cleaned['ok'],cleaned
            assert cleaned['credentialCount']==1 and cleaned['root']['credentialRef']==initial['root']['credentialRef']
            assert cleaned['tables']==initial['tables']


def test_native_imported_awaiting_sync_can_read_mirror_without_releasing_any_write_fence(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        ready(worker);awaiting=call(worker,'awaiting');assert awaiting['ok'],awaiting
        assert call(worker,'verify',token='destination-token')['ok']
        refreshed=call(worker,'refresh',raw=full(101));assert refreshed['ok'],refreshed
        assert refreshed['readiness']['ready'] and refreshed['participants'][0]['awaitingSync']
        fenced=call(worker,'write-fences');assert fenced['ok'],fenced
        assert fenced['result']==['dataset_not_writable','dataset_not_writable']
        assert fenced['participants'][0]['awaitingSync']


def test_native_large_predictions_invalidate_atomically_and_collect_in_bounded_pages(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        ready(worker)
        seeded=call(worker,'seed-predictions',size=100000,mode='published-cache',summary=True);assert seeded['ok'],seeded
        assert seeded['predictionCount']==100000 and seeded['maxTransactionMs']<10000
        assert call(worker,'prediction')['result']['bank_id']=='b-0'
        failed=call(worker,'refresh',status=429,summary=True);assert failed['code']=='zenmoney_rate_limited'
        assert call(worker,'prediction')['result'] is None
        # The failed request has no unbounded erase in its transaction.
        assert call(worker,'status',summary=True)['predictionCount']==100000
        refreshed=call(worker,'refresh',now=1060,raw='{"serverTimestamp":101}',summary=True)
        assert refreshed['ok'] and refreshed['maxTransactionMs']<10000,refreshed
        assert call(worker,'prediction',now=1060)['result'] is None
        for _ in range(201):
            collected=call(worker,'collect',now=1060,summary=True);assert collected['ok'],collected
            assert collected['result']['removed']<=500 and collected['maxTransactionMs']<10000
            if collected['result']['complete']:break
        assert collected['predictionCount']==0 and collected['result']['complete']


def test_native_deleted_entity_with_many_old_tags_uses_bounded_projection(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        ready(worker)
        raw=json.dumps(dict(serverTimestamp=101,transaction=[dict(id='tagged',date='2026-10-20',income=0,outcome=1,tag=['tag-'+str(i) for i in range(10000)])]))
        saved=call(worker,'refresh',raw=raw,summary=True);assert saved['ok'],saved
        deleted=call(worker,'refresh',raw='{"serverTimestamp":102,"deletion":[{"object":"transaction","id":"tagged"}]}',summary=True)
        assert deleted['ok'] and deleted['maxTransactionMs']<10000,deleted
        assert deleted['tables']['zen_tags']==deleted['tables']['zen_movements']==0
        assert deleted['tables']['zen_tombstones']==1
