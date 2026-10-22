"""Built MV3 + real backend HTTP/SQLite/SDK + synthetic bank/ZenMoney only."""
import pytest
pytest.importorskip('backend')
from contextlib import contextmanager
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import threading
import time
from uuid import uuid4

import httpx
from playwright.sync_api import sync_playwright, expect
import uvicorn
from zenmoney_api import Client
from backend.app import create_app
from backend.config import Settings
from backend import storage
from delivery_factory import FakeZenMoney
from mirror_factory import Fixture, movement
from support import TOKEN, ORIGIN, installed, connect, run_clock, FIXTURE_TIME_OFFSET
from test_bidv import BidvBank, bidv_install

DAY=date(2026,10,16)
NOW=int(datetime(2026,10,16,5,tzinfo=timezone.utc).timestamp())
TARGET='fixture-zenmoney-vnd'
SECOND='fixture-other-vnd'

@contextmanager
def service(tmp_path,drop_page_ack=False):
    path=tmp_path/'fixture.sqlite3'
    remote=FakeZenMoney(path)
    app=create_app(Settings(path,TOKEN,'fixture-sdk-token'),clock=lambda:int(time.time()+FIXTURE_TIME_OFFSET),
        client_factory=lambda _:Client('fixture-sdk-token',transport=httpx.MockTransport(remote.handle),clock=lambda:int(time.time()+FIXTURE_TIME_OFFSET)))
    if drop_page_ack:
        from starlette.responses import JSONResponse
        first=[True]
        @app.middleware('http')
        async def lose_ack(request,call_next):
            response=await call_next(request)
            if first[0] and request.method=='PUT' and '/pages/' in request.url.path and response.status_code==200:
                first[0]=False
                return JSONResponse({'error':{'code':'internal_error','retryable':True}},status_code=504)
            return response
    # Bind an actual ephemeral localhost HTTP listener, not TestClient.
    import socket
    sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    server=uvicorn.Server(uvicorn.Config(app,log_level='error'))
    thread=threading.Thread(target=lambda:server.run(sockets=[sock]),daemon=True);thread.start()
    deadline=time.monotonic()+10
    while not server.started and time.monotonic()<deadline:time.sleep(.02)
    assert server.started
    try:yield f'http://127.0.0.1:{port}',path,remote,app
    finally:server.should_exit=True;thread.join(15);assert not thread.is_alive()

class Bank:
    def __init__(self,count=3):self.count=count;self.calls=[];self.hold=False;self.corrupt=False;self.pending=[]
    def __call__(self,route):
        body=json.loads(route.request.post_data)
        self.calls.append(body)
        account=body['account'];start=body['from'];end=body['to'];rows=[]
        # Stable source records independent of request windows, three each.
        for index in range(self.count):
            amount=str((index+1)*100)
            local=(DAY-timedelta(days=3+(index if self.count==3 else 0))).isoformat()
            if start<=local<=end:
                rows.append({'trxId':f'{account}-record-{index}','currency':'VND','dorC':'C' if index==2 else 'D','remark':'Fixture shop '+str(index),
                    'processDate':datetime.fromisoformat(local).strftime('%d-%m-%Y')+' 10:12:25','amount':amount,'balance':'9000',
                    'corresponsiveAccount':'merchant-known' if index==0 else 'merchant-unknown-'+str(index),'corresponsiveName':'Fixture merchant'})
        if self.corrupt and account=='87654321':rows.append(deepcopy(rows[0]))
        if self.hold:self.pending.append(route);return
        route.fulfill(content_type='application/json',body=json.dumps({'error':False,'accountNo':account,'currentPage':body['page'],
            'pageSize':100,'totalRecords':len(rows) if body['page']==0 else 0,'transactions':rows[body['page']*100:(body['page']+1)*100]}))

def pump_until(popup,worker,check,timeout=180):
    # Native IDB fencing adds durable work to every captured interval. Allow
    # multi-account/month walks to finish; production driver timeouts are unchanged.
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        if check():return
        run_clock(popup,worker)
    raise AssertionError('Fixture capture did not finish: '+popup.locator('#status').inner_text()+' '+json.dumps(state(worker)))

