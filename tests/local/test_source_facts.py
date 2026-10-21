"""Named capture facts feed the domain adapter, with no synthetic API writer."""
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_mirror import call
from test_capture import setup,start,lease,page,complete,record,NOW


def test_native_source_adapter_reads_current_and_historical_bank_versions(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker);job=start(worker,connection)['result'];owned=lease(worker,job);interval=job['accounts'][0]['intervals'][0]
        assert page(worker,job,interval,owned,[record()])['ok']
        assert complete(worker,job,interval,owned)['ok']
        first=call(worker,'source-facts',now=NOW);assert first['ok'],first
        bank=first['result']['banks'][0][1];assert bank['revision']=='1' and bank['amount']=='100'
        job=start(worker,connection)['result'];owned=lease(worker,job);interval=job['accounts'][0]['intervals'][0]
        assert page(worker,job,interval,owned,[record(amount='150')])['ok']
        second=call(worker,'source-facts',now=NOW);assert second['ok'],second
        data=second['result'];current=dict(data['banks'])[bank['id']];versions=dict(data['revisions'])
        import json
        assert current['revision']=='2' and current['amount']=='150'
        assert versions[json.dumps([bank['id'],'1'],separators=(',',':'))]['amount']=='100'
        assert versions[json.dumps([bank['id'],'2'],separators=(',',':'))]['amount']=='150'
        assert data['stamp']!=first['result']['stamp']
