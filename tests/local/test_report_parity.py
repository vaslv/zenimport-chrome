"""Full reports compare real source SQLite and named native-IDB repositories."""
from datetime import date,datetime,timezone
from decimal import Decimal
import json
from uuid import uuid4
from unittest.mock import patch
import pytest
pytest.importorskip('backend')
from backend import storage,accounts,capture,discrepancies
from backend.sync_contracts import DiscoverConnection,AccountSettings,StartSync,CaptureLeaseRequest,CapturePage,CaptureComplete
from mirror_factory import Fixture
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_mirror import call,full
from test_connections import discovery
from test_capture import NOW,WORKER,record
from test_local_reports import remote


def normalize(report,bank_ids,account_ids,connection_id):
    def visit(value,key=None):
        if key=='refreshed_at':return datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()
        if key=='created':return str(value) if value is not None else None
        if key in ('bank_total','zenmoney_total','difference','amount'):
            parsed=Decimal(value);return '0' if not parsed else format(parsed.normalize(),'f')
        if isinstance(value,dict):return {k:visit(v,k) for k,v in value.items()}
        if isinstance(value,list):
            result=[visit(v) for v in value]
            # IDs generated independently sort differently in each DB. Compare
            # account membership after semantic ID mapping, not random UUID order.
            return sorted(result,key=lambda row:row['id']) if key in ('accounts','bank_operations') else result
        if value==connection_id:return 'connection'
        if isinstance(value,str):return bank_ids.get(value,account_ids.get(value,value))
        return value
    return visit(report)


@pytest.mark.parametrize('case',['balanced','duplicate','split','fx','income_transfer','mobile_edit','held','deleted','partial_revision','no_coverage','shared_target','different_days'])
def test_actual_python_and_native_complete_reports_match(tmp_path,case):
    f=Fixture(tmp_path/'source.sqlite3');f.now=NOW
    try:
        with storage.transaction(f.path) as db:db.execute('DELETE FROM account_bindings');db.execute('DELETE FROM bank_accounts')
        f.refresh(json.loads(full()))
        with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
            for action in ('init','verify','refresh'):assert call(worker,action,now=NOW)['ok']
            data=discovery(keys=('primary','secondary') if case=='shared_target' else ('primary',))
            with storage.transaction(f.path) as db:left=accounts.discover(db,DiscoverConnection.model_validate(data),NOW)
            right=call(worker,'connections-discover',data=data,now=NOW)['result']
            for side in ('left','right'):
                for account in (left if side=='left' else right)['accounts']:
                    config=dict(expected_version=0,selection='enabled',zenmoney_account_id='a',import_start='2026-10-01')
                    if side=='left':
                        with storage.transaction(f.path) as db:accounts.settings(db,account['id'],AccountSettings.model_validate(config),NOW)
                    else:assert call(worker,'accounts-configure',id=account['id'],data=config,now=NOW)['ok']
            records=[record()];txs=[remote()]
            if case=='balanced':records.append(record('income',direction='income',amount='200'));txs=[remote(amount=150),remote('income-zen',income=250,outcome=0)]
            if case=='duplicate':txs.append(remote('extra'))
            if case=='split':txs=[remote('split-a',amount=40),remote('split-b',amount=60)]
            if case=='fx':txs=[remote(incomeAccount='other',income=Decimal('0.0000001'),incomeInstrument=3)]
            if case=='income_transfer':records=[record(direction='income')];txs=[remote(income=100,outcome=100,outcomeAccount='other')]
            if case=='mobile_edit':txs=[remote(amount=130)]
            if case=='held':txs=[remote(hold=True)]
            if case=='deleted':txs=[remote(deleted=True)]
            if case=='different_days':records=[record(local_date='2026-10-19',occurred_at='2026-10-19T12:00:00+07:00')]
            # Use the published lossless source codec for Decimal payloads.
            from zenmoney_api.protocol import encode_json
            raw=encode_json(dict(serverTimestamp=100,transaction=txs));f.refresh(raw)
            assert call(worker,'refresh',raw=raw.decode(),now=NOW)['ok']
            for run in range(2 if case=='partial_revision' else 1):
                request=str(uuid4())
                with storage.transaction(f.path) as db:job_l=capture.start(db,StartSync(connection_id=left['id'],request_id=request,reimport_from='2026-10-01'),NOW)
                job_r=call(worker,'capture-start',data=dict(connection_id=right['id'],request_id=request,reimport_from='2026-10-01'),now=NOW)['result']
                for job,side in ((job_l,'left'),(job_r,'right')):
                    if side=='left':
                        with storage.transaction(f.path) as db:owned=capture.lease(db,job['id'],CaptureLeaseRequest(worker_id=WORKER),NOW)
                    else:owned=call(worker,'capture-lease',id=job['id'],data=dict(worker_id=WORKER),now=NOW)['result']
                    for interval in [i for a in job['accounts'] for i in a['intervals']]:
                        values=[record(amount='150')] if run else records
                        payload=dict(worker_id=WORKER,lease_epoch=int(owned['epoch']),page_number=1,total_pages=1,total_records=len(values),records=values)
                        if side=='left':
                            with storage.transaction(f.path) as db,patch('backend.records.time.time',return_value=NOW):capture.page(db,job['id'],interval['id'],1,CapturePage.model_validate(payload),NOW)
                        else:assert call(worker,'capture-page',id=job['id'],intervalId=interval['id'],number=1,data=payload,now=NOW)['ok']
                        if run or case=='no_coverage':continue
                        done=dict(worker_id=WORKER,lease_epoch=int(owned['epoch']),total_pages=1,total_records=len(values))
                        if side=='left':
                            with storage.transaction(f.path) as db:capture.complete(db,job['id'],interval['id'],CaptureComplete.model_validate(done),NOW)
                        else:assert call(worker,'capture-complete',id=job['id'],intervalId=interval['id'],data=done,now=NOW)['ok']
            with storage.transaction(f.path,read_only=True) as db:
                expected=discrepancies.build(db,left['id'],NOW,from_date=date(2026,10,19),to_date=date(2026,10,21))
                expected=json.loads(discrepancies.DiscrepancyReport.model_validate(expected).model_dump_json())
                ids_l={r['id']:r['external_id'] for r in db.execute('SELECT * FROM bank_transactions')}
            actual=call(worker,'report-build',now=NOW,data=dict(connection_id=right['id'],from_date='2026-10-19',to_date='2026-10-21'));assert actual['ok'],actual
            ids_r={r['id']:r['external_id'] for r in call(worker,'capture-state')['result']['bank_transactions']}
            a_l={r['id']:r['source_key'] for r in left['accounts']};a_r={r['id']:r['source_key'] for r in right['accounts']}
            assert normalize(actual['result'],ids_r,a_r,right['id'])==normalize(expected,ids_l,a_l,left['id'])
    finally:f.close()