def pump_control(popup,worker,check,timeout=60):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        if check():return
        worker.evaluate('()=>chrome.alarms.create("zenimport-storage-control",{when:Date.now()+100,periodInMinutes:.5})')
        popup.wait_for_timeout(400)
    raise AssertionError('Storage operation did not finish: '+popup.locator('#migration-status').inner_text())


def account(popup,target,source="12345678"):
    form=popup.locator('.account').filter(has_text=source)
    try:form.locator('select').select_option(target)
    except Exception:
        print('Account setup:',popup.locator('body').inner_text())
        raise
    form.get_by_role('button',name='Save account',exact=True).click()
    expect(popup.locator('#status')).to_contain_text('Account saved',timeout=15000)

def refresh_accounts(popup):
    popup.locator('#refresh-accounts').click()
    expect(popup.locator('#status')).not_to_contain_text('Loading account settings',timeout=30000)


def state(worker):return worker.evaluate("async()=> (await chrome.storage.local.get('capture')).capture")

def start_sync(popup,bank,worker):
    previous=(state(worker) or {}).get('command',{}).get('request_id')
    bank.bring_to_front();popup.locator('#sync').click()
    def acknowledged():
        current=state(worker) or {}
        # The durable command precedes HTTP; only the stored job proves its ACK.
        return current.get('command',{}).get('request_id') not in (None,previous) and bool(current.get('job'))
    pump_until(popup,worker,acknowledged)


def test_popup_zip_export_switch_import_and_no_duplicate_or_restored_deletion(tmp_path):
    bank_api=Bank()
    with service(tmp_path/'a') as (url_a,path_a,remote_a,app_a), service(tmp_path/'b') as (url_b,path_b,remote_b,app_b), sync_playwright() as p:
        with installed(p,url_a,bank_api) as (context,worker,bank,popup,identifier):
            connect(popup,bank,url_a);expect(popup.locator('.account')).to_have_count(1);account(popup,TARGET)
            start_sync(popup,bank,worker)
            pump_until(popup,worker,lambda:(state(worker) or {}).get('job',{}).get('delivery_state')=='complete')
            assert sum(map(len,remote_a.writes))==3
            deleted=next(iter(remote_a.transactions));del remote_a.transactions[deleted]
            remote_a.deletions.append({'object':'transaction','id':deleted});app_a.state.mirror.refresh(force=True,transactions=True)
            # FakeZenMoney records a lock probe in test-only metadata; it is not
            # application data and is intentionally outside the portable whitelist.
            with storage.transaction(path_a) as db:
                db.execute("DELETE FROM service_meta WHERE key='fixture-network-write-lock-free'")
            popup.locator('#migration-settings').evaluate('(e)=>e.open=true')
            popup.locator('#archive-source').select_option('remote');popup.locator('#export-data').click()
            worker.evaluate('()=>chrome.alarms.create("zenimport-storage-control",{when:Date.now()+100,periodInMinutes:.5})')
            try:pump_control(popup,worker,lambda:popup.locator('#download-data').is_enabled())
            except AssertionError:
                print('Migration UI:',popup.locator('#migration-status').inner_text())
                print('Control status:',popup.evaluate("async()=>{const s=await chrome.runtime.sendMessage({type:'status',operation_id:crypto.randomUUID()});const {operation_id,...context}=s.context;return chrome.runtime.sendMessage({type:'archive-status',context,operation_id:crypto.randomUUID()});}"))
                raise
            with popup.expect_download() as pending:popup.locator('#download-data').click()
            archive=tmp_path/'move.zip';pending.value.save_as(archive)
            assert archive.read_bytes().startswith(b'PK')
            popup.locator('#ack-download').click()
            expect(popup.locator('#migration-status')).to_contain_text('Backup confirmed')
        # This recovery scenario retires the old browser and worker explicitly.
        # A backup alone is not an authority transfer and does not pause a writer.
        app_a.state.delivery.stop()
        remote_b.transactions=deepcopy(remote_a.transactions);remote_b.deletions=deepcopy(remote_a.deletions)
        with installed(p,url_b,bank_api) as (context,worker,bank,popup,identifier):
            connect(popup,bank,url_b)
            popup.locator('#migration-settings').evaluate('(e)=>e.open=true')
            popup.locator('#restore-target').select_option('server')
            popup.locator('#retired-writers').check();popup.locator('#snapshot-loss').check()
            with popup.expect_file_chooser() as chooser:popup.locator('#import-data').click()
            chooser.value.set_files(archive)
            worker.evaluate('()=>chrome.alarms.create("zenimport-storage-control",{when:Date.now()+100,periodInMinutes:.5})')
            pump_control(popup,worker,lambda:popup.locator('#restore-preview').is_visible())
            assert not remote_b.writes
            popup.locator('#accept-preview').check();popup.locator('#confirm-restore').click()
            worker.evaluate('()=>chrome.alarms.create("zenimport-storage-control",{when:Date.now()+100,periodInMinutes:.5})')
            pump_control(popup,worker,lambda:'Data restored' in popup.locator('#migration-status').inner_text())
            assert not remote_b.writes and app_b.state.portable.capabilities()['awaiting_sync']
            start_sync(popup,bank,worker)
            pump_until(popup,worker,lambda:(state(worker) or {}).get('job',{}).get('delivery_state')=='complete')
            assert not remote_b.writes and deleted not in remote_b.transactions
            with storage.transaction(path_b,read_only=True) as db:
                assert db.execute('SELECT count(*) FROM bank_transactions').fetchone()[0]==3
                assert db.execute('SELECT 1 FROM zen_tombstones WHERE entity_id=?',(deleted,)).fetchone()
                storage.check_integrity(db)


