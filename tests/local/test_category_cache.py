"""Only complete source-fenced derived category builds become readable."""
import json
import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_mirror import call
from test_capture import setup,record,NOW
from test_local_reports import capture,remote
from test_persisted_reconciliation import choices,run


def history(worker,viewed=True):
    connection=setup(worker);records=[];transactions=[]
    for i,day in enumerate(['2026-10-17','2026-10-18','2026-10-19']):
        records.append(record('history-'+str(i),local_date=day,occurred_at=day+'T12:00:00+07:00',beneficiary_account='merchant'))
        transactions.append(remote('zen-'+str(i),date=day,tag=['category'],viewed=viewed or i>0))
    records.append(record('pending',beneficiary_account='merchant'));capture(worker,connection,records)
    raw=dict(serverTimestamp=100,tag=[dict(id='category',title='Category'),dict(id='other',title='Other')],transaction=transactions)
    assert call(worker,'refresh',raw=json.dumps(raw),now=NOW)['ok'];assert run(worker)['ok']
    bank=next(row for row in call(worker,'capture-state')['result']['bank_transactions'] if row['external_id']=='pending')
    return bank,raw


def prediction(worker,bank):return call(worker,'prediction',id=bank['id'],version=bank['revision'],now=NOW)['result']


@pytest.mark.parametrize('viewed',[True,False])
def test_native_category_cache_uses_only_reviewed_evidence_and_reuses_identical_source(tmp_path,viewed):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        bank,_=history(worker,viewed);assert prediction(worker,bank) is None
        built=call(worker,'categories-build',now=NOW);assert built['ok'] and not built['result']['reused'],built
        result=prediction(worker,bank);assert result['category_id']==('category' if viewed else None),result
        assert result['reason']==('three_consistent_payments' if viewed else 'insufficient_history')
        state=call(worker,'categories-state',now=NOW)['result'];assert state['ready'] and len(state['payments'])==(3 if viewed else 2)
        again=call(worker,'categories-build',now=NOW+1);assert again['ok'] and again['result']['reused'],again
        assert call(worker,'categories-state',now=NOW+1)['result']==state


def test_native_category_change_invalidates_prepared_payload_without_changing_its_uuid(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        bank,raw=history(worker);assert call(worker,'categories-build',now=NOW)['ok']
        assert call(worker,'seed-reconcile-intent',id=bank['id'],now=NOW)['ok']
        assert call(worker,'categories-build',now=NOW)['ok']
        before=call(worker,'delivery-state')['result'][0];assert before['needs_rebuild']=='0'
        raw['transaction'][0]['tag']=['other'];assert call(worker,'refresh',raw=json.dumps(raw),now=NOW)['ok']
        assert prediction(worker,bank) is None
        rebuilt=call(worker,'categories-build',now=NOW);assert rebuilt['ok'],rebuilt
        result=prediction(worker,bank);assert result['category_id'] is None and result['reason']=='conflicting_history',result
        after=call(worker,'delivery-state')['result'][0];assert after==before|dict(needs_rebuild='1')
        assert call(worker,'categories-state',now=NOW)['result']['ready']


def test_native_failed_category_build_never_publishes_partial_predictions(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        bank,_=history(worker);failed=call(worker,'categories-build',now=NOW,mode='quota-category')
        assert failed['code']=='quota_exceeded',failed
        assert not call(worker,'categories-state',now=NOW)['result']['ready'] and prediction(worker,bank) is None
        retry=call(worker,'categories-build',now=NOW);assert retry['ok'],retry
        assert prediction(worker,bank)['category_id']=='category'


def test_native_interrupted_cache_is_unreadable_until_a_rebuilt_generation_is_published(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (context,worker,page,_) :
        bank,_=history(worker)
        worker.evaluate('args=>{globalThis.pendingCategories=mirrorProbe.run("categories-build",args);return true;}',dict(name='l6-mirror',now=NOW,mode='pause-category'))
        for _ in range(300):
            if worker.evaluate('mirrorProbe.checkpoint()'):break
            page.wait_for_timeout(20)
        assert worker.evaluate('mirrorProbe.checkpoint()')
        partial=call(worker,'categories-state',now=NOW)['result'];assert partial['predictions'] and not partial['ready'] and prediction(worker,bank) is None
        session=context.new_cdp_session(page);target=next(r for r in session.send('Target.getTargets')['targetInfos'] if r['url']==worker.url and r['type']=='service_worker')
        assert session.send('Target.closeTarget',dict(targetId=target['targetId']))['success'];assert page.evaluate('()=>chrome.runtime.sendMessage({type:"probe-wake"})')
        rebuilt=call(page,'categories-build',now=NOW);assert rebuilt['ok'],rebuilt
        assert prediction(page,bank)['category_id']=='category'


@pytest.mark.parametrize('race',['source','builder'])
def test_native_category_publication_rejects_source_changes_and_superseded_builders(tmp_path,race):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,page,_):
        bank,_=history(worker)
        worker.evaluate('args=>{globalThis.pendingCategories=mirrorProbe.run("categories-build",args);return true;}',dict(name='l6-mirror',now=NOW,mode='pause-category'))
        for _ in range(300):
            if worker.evaluate('mirrorProbe.checkpoint()'):break
            page.wait_for_timeout(20)
        assert worker.evaluate('mirrorProbe.checkpoint()')
        if race=='source':
            before=call(worker,'snapshot-begin',now=NOW)['result']
            changed=call(worker,'snapshot-write',id=bank['account_id'],label='New label',data=dict(stamp=before),now=NOW)
            assert changed['ok'],changed
        else:
            newer=call(worker,'categories-build',now=NOW+1);assert newer['ok'],newer
            published=call(worker,'categories-state',now=NOW+1)['result'];assert published['ready']
        worker.evaluate('()=>mirrorProbe.resumeCategories()')
        rejected=worker.evaluate('()=>globalThis.pendingCategories');assert rejected['code']=='stale_epoch',rejected
        if race=='builder':assert call(worker,'categories-state',now=NOW+1)['result']==published
        else:
            assert prediction(worker,bank) is None
            assert call(worker,'categories-build',now=NOW+1)['ok']
            assert prediction(worker,bank)['category_id']=='category'


def test_native_category_cache_bounds_transactions_for_one_hundred_thousand_pending_rows(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        account=setup(worker)['accounts'][0]
        # Volume-only fixture; semantic capture/learning is covered by history().
        seeded=call(worker,'seed-predictions',size=100000,accountId=account['id'],mode='pending',summary=True,now=NOW);assert seeded['ok'],seeded
        built=call(worker,'categories-build',now=NOW,summary=True);assert built['ok'],built
        assert built['result']['counts']==dict(category_evidence=0,category_payments=0,category_predictions=100000)
        assert built['predictionCount']==100000 and built['maxTransactionMs']<10000,built
        result=call(worker,'prediction',now=NOW)['result'];assert result['category_id'] is None and result['reason']=='no_confirmed_history',result
        assert call(worker,'categories-build',now=NOW+1,summary=True)['result']['reused']
