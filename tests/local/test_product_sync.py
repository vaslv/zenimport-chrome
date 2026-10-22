"""Built popup-to-bank-to-SDK flow; independent fake server survives the worker."""
from contextlib import contextmanager
from copy import deepcopy
from datetime import date,timedelta
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json
import threading
import time
from uuid import uuid4
from playwright.sync_api import sync_playwright,expect
from test_popup_standalone import product

TARGET='10000000-0000-4000-8000-000000000001'

@contextmanager
def zenmoney():
    state={'transactions':{},'deletions':[],'writes':[],'cursor':int(time.time())}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            assert self.headers['Authorization']=='Bearer synthetic-verified'
            body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            assert 'deletion' not in body,'Product must never delete transactions'
            if 'transaction' in body:
                state['writes'].append(deepcopy(body['transaction']))
                for tx in body['transaction']:state['transactions'][tx['id']]=tx
            state['cursor']+=1
            payload={'serverTimestamp':state['cursor'],'user':[{'id':1}],
                'instrument':[{'id':2,'shortTitle':'VND'}],
                'account':[{'id':TARGET,'title':'Synthetic VND','type':'checking','user':1,'instrument':2}],
                'tag':[],'transaction':list(state['transactions'].values()),'deletion':state['deletions']}
            raw=json.dumps(payload).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(raw)
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:yield f'http://127.0.0.1:{server.server_port}/v8/diff/',state
    finally:server.shutdown();server.server_close();thread.join()


def test_local_product_capture_repeat_mobile_deletion_and_read_only_report(tmp_path):
    day=date.today()-timedelta(days=1)
    def history(route):
        body=json.loads(route.request.post_data);rows=[]
        if body['from']<=day.isoformat()<=body['to']:
            rows=[{'trxId':f'product-{i}','currency':'VND','dorC':'D' if i==0 else 'C',
                'remark':f'Synthetic product {i}','processDate':day.strftime('%d-%m-%Y')+' 10:12:25',
                'amount':str((i+1)*100),'balance':'9000'} for i in range(2)]
        route.fulfill(content_type='application/json',body=json.dumps({'error':False,'accountNo':body['account'],
            'currentPage':body['page'],'pageSize':100,'totalRecords':len(rows),'transactions':rows}))
    with zenmoney() as (url,remote),sync_playwright() as p,product(p,tmp_path,with_bank=True,sdk_url=url) as (browser,worker,popup,_):
        browser.route('https://api-ipay.vietinbank.vn/**',history)
        bank=next(page for page in browser.pages if page.url.startswith('https://ipay.'))
        popup.locator('#local-token').fill('synthetic-verified');popup.locator('#local-connect').click()
        try:expect(popup.locator('.account select')).to_contain_text('Synthetic VND',timeout=30000)
        except AssertionError:
            print('Setup:',popup.locator('body').inner_text())
            raise
        popup.locator('.account select').select_option(TARGET)
        popup.get_by_role('button',name='Save account',exact=True).click()
        expect(popup.locator('#sync')).to_be_enabled()
        def sync():
            expect(popup.locator('#sync')).to_have_text('Synchronize')
            expect(popup.locator('#sync')).to_be_enabled()
            previous=worker.evaluate("async()=> (await chrome.storage.local.get('capture')).capture?.command?.request_id")
            bank.bring_to_front();popup.locator('#sync').click();deadline=time.monotonic()+240;next_wake=0
            while time.monotonic()<deadline:
                current=worker.evaluate("async()=> (await chrome.storage.local.get('capture')).capture") or {}
                if current.get('command',{}).get('request_id') not in (None,previous) and current.get('job',{}).get('delivery_state')=='complete':return
                if time.monotonic()>=next_wake:
                    worker.evaluate("()=>{for(const name of ['capture','zenimport-local-delivery'])chrome.alarms.create(name,{when:Date.now()+100});}")
                    next_wake=time.monotonic()+5
                popup.wait_for_timeout(400)
            raise AssertionError(popup.locator('#status').inner_text()+' '+str(current))
        sync();assert sum(map(len,remote['writes']))==2
        assert len(remote['transactions'])==2 and all(tx['viewed'] is False for batch in remote['writes'] for tx in batch)
        sync();assert sum(map(len,remote['writes']))==2
        deleted=next(iter(remote['transactions']));del remote['transactions'][deleted]
        remote['deletions'].append({'object':'transaction','id':deleted})
        sync();assert sum(map(len,remote['writes']))==2 and deleted not in remote['transactions']
        extra=deepcopy(next(iter(remote['transactions'].values())));extra['id']=str(uuid4());extra['comment']='Synthetic unmatched extra'
        remote['transactions'][extra['id']]=extra
        with browser.expect_page() as opened:popup.locator('#discrepancies').click()
        report=opened.value
        try:expect(report.locator('.operation[data-source=zenmoney]')).to_contain_text('Synthetic unmatched extra',timeout=15000)
        except AssertionError:
            print('Report:',report.locator('body').inner_text())
            raise
        assert sum(map(len,remote['writes']))==2