def test_existing_multi_account_connection_prediction_unread_repeat_mobile_delete_and_backfill(tmp_path):
    bank_api=Bank()
    with service(tmp_path) as (url,path,remote,app), sync_playwright() as p, installed(p,url,bank_api) as (context,worker,bank,popup,identifier):
        connect(popup,bank,url);expect(popup.locator('.account')).to_have_count(1);account(popup,TARGET)
        # Seed a legacy multi-account connection through the retained RPC, not UI.
        # New single-account pages now create connections automatically; existing
        # memberships must still retain multi-account capture and delivery behavior.
        legacy_profile=popup.evaluate("async()=> (await chrome.storage.local.get('view')).view.connection.profile_key")
        def seed_membership():
            result=popup.evaluate("async key=>{const status=await chrome.runtime.sendMessage({type:'status',operation_id:crypto.randomUUID()});const {operation_id,...context}=status.context;return chrome.runtime.sendMessage({type:'select-bank-connection',profileKey:key,context,operation_id:crypto.randomUUID()});}",legacy_profile)
            assert result['ok']
        bank.goto(ORIGIN+'/payment-history?accountNo=87654321');bank.bring_to_front();seed_membership();refresh_accounts(popup)
        expect(popup.locator('.account')).to_have_count(2);account(popup,SECOND,"87654321")
        bank.goto(ORIGIN+'/payment-history?accountNo=11112222');bank.bring_to_front();seed_membership();refresh_accounts(popup)
        expect(popup.locator('.account')).to_have_count(3);account(popup,'ignored',"11112222")
        with storage.transaction(path,read_only=True) as db:
            identifier_a=db.execute("SELECT id FROM bank_accounts WHERE source_key='12345678'").fetchone()[0]
        historical=object.__new__(Fixture);historical.path=path;historical.now=NOW;historical.data={'transaction':[]}
        historical.history(count=3,account=identifier_a,beneficiary_account='merchant-known',beneficiary_name='Fixture merchant')
        for record in historical.data['transaction']:
            record['outcomeAccount']=record['incomeAccount']=TARGET;remote.transactions[record['id']]=record
        # The user now requires matching every type by account/day/amount before creation.
        remote.transactions['ambiguous-old']=movement('ambiguous-old',amount=200,date='2026-10-12',incomeAccount=TARGET,outcomeAccount=TARGET)
        retained=deepcopy(remote.transactions['ambiguous-old'])
        bank.goto(ORIGIN+'/payment-history?accountNo=12345678');bank.bring_to_front();refresh_accounts(popup)
        expect(popup.locator('#sync')).to_be_enabled()
        start_sync(popup,bank,worker)
        pump_until(popup,worker,lambda:(state(worker) or {}).get('phase')=='complete')
        pump_until(popup,worker,lambda:(state(worker) or {}).get('job',{}).get('delivery_state')=='complete')
        created=[tx for batch in remote.writes for tx in batch]
        expect(popup.locator('#status')).to_contain_text('Processed:')
        assert len(created)==5
        assert remote.transactions['ambiguous-old']==retained
        assert all(tx['viewed'] is False for tx in created)
        assert {tx['outcomeAccount'] for tx in created}=={TARGET,SECOND}
        assert not any(call['account']=='11112222' for call in bank_api.calls)
        predicted=[tx for tx in created if tx['outcomeAccount']==TARGET and tx['outcome']==100]
        assert len(predicted)==1 and predicted[0]['tag']==['category-a']
        assert any(tx.get('tag') is None for tx in created)
        assert not bank.locator('[id*=zenimport], [class*=zenimport]').count()
        if Path('/results').is_dir():popup.screenshot(path='/results/popup-synced.png',full_page=True)
        original_ids={tx['id'] for tx in created}
        # Mobile changes and deletion are final. Rereading older history cannot
        # restore the deleted record or overwrite the other record's category.
        edited=created[0]['id'];deleted=created[1]['id']
        remote.transactions[edited].update(viewed=True,tag=['category-b'],comment='Mobile edit')
        del remote.transactions[deleted];remote.deletions.append({'object':'transaction','id':deleted})
        popup.locator('#history-settings > summary').click()
        popup.locator('#reimport').fill('2026-09-01')
        start_sync(popup,bank,worker)
        pump_until(popup,worker,lambda:(state(worker) or {}).get('phase')=='complete')
        pump_until(popup,worker,lambda:(state(worker) or {}).get('job',{}).get('delivery_state')=='complete')
        assert {tx['id'] for batch in remote.writes for tx in batch}==original_ids
        assert sum(map(len,remote.writes))==5
        assert remote.transactions['ambiguous-old']==retained
        assert deleted not in remote.transactions
        assert remote.transactions[edited]['tag']==['category-b']
        popup.wait_for_function("async()=> !Object.values((await chrome.storage.local.get('reimportDates')).reimportDates || {}).some(Boolean)")
        with storage.transaction(path,read_only=True) as db:assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'


