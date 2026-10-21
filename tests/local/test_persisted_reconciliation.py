"""Complete matching facts commit together and retries never create fresh writes."""
import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_mirror import call
from test_capture import setup,record,NOW
from test_local_reports import capture,refresh,remote,report


def choices(worker,target='a'):
    rows=call(worker,'capture-state')['result']['bank_transactions']
    return [dict(bank_id=row['id'],revision=row['revision'],target_id=target) for row in rows]


def run(worker,selected=None,**options):return call(worker,'reconcile-run',now=NOW,data=choices(worker) if selected is None else selected,**options)


@pytest.mark.parametrize('kind',['ordinary','transfer','split','settlement'])
def test_native_matching_persists_receipts_or_groups_and_target_sides_atomically(tmp_path,kind):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker);records=[record()];txs=[remote()]
        if kind=='transfer':txs=[remote(incomeAccount='other',income=100)]
        if kind=='split':txs=[remote('split-1',amount=40),remote('split-2',amount=60)]
        if kind=='settlement':records=[record('one',amount='60'),record('two',amount='40')]
        capture(worker,connection,records);refresh(worker,txs)
        result=run(worker);assert result['ok'],result
        assert len(result['result']['recognized'])==len(records) and result['result']['blocked']==[]
        state=call(worker,'reconcile-state')['result']
        assert all(row['state']=='delivered' for row in state['processing'])
        assert all(row['target_id']=='a' for row in state['targets'])
        assert len(state['receipts'])==(1 if kind in ('ordinary','transfer') else 0)
        assert len(state['groups'])==(1 if kind in ('split','settlement') else 0)
        before=state;replayed=run(worker);assert replayed['ok'] and replayed['result']['recognized']==[],replayed
        after=call(worker,'reconcile-state')['result']
        for name in ('targets','groups','banks','zens'):assert after[name]==before[name]
        assert after==before
        later=call(worker,'reconcile-run',now=NOW+1,data=choices(worker));assert later['ok'],later
        assert call(worker,'reconcile-state')['result']==after
        assert run(worker)['ok']
        assert call(worker,'reconcile-state')['result']==after
        assert not call(worker,'delivery-state')['result']
        # Grouped net settlements remain visible in the conservative report;
        # neither side is hidden merely because a durable identity was adopted.
        assert report(worker,connection)['ok']
        assert call(worker,'export',now=NOW)['ok']


def test_native_reconciliation_quota_never_leaves_half_receipt_or_target(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker);capture(worker,connection,[record()]);refresh(worker,[remote()])
        before=call(worker,'snapshot-begin',now=NOW)['result']
        failed=run(worker,mode='quota-reconcile');assert failed['code']=='quota_exceeded',failed
        assert call(worker,'snapshot-begin',now=NOW)['result']==before
        state=call(worker,'reconcile-state')['result'];assert not state['targets'] and not state['receipts'] and state['processing'][0]['state']=='pending'
        assert run(worker)['ok']


def test_native_reconciliation_respects_multiplicity_and_partial_capture_barrier(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker);capture(worker,connection,[record('one'),record('two')]);refresh(worker,[remote()])
        result=run(worker);assert result['ok'] and len(result['result']['recognized'])==1,result
        state=call(worker,'reconcile-state')['result'];assert state['receipts'][0]['origin']=='day_amount_order'
        assert sorted(row['state'] for row in state['processing'])==['delivered','pending']
        # A new incomplete observed revision cannot be a matching candidate.
        capture(worker,connection,[record('partial',amount='70')],done=False)
        failed=run(worker);assert failed['code']=='history_incomplete',failed


def test_native_deleted_never_attempted_intent_is_suppressed_before_an_equal_uuid_match(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker);capture(worker,connection,[record()]);bank=choices(worker)[0]['bank_id']
        import json
        raw=dict(serverTimestamp=100,transaction=[remote('other-equal')],deletion=[dict(object='transaction',id='known-intent')])
        assert call(worker,'refresh',raw=json.dumps(raw),now=NOW)['ok']
        assert run(worker,selected=[])['ok']
        # Adding an explicit intent changes source revision, not mirror M. The
        # previously current watermark must not hide its permanent tombstone.
        assert call(worker,'seed-reconcile-intent',id=bank,now=NOW)['ok']
        result=run(worker);assert result['ok'] and result['result']['recognized']==[],result
        state=call(worker,'reconcile-state')['result'];assert not state['receipts'] and not state['groups']
        assert state['processing'][0]['state']=='suppressed' and state['processing'][0]['reason']=='zenmoney_deleted'
        delivery=call(worker,'delivery-state')['result'][0];assert delivery['zen_id']=='known-intent' and delivery['state']=='suppressed' and delivery['ever_attempted']=='0'
        assert run(worker)['ok']


