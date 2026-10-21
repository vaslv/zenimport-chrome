"""Actual SQLite and installed IDB consume the same capture command sequence."""
import json
from unittest.mock import patch
from uuid import uuid4
import pytest
pytest.importorskip('backend')
from playwright.sync_api import sync_playwright
from backend import accounts,capture,storage
from backend.sync_contracts import DiscoverConnection,AccountSettings,StartSync,CaptureLeaseRequest,CapturePage,CaptureComplete
from mirror_factory import Fixture
from test_runtime import installed
from test_mirror import call,full
from test_connections import discovery
from test_capture import NOW,WORKER,record

TABLES=('connections','bank_accounts','account_bindings','bank_transactions','bank_versions','bank_aliases','bank_processing',
    'capture_jobs','job_accounts','job_context','job_requests','capture_intervals','capture_pages','captured_records','coverage',
    'reimport_ranges','source_capture_leases','capture_errors')


def identity_map(tables):
    """Map only newly generated storage/audit UUIDs by immutable semantic keys.

    These runs begin with no bank facts, attempts or payload UUIDs. ZenMoney IDs,
    request/worker IDs, payload digests, exact raw records and amounts stay intact.
    The repository and portable export validate all foreign references separately.
    """
    result={}
    for table,keys in [('connections',('bank','profile_key')),('bank_accounts',('bank','identity_scope','source_key','currency')),
                       ('capture_jobs',('request_id',)),('bank_transactions',('account_id','external_id')),
                       ('capture_intervals',('job_id','account_id','start_date','end_date')),
                       ('account_bindings',('account_id','settings_version','origin')),
                       ('reimport_ranges',('account_id','settings_version','source_job_id')),
                       ('capture_errors',('job_id','account_id','code','created_at'))]:
        for row in tables[table]:
            parts=[result.get(str(row[k]),str(row[k])) for k in keys]
            result[row['id']]=table+':'+':'.join(parts)
    return result


def normalized(tables):
    ids=identity_map(tables)
    def value(v):
        if isinstance(v,int):return str(v)
        if isinstance(v,str):
            if v in ids:return ids[v]
            # Only context JSON contains newly generated DB references. Raw bank
            # JSON and page digest remain byte-identical (no normalization).
            for before,after in ids.items():v=v.replace('"'+before+'"','"'+after+'"')
        return v
    return {table:sorted([{k:value(v) for k,v in row.items()} for row in rows],key=repr) for table,rows in tables.items()}


def test_actual_python_and_browser_capture_portable_facts_match(tmp_path):
    reference=Fixture(tmp_path/'reference.sqlite3');reference.now=NOW
    with storage.transaction(reference.path) as db:
        db.execute('DELETE FROM account_bindings');db.execute('DELETE FROM bank_accounts')
    reference.refresh(json.loads(full()))
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        for action in ('init','verify','refresh'):assert call(worker,action,now=NOW)['ok']
        data=discovery()
        with storage.transaction(reference.path) as db:left=accounts.discover(db,DiscoverConnection.model_validate(data),NOW)
        right=call(worker,'connections-discover',data=data,now=NOW)['result']
        settings=dict(expected_version=0,selection='enabled',zenmoney_account_id='a',import_start='2026-10-01')
        with storage.transaction(reference.path) as db:accounts.settings(db,left['accounts'][0]['id'],AccountSettings.model_validate(settings),NOW)
        assert call(worker,'accounts-configure',id=right['accounts'][0]['id'],data=settings,now=NOW)['ok']
        for run in range(2):
            request=str(uuid4())
            with storage.transaction(reference.path) as db:expected=capture.start(db,StartSync(connection_id=left['id'],request_id=request,reimport_from='2026-10-01'),NOW)
            actual=call(worker,'capture-start',data=dict(connection_id=right['id'],request_id=request,reimport_from='2026-10-01'),now=NOW)['result']
            interval_l=expected['accounts'][0]['intervals'][0]['id'];interval_r=actual['accounts'][0]['intervals'][0]['id']
            with storage.transaction(reference.path) as db:owned=capture.lease(db,expected['id'],CaptureLeaseRequest(worker_id=WORKER),NOW)
            owned_r=call(worker,'capture-lease',id=actual['id'],data=dict(worker_id=WORKER),now=NOW)['result']
            assert str(owned['epoch'])==owned_r['epoch']
            # Out-of-order pages and a lost/repeated ACK must preserve exact page
            # JSON/digest and append one revision only when the observation changes.
            for number in (2,1,1):
                payload=dict(worker_id=WORKER,lease_epoch=owned['epoch'],page_number=number,total_pages=2,total_records=2,
                    records=[record('bank-'+str(number),description='Updated' if run else 'Fixture payment',amount='123456789012345678901234' if number==2 else '100')])
                with storage.transaction(reference.path) as db,patch('backend.records.time.time',return_value=NOW):reply=capture.page(db,expected['id'],interval_l,number,CapturePage.model_validate(payload),NOW)
                saved=call(worker,'capture-page',id=actual['id'],intervalId=interval_r,number=number,data=payload,now=NOW);assert saved['ok'],saved
                assert saved['result']==reply
            payload=dict(worker_id=WORKER,lease_epoch=owned['epoch'],total_pages=2,total_records=2)
            with storage.transaction(reference.path) as db:capture.complete(db,expected['id'],interval_l,CaptureComplete.model_validate(payload),NOW);view=capture.job_view(db,expected['id'],NOW)
            final=call(worker,'capture-complete',id=actual['id'],intervalId=interval_r,data=payload,now=NOW);assert final['ok'],final
            observed=call(worker,'capture-get',id=actual['id'],now=NOW)['result']
            assert {k:view[k] for k in ('capture_state','delivery_state','delivery','errors')}=={k:observed[k] for k in ('capture_state','delivery_state','delivery','errors')}
            local=call(worker,'capture-state')['result']
            with storage.transaction(reference.path,read_only=True) as db:
                remote={table:[dict(row) for row in db.execute('SELECT * FROM '+('account_capture_locks' if table=='source_capture_leases' else table))] for table in TABLES}
            for table in TABLES:assert normalized(local)[table]==normalized(remote)[table],(run,table,normalized(local)[table],normalized(remote)[table])
        assert call(worker,'export',now=NOW)['ok']
    reference.close()