def test_lost_page_ack_replays_same_snapshot_without_duplicate_delivery(tmp_path):
    bank_api=Bank()
    with service(tmp_path,drop_page_ack=True) as (url,path,remote,app), sync_playwright() as p, installed(p,url,bank_api) as (_,worker,bank,popup,_):
        connect(popup,bank,url);expect(popup.locator('.account')).to_have_count(1);account(popup,TARGET)
        start_sync(popup,bank,worker)
        pump_until(popup,worker,lambda:(state(worker) or {}).get('phase')=='paused')
        with storage.transaction(path,read_only=True) as db:
            assert db.execute('SELECT count(*) FROM capture_pages').fetchone()[0]==1
        assert not remote.writes
        original=state(worker)['job']['id']
        expect(popup.locator('#sync')).to_have_text('Synchronize')
        start_sync(popup,bank,worker)
        pump_until(popup,worker,lambda:(state(worker) or {}).get('phase')=='complete')
        pump_until(popup,worker,lambda:(state(worker) or {}).get('job',{}).get('delivery_state')=='complete')
        assert state(worker)['job']['id']==original
        assert sum(map(len,remote.writes))==3


def test_popup_closure_and_real_service_worker_stop_then_lost_sdk_response(tmp_path):
    bank_api=Bank();bank_api.hold=True
    with service(tmp_path) as (url,path,remote,app), sync_playwright() as p, installed(p,url,bank_api) as (context,worker,bank,popup,identifier):
        remote.mode='timeout_after'
        connect(popup,bank,url);expect(popup.locator('.account')).to_have_count(1);account(popup,TARGET)
        start_sync(popup,bank,worker)
        deadline=time.monotonic()+10
        while not bank_api.pending and time.monotonic()<deadline:bank.wait_for_timeout(50)
        assert bank_api.pending
        popup.close()
        session=context.browser.new_browser_cdp_session() if context.browser else context.new_cdp_session(bank)
        targets=session.send('Target.getTargets')['targetInfos']
        target=next(t for t in targets if t['type']=='service_worker' and identifier in t['url'])
        worker.evaluate("globalThis.__fixtureSentinel='old-worker'")
        assert session.send('Target.closeTarget',{'targetId':target['targetId']})['success']
        popup=context.new_page();popup.goto(f'chrome-extension://{identifier}/popup.html');bank.bring_to_front()
        popup.wait_for_timeout(1000)
        # Chromium reuses the DevTools target ID; Playwright retains the old
        # destroyed execution context. Prove termination on that object, then
        # use the trusted popup to inspect durable state and wake real alarms.
        from playwright.sync_api import Error
        with pytest.raises(Error,match='Execution context was destroyed'):
            worker.evaluate("globalThis.__fixtureSentinel || null")
        worker=popup
        assert popup.evaluate("async()=> (await chrome.runtime.sendMessage({type:'status'})).ok")
        assert state(worker)['phase']=='collecting'
        bank_api.hold=False
        pending,bank_api.pending=bank_api.pending,[]
        for route in pending:bank_api(route)
        pump_until(popup,worker,lambda:(state(worker) or {}).get('phase')=='complete')
        pump_until(popup,worker,lambda:(state(worker) or {}).get('job',{}).get('delivery_state')=='complete')
        assert sum(map(len,remote.writes))==3
        assert len({tx['id'] for batch in remote.writes for tx in batch})==3
        assert all(tx['viewed'] is False for batch in remote.writes for tx in batch)


