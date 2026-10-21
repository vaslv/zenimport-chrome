"""Explicit UUID reconciliation agrees with actual Python mirror application."""
import json
import pytest
pytest.importorskip('backend')
from backend import storage
from mirror_factory import Fixture
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_mirror import call,full
from test_capture import setup,record,NOW
from test_local_reports import capture,remote
from test_persisted_reconciliation import choices,run


@pytest.mark.parametrize('case',['deleted','exists','absent'])
def test_actual_python_and_native_never_attempted_explicit_uuid_state_match(tmp_path,case):
    f=Fixture(tmp_path/'source.sqlite3');f.now=NOW
    try:
        f.refresh(json.loads(full()));bank_l=f.bank(local_date='2026-10-20',occurred_at='2026-10-20T12:00:00+07:00')
        # Existing invalidated intents isolate UUID reconciliation from the source
        # mirror's later category-preparation stage (implemented next in L8).
        payload=json.dumps(dict(id='known-intent',incomeAccount='a',outcomeAccount='a'),separators=(',',':'))
        with storage.transaction(f.path) as db:
            db.execute('INSERT INTO deliveries VALUES (?,?,?,?,?,?,?,?,?)',(bank_l,'known-intent',payload,'prepared',0,'created',None,NOW,1))
            db.execute("UPDATE bank_processing SET state='prepared',updated_at=? WHERE bank_id=?",(NOW,bank_l))
        raw=dict(serverTimestamp=100,transaction=[remote('known-intent',amount=999)] if case=='exists' else [])
        if case=='deleted':raw.update(transaction=[remote('other-equal')],deletion=[dict(object='transaction',id='known-intent')])
        f.refresh(raw)
        with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
            connection=setup(worker);capture(worker,connection,[record()]);bank_r=choices(worker)[0]['bank_id']
            assert call(worker,'seed-reconcile-intent',id=bank_r,now=NOW,mode='needs-rebuild')['ok']
            assert call(worker,'refresh',raw=json.dumps(raw),now=NOW)['ok']
            outcome=run(worker);assert outcome['ok'] and not outcome['result']['recognized'],outcome
            state=call(worker,'reconcile-state')['result'];deliveries=call(worker,'delivery-state')['result']
            def normalized(rows,bank):
                return sorted([{k:('bank' if k=='bank_id' and v==bank else str(v) if isinstance(v,int) else v) for k,v in row.items()} for row in rows],key=repr)
            with storage.transaction(f.path,read_only=True) as db:
                for local,table in [(state['processing'],'bank_processing'),(state['receipts'],'processing_receipts'),(deliveries,'deliveries')]:
                    assert normalized(local,bank_r)==normalized([dict(r) for r in db.execute('SELECT * FROM '+table)],bank_l),(case,table)
    finally:f.close()
