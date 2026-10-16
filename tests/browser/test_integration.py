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
from support import TOKEN, ORIGIN, installed, connect, run_clock

DAY=date(2026,10,16)
NOW=int(datetime(2026,10,16,5,tzinfo=timezone.utc).timestamp())
TARGET='fixture-zenmoney-vnd'
SECOND='fixture-other-vnd'

@contextmanager
def service(tmp_path,drop_page_ack=False):
    path=tmp_path/'fixture.sqlite3'
    remote=FakeZenMoney(path)
    app=create_app(Settings(path,TOKEN,'fixture-sdk-token'),clock=lambda:NOW,
        client_factory=lambda _:Client('fixture-sdk-token',transport=httpx.MockTransport(remote.handle),clock=lambda:NOW))
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

def pump_until(popup,worker,check,timeout=20):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        if check():return
        run_clock(popup,worker)
    raise AssertionError('Fixture capture did not finish: '+popup.locator('#status').inner_text()+' '+json.dumps(state(worker)))

def account(popup,target,source="12345678"):
    form=popup.locator('.account').filter(has_text=source)
    form.locator('select').select_option(target)
    form.get_by_role('button',name='Сохранить счёт',exact=True).click()
    expect(popup.locator('#status')).to_contain_text('Счёт сохранён')

def state(worker):return worker.evaluate("async()=> (await chrome.storage.local.get('capture')).capture")

def start_sync(popup,bank,worker):
    previous=(state(worker) or {}).get('command',{}).get('request_id')
    bank.bring_to_front();popup.locator('#sync').click()
    pump_until(popup,worker,lambda:(state(worker) or {}).get('command',{}).get('request_id') not in (None,previous))


def test_two_accounts_ignored_prediction_unread_repeat_mobile_delete_and_backfill(tmp_path):
    bank_api=Bank()
    with service(tmp_path) as (url,path,remote,app), sync_playwright() as p, installed(p,url,bank_api) as (context,worker,bank,popup,identifier):
        connect(popup,bank,url);expect(popup.locator('.account')).to_have_count(1);account(popup,TARGET)
        # Add selected accounts on successive visits; accounts_complete stays false.
        bank.goto(ORIGIN+'/payment-history?accountNo=87654321');bank.bring_to_front();popup.locator('#refresh-accounts').click()
        expect(popup.locator('.account')).to_have_count(2);account(popup,SECOND,"87654321")
        bank.goto(ORIGIN+'/payment-history?accountNo=11112222');bank.bring_to_front();popup.locator('#refresh-accounts').click()
        expect(popup.locator('.account')).to_have_count(3);account(popup,'ignored',"11112222")
        with storage.transaction(path,read_only=True) as db:
            identifier_a=db.execute("SELECT id FROM bank_accounts WHERE source_key='12345678'").fetchone()[0]
        historical=object.__new__(Fixture);historical.path=path;historical.now=NOW;historical.data={'transaction':[]}
        historical.history(count=3,account=identifier_a,beneficiary_account='merchant-known',beneficiary_name='Fixture merchant')
        for record in historical.data['transaction']:
            record['outcomeAccount']=record['incomeAccount']=TARGET;remote.transactions[record['id']]=record
        # A possible historical match must not suppress an ambiguous new row.
        remote.transactions['ambiguous-old']=movement('ambiguous-old',amount=200,date='2026-10-12',incomeAccount=TARGET,outcomeAccount=TARGET)
        bank.goto(ORIGIN+'/payment-history?accountNo=12345678');bank.bring_to_front();popup.locator('#refresh-accounts').click()
        expect(popup.locator('#sync')).to_be_enabled()
        start_sync(popup,bank,worker)
        pump_until(popup,worker,lambda:(state(worker) or {}).get('phase')=='complete')
        pump_until(popup,worker,lambda:(state(worker) or {}).get('job',{}).get('delivery_state')=='complete')
        created=[tx for batch in remote.writes for tx in batch]
        expect(popup.locator('#status')).to_contain_text('Обработано:')
        assert len(created)==6
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
        popup.locator('#settings').evaluate('(e)=>e.open=true')
        popup.locator('#reimport').fill('2026-09-01')
        start_sync(popup,bank,worker)
        pump_until(popup,worker,lambda:(state(worker) or {}).get('phase')=='complete')
        pump_until(popup,worker,lambda:(state(worker) or {}).get('job',{}).get('delivery_state')=='complete')
        assert {tx['id'] for batch in remote.writes for tx in batch}==original_ids
        assert sum(map(len,remote.writes))==6
        assert deleted not in remote.transactions
        assert remote.transactions[edited]['tag']==['category-b']
        popup.wait_for_function("async()=> !(await chrome.storage.local.get('reimportFrom')).reimportFrom")
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
        expect(popup.locator('#sync')).to_have_text('Синхронизировать')
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
        pump_until(popup,worker,lambda:(state(worker) or {}).get('phase')=='complete',timeout=45)
        pump_until(popup,worker,lambda:(state(worker) or {}).get('job',{}).get('delivery_state')=='complete',timeout=45)
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
        expect(popup.locator('#status')).to_contain_text('ZenMoney временно недоступен')
        assert not remote.writes
        with storage.transaction(path,read_only=True) as db:
            assert db.execute('SELECT count(*) FROM captured_records').fetchone()[0]==3