def test_observed_pagination_cache_then_zero_total_continuation(tmp_path):
    bank_api=Bank(count=132)
    with service(tmp_path) as (url,path,remote,app), sync_playwright() as p, installed(p,url,bank_api) as (_,worker,bank,popup,_):
        connect(popup,bank,url);expect(popup.locator('.account')).to_have_count(1);account(popup,TARGET)
        start_sync(popup,bank,worker)
        pump_until(popup,worker,lambda:(state(worker) or {}).get('phase')=='complete',timeout=180)
        pump_until(popup,worker,lambda:(state(worker) or {}).get('job',{}).get('delivery_state')=='complete',timeout=180)
        assert any(call['page']==1 for call in bank_api.calls)
        assert sum(map(len,remote.writes))==132
        assert len({tx['id'] for batch in remote.writes for tx in batch})==132


def test_changed_bank_filter_cannot_complete_an_interval(tmp_path):
    bank_api=Bank();bank_api.hold=True
    with service(tmp_path) as (url,path,remote,app), sync_playwright() as p, installed(p,url,bank_api) as (_,worker,bank,popup,_):
        connect(popup,bank,url);expect(popup.locator('.account')).to_have_count(1);account(popup,TARGET)
        start_sync(popup,bank,worker)
        deadline=time.monotonic()+10
        while not bank_api.pending and time.monotonic()<deadline:bank.wait_for_timeout(50)
        assert bank_api.pending
        bank.evaluate("document.querySelector('[placeholder=\"Choose time range\"]').value='01/01/2026 - 01/01/2026'")
        bank_api.hold=False
        pending,bank_api.pending=bank_api.pending,[]
        for route in pending:bank_api(route)
        pump_until(popup,worker,lambda:(state(worker) or {}).get('phase')=='failed')
        assert not remote.writes
        with storage.transaction(path,read_only=True) as db:
            assert db.execute('SELECT count(*) FROM coverage').fetchone()[0]==0


def test_zenmoney_outage_does_not_stop_bank_capture_or_claim_uncertain_writes(tmp_path):
    bank_api=Bank()
    with service(tmp_path) as (url,path,remote,app), sync_playwright() as p, installed(p,url,bank_api) as (_,worker,bank,popup,_):
        connect(popup,bank,url);expect(popup.locator('.account')).to_have_count(1);account(popup,TARGET)
        remote.read_failure=503
        start_sync(popup,bank,worker)
        pump_until(popup,worker,lambda:(state(worker) or {}).get('phase')=='complete')
        expect(popup.locator('#status')).to_contain_text('History saved. ZenMoney is unavailable')
        assert not remote.writes
        with storage.transaction(path,read_only=True) as db:
            assert db.execute('SELECT count(*) FROM captured_records').fetchone()[0]==3


