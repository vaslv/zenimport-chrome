"""Reports depend on proved source reads, never on financial delivery readiness."""
import json
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_mirror import call
from test_capture import setup,start,lease,page,complete,record,NOW


def remote(id='zen-1',amount=100,**changes):
    return dict(id=id,date='2026-10-20',incomeAccount='a',outcomeAccount='a',incomeInstrument=2,outcomeInstrument=2,income=0,outcome=amount,created=100,comment=id,tag=[])|changes


def refresh(worker,transactions):
    result=call(worker,'refresh',raw=json.dumps(dict(serverTimestamp=100,transaction=transactions)),now=NOW);assert result['ok'],result


def capture(worker,connection,records,done=True):
    job=start(worker,connection)['result'];owned=lease(worker,job);interval=job['accounts'][0]['intervals'][0]
    assert page(worker,job,interval,owned,records)['ok']
    if done:assert complete(worker,job,interval,owned,total=len(records))['ok']
    return job


def report(worker,connection,**options):
    return call(worker,'report-build',now=NOW,data=dict(connection_id=connection['id'],from_date='2026-10-20',to_date='2026-10-20')|options)


def test_native_report_shows_both_sides_even_with_balanced_total_and_pending_delivery(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker);capture(worker,connection,[record('expense'),record('income',amount='200',direction='income')])
        refresh(worker,[remote('expense-zen',amount=150),remote('income-zen',amount=250,income=250,outcome=0)])
        result=report(worker,connection);assert result['ok'],result
        data=result['result'];assert data['accounts'][0]['checked_days']==1 and data['accounts'][0]['status']=='ready'
        day=data['days'][0];assert day['bank_total']==day['zenmoney_total']=='100' and day['difference']=='0'
        assert len(day['bank_operations'])==len(day['operations'])==2
        # Delivery is pending; the report is still fully available and read-only.
        assert all(row['state']=='pending' for row in call(worker,'capture-state')['result']['bank_processing'])
        assert not call(worker,'delivery-state')['result']


def test_native_report_uses_latest_completed_revision_not_incomplete_observation(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker);capture(worker,connection,[record()]);refresh(worker,[remote()])
        assert report(worker,connection)['result']['days']==[]
        capture(worker,connection,[record(amount='150')],done=False)
        result=report(worker,connection);assert result['ok'] and result['result']['days']==[],result


def test_native_report_retains_extra_uuid_and_counts_only_complete_coverage(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker);capture(worker,connection,[record()]);refresh(worker,[remote('first'),remote('extra')])
        result=report(worker,connection,to_date='2026-10-21');assert result['ok'],result
        assert result['result']['accounts'][0]['checked_days']==2
        day=result['result']['days'][0];assert day['bank_operations']==[] and len(day['operations'])==1 and day['difference']=='-100'
        # Repeated report refresh neither adopts a match nor changes source facts.
        before=call(worker,'snapshot-begin',now=NOW)['result'];assert report(worker,connection)['ok']
        assert call(worker,'snapshot-begin',now=NOW)['result']==before


def test_native_report_without_complete_history_and_with_stale_mirror_never_invents_discrepancy(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker);capture(worker,connection,[record()],done=False);refresh(worker,[remote()])
        result=report(worker,connection);assert result['ok'],result
        assert result['result']['accounts'][0]['checked_days']==0 and not result['result']['days']
        stale=call(worker,'report-build',now=NOW+301,data=dict(connection_id=connection['id'],from_date='2026-10-20',to_date='2026-10-20'))
        assert stale['code']=='zenmoney_unavailable',stale


def test_native_report_uses_current_connection_membership_not_historical_shared_support(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        connection=setup(worker);capture(worker,connection,[record()]);refresh(worker,[remote()])
        account=connection['accounts'][0]['id']
        assert call(worker,'connections-unlink',id=connection['id'],accountId=account,now=NOW)['ok']
        result=report(worker,connection);assert result['ok'] and result['result']['accounts']==[],result
        assert report(worker,connection,account_id=account)['code']=='not_found'


def test_native_portable_ready_mirror_without_private_confirmation_requires_full_read(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,page_ui,_) :
        connection=setup(worker);capture(worker,connection,[record()]);refresh(worker,[remote()])
        generation=call(worker,'snapshot-begin',now=NOW)['result']['generation']
        # A portable destination has financial mirror rows, never private local
        # confirmation. Preserve the exact ready/cursor/time/source/token state.
        page_ui.evaluate('''generation=>new Promise((resolve,reject)=>{
          const request=indexedDB.open('l6-mirror');request.onerror=()=>reject(request.error);
          request.onsuccess=()=>{const db=request.result,tx=db.transaction('application_state','readwrite');
            tx.objectStore('application_state').delete('mirror:'+generation);
            tx.oncomplete=()=>{db.close();resolve(true);};tx.onabort=()=>{db.close();reject(tx.error);};};
        })''',generation)
        assert report(worker,connection)['code']=='zenmoney_unavailable'
        settings=dict(expected_version=1,selection='enabled',zenmoney_account_id='a',import_start='2026-09-30')
        assert call(worker,'accounts-configure',id=connection['accounts'][0]['id'],data=settings,now=NOW)['code']=='zenmoney_unavailable'
        # force=False must still do an actual full read for the same token.
        from test_mirror import full
        data=json.loads(full());data['transaction']=[remote()]
        restored=call(worker,'refresh',force=False,raw=json.dumps(data),now=NOW);assert restored['ok'],restored
        assert restored['calls']==1 and restored['readiness']['ready']
        assert call(worker,'accounts-configure',id=connection['accounts'][0]['id'],data=settings,now=NOW)['ok']
        assert report(worker,connection)['result']['days']==[]