def test_native_string_instrument_cannot_be_adopted_as_a_numeric_instrument(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker);capture(worker,connection,[record()]);refresh(worker,[remote(outcomeInstrument='2')])
        result=run(worker);assert result['ok'] and not result['result']['recognized'],result
        state=call(worker,'reconcile-state')['result'];assert not state['receipts'] and state['processing'][0]['state']=='pending'
        assert report(worker,connection)['result']['days']==[]


def test_native_large_known_group_resumes_bounded_receipts_after_worker_death(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (context,worker,page_ui,_) :
        connection=setup(worker);capture(worker,connection,[record()]);bank=choices(worker)[0]['bank_id'];size=1001
        assert call(worker,'seed-reconcile-group',id=bank,size=size,now=NOW)['ok']
        refresh(worker,[remote('known-'+str(i),amount=1) for i in range(size)])
        worker.evaluate('args=>{globalThis.pendingKnown=mirrorProbe.run("reconcile-run",args);return true;}',dict(name='l6-mirror',now=NOW,data=[],mode='pause-known'))
        for _ in range(300):
            if worker.evaluate('mirrorProbe.checkpoint()'):break
            page_ui.wait_for_timeout(20)
        assert worker.evaluate('mirrorProbe.checkpoint()')
        partial=call(worker,'reconcile-state')['result'];assert len(partial['receipts'])==200
        assert partial['processing'][0]['state']=='delivered'
        session=context.new_cdp_session(page_ui)
        target=next(row for row in session.send('Target.getTargets')['targetInfos'] if row['url']==worker.url and row['type']=='service_worker')
        assert session.send('Target.closeTarget',dict(targetId=target['targetId']))['success']
        assert page_ui.evaluate('()=>chrome.runtime.sendMessage({type:"probe-wake"})')
        recovered=run(page_ui,selected=[]);assert recovered['ok'] and recovered['maxTransactionMs']<10000,recovered
        state=call(page_ui,'reconcile-state')['result'];assert len(state['receipts'])==size and len({r['zen_id'] for r in state['receipts']})==size
        before=call(page_ui,'snapshot-begin',now=NOW)['result']
        assert call(page_ui,'reconcile-run',now=NOW+1,data=[])['ok']
        assert call(page_ui,'snapshot-begin',now=NOW+1)['result']==before


def test_native_known_watermark_cannot_adopt_an_external_revision_during_its_reread(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,page_ui,_) :
        connection=setup(worker);capture(worker,connection,[record('one'),record('two',amount='200')])
        rows={r['external_id']:r['id'] for r in call(worker,'capture-state')['result']['bank_transactions']}
        assert call(worker,'seed-reconcile-intent',id=rows['one'],now=NOW)['ok']
        import json
        raw=dict(serverTimestamp=100,transaction=[remote('known-intent'),remote('other-equal',amount=200)],deletion=[dict(object='transaction',id='late-intent')])
        assert call(worker,'refresh',raw=json.dumps(raw),now=NOW)['ok']
        worker.evaluate('args=>{globalThis.pendingKnown=mirrorProbe.run("reconcile-run",args);return true;}',dict(name='l6-mirror',now=NOW,data=[],mode='pause-known'))
        for _ in range(300):
            if worker.evaluate('mirrorProbe.checkpoint()'):break
            page_ui.wait_for_timeout(20)
        assert worker.evaluate('mirrorProbe.checkpoint()')
        # Independent writer commits after the known pass's final native unit,
        # before its source reread. It must not inherit that pass's watermark.
        assert call(worker,'seed-reconcile-intent',id=rows['two'],label='late-intent',now=NOW)['ok']
        worker.evaluate('mirrorProbe.resumeKnown()')
        rejected=worker.evaluate('globalThis.pendingKnown');assert rejected['code']=='stale_epoch',rejected
        assert run(worker,selected=[])['ok']
        state=call(worker,'reconcile-state')['result'];states={r['bank_id']:r['state'] for r in state['processing']}
        assert states[rows['one']]=='delivered' and states[rows['two']]=='suppressed'
        assert not any(r['bank_id']==rows['two'] for r in state['receipts'])