def test_discrepancy_page_reads_actual_backend_and_refreshes_mobile_deletion(tmp_path):
    bank_api=Bank(count=1)
    with service(tmp_path) as (url,path,remote,app), sync_playwright() as p, installed(p,url,bank_api) as (context,worker,bank,popup,_):
        connect(popup,bank,url);expect(popup.locator('.account')).to_have_count(1);account(popup,TARGET)
        start_sync(popup,bank,worker)
        pump_until(popup,worker,lambda:(state(worker) or {}).get('job',{}).get('delivery_state')=='complete')
        remote.transactions['unlinked-extra']=movement('unlinked-extra',amount=50,date='2026-10-13',
            incomeAccount=TARGET,outcomeAccount=TARGET,payee='Extra fixture',comment='Manual duplicate')
        writes=len(remote.writes)
        with context.expect_page() as opened:popup.locator('#discrepancies').click()
        page=opened.value
        expect(page.locator('.operation')).to_have_count(1)
        expect(page.locator('.operation')).to_contain_text('Extra fixture')
        expect(page.locator('.totals')).to_contain_text('Difference: −50 VND')
        del remote.transactions['unlinked-extra']
        remote.deletions.append({'object':'transaction','id':'unlinked-extra'})
        page.locator('#refresh').click()
        expect(page.locator('#summary')).to_contain_text('No discrepancies were found')
        assert len(remote.writes)==writes


def test_bidv_full_sync_repeat_and_mobile_deletion_with_real_backend(tmp_path):
    bank_api=BidvBank()
    with service(tmp_path) as (url,path,remote,app),sync_playwright() as p,bidv_install(p,url,bank_api) as (context,worker,bank,popup,_):
        connect(popup,bank,url);expect(popup.locator('#bank')).to_have_text('BIDV');account(popup,TARGET)
        start_sync(popup,bank,worker)
        pump_until(popup,worker,lambda:(state(worker) or {}).get('job',{}).get('delivery_state')=='complete',timeout=180)
        assert sum(map(len,remote.writes))==4
        assert all(t['viewed'] is False for batch in remote.writes for t in batch)
        deleted=next(iter(remote.transactions));del remote.transactions[deleted]
        remote.deletions.append({'object':'transaction','id':deleted})
        start_sync(popup,bank,worker)
        pump_until(popup,worker,lambda:(state(worker) or {}).get('job',{}).get('delivery_state')=='complete',timeout=180)
        assert sum(map(len,remote.writes))==4 and deleted not in remote.transactions
        with storage.transaction(path,read_only=True) as db:
            assert db.execute('SELECT count(*) FROM bank_transactions').fetchone()[0]==4
            assert db.execute("SELECT bank FROM bank_accounts").fetchone()[0]=='bidv'


def test_bidv_load_more_and_transport_split_preserve_all_postings(tmp_path):
    bank_api=BidvBank(count=503)
    with service(tmp_path) as (url,path,remote,app),sync_playwright() as p,bidv_install(p,url,bank_api) as (_,worker,bank,popup,_):
        connect(popup,bank,url);account(popup,TARGET);start_sync(popup,bank,worker)
        # Delivery batching/rate limits are covered separately; this large UI
        # fixture checks complete capture and the 100-record transport boundary.
        try:pump_until(popup,worker,lambda:(state(worker) or {}).get('job',{}).get('capture_state')=='complete',timeout=180)
        except AssertionError:
            print('Bank calls:',bank_api.calls)
            print('Bank page:',bank.locator('body').inner_text()[-3000:])
            raise
        with storage.transaction(path,read_only=True) as db:
            assert db.execute('SELECT count(*) FROM bank_transactions').fetchone()[0]==503
            assert db.execute('SELECT max(page_number) FROM capture_pages').fetchone()[0]==6
        assert max(c['page'] for c in bank_api.calls)==25


def test_bidv_duplicate_posting_fails_without_delivery(tmp_path):
    bank_api=BidvBank(corrupt=True)
    with service(tmp_path) as (url,path,remote,app),sync_playwright() as p,bidv_install(p,url,bank_api) as (_,worker,bank,popup,_):
        connect(popup,bank,url);account(popup,TARGET);start_sync(popup,bank,worker)
        pump_until(popup,worker,lambda:(state(worker) or {}).get('phase')=='failed',timeout=180)
        assert not remote.writes
        with storage.transaction(path,read_only=True) as db:
            assert db.execute('SELECT count(*) FROM bank_transactions').fetchone()[0]==0


def test_bidv_widening_with_stale_ui_never_marks_coverage_complete(tmp_path):
    bank_api=BidvBank(stale=True)
    with service(tmp_path) as (url,path,remote,app),sync_playwright() as p,bidv_install(p,url,bank_api) as (_,worker,bank,popup,_):
        bank.evaluate("localStorage.setItem('fixtureInitialStart','2026-10-10')")
        connect(popup,bank,url);account(popup,TARGET);start_sync(popup,bank,worker)
        deadline=time.monotonic()+10
        while len(bank_api.calls)<2 and time.monotonic()<deadline:popup.wait_for_timeout(100)
        assert len(bank_api.calls)>=2
        popup.wait_for_timeout(700)
        with storage.transaction(path,read_only=True) as db:
            assert db.execute('SELECT count(*) FROM capture_pages').fetchone()[0]==0
            assert db.execute('SELECT count(*) FROM coverage').fetchone()[0]==0
        assert not remote.writes
        expect(popup.locator('#sync')).to_have_text('Stop capture')
        popup.locator('#sync').click()
        pump_until(popup,worker,lambda:(state(worker) or {}).get('phase')=='cancelled')


@pytest.mark.parametrize('override', [None, '2026-09-01'])
def test_initial_import_period_and_repeated_thirty_day_default(tmp_path, override):
    bank_api=Bank()
    with service(tmp_path) as (url,path,remote,_), sync_playwright() as p, installed(p,url,bank_api) as (_,worker,bank,popup,_):
        connect(popup,bank,url);expect(popup.locator('.account')).to_have_count(1)
        form=popup.locator('.account')
        form.locator('select').select_option(TARGET)
        form.get_by_role('button',name='6 months',exact=True).click()
        expect(form.locator('input[type=date]')).to_have_value('2026-04-16')
        form.get_by_role('button',name='Save account',exact=True).click()
        expect(popup.locator('#sync')).to_be_enabled()
        # Reopening must preserve the configured initial import, although the
        # optional repeat-period selector displays its usual 30-day default.
        popup.reload();bank.bring_to_front();expect(popup.locator('#sync')).to_be_enabled()
        expect(popup.locator('#reimport')).to_have_value('2026-09-16')
        if override:
            popup.locator('#history-settings > summary').click()
            popup.locator('#reimport').fill(override)
        start_sync(popup,bank,worker)
        current=state(worker)
        assert current['command']['reimport_from']==override
        intervals=current['job']['accounts'][0]['intervals']
        assert min(i['period']['start'] for i in intervals)==(override or '2026-04-16')
        pump_until(popup,worker,lambda:state(worker).get('job',{}).get('delivery_state')=='complete',timeout=180)
        assert sum(map(len,remote.writes))==3
        if override is None:
            # Once initial coverage is complete, repeated synchronization keeps
            # the agreed 30-day default rather than repeating six months.
            popup.reload();bank.bring_to_front();expect(popup.locator('#sync')).to_be_enabled()
            start_sync(popup,bank,worker)
            current=state(worker)
            assert current['command']['reimport_from']=='2026-09-16'
            assert min(i['period']['start'] for i in current['job']['accounts'][0]['intervals'])=='2026-09-16'
            pump_until(popup,worker,lambda:state(worker).get('job',{}).get('delivery_state')=='complete')
            assert sum(map(len,remote.writes))==3
