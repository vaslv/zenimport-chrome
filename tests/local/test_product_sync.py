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
def zenmoney(*,hold_first_write=False):
    state={'transactions':{},'deletions':[],'writes':[],'reads':[],'cursor':int(time.time()),
        'committed':threading.Event(),'release':threading.Event(),'committed_at':None}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            assert self.headers['Authorization']=='Bearer synthetic-verified'
            body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            assert 'deletion' not in body,'Product must never delete transactions'
            if 'transaction' in body:
                state['writes'].append(deepcopy(body['transaction']))
                for tx in body['transaction']:state['transactions'][tx['id']]=tx
            else:state['reads'].append(list(state['transactions']))
            state['cursor']+=1
            payload={'serverTimestamp':state['cursor'],'user':[{'id':1}],
                'instrument':[{'id':2,'shortTitle':'VND'}],
                'account':[{'id':TARGET,'title':'Synthetic VND','type':'checking','user':1,'instrument':2}],
                'tag':[],'transaction':list(state['transactions'].values()),'deletion':state['deletions']}
            raw=json.dumps(payload).encode()
            if hold_first_write and 'transaction' in body and len(state['writes'])==1:
                state['committed_at']=time.monotonic();state['committed'].set()
                state['release'].wait(30)
            self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers()
            try:self.wfile.write(raw)
            except (BrokenPipeError,ConnectionResetError):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:yield f'http://127.0.0.1:{server.server_port}/v8/diff/',state
    finally:state['release'].set();server.shutdown();server.server_close();thread.join()


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


READ_ONLY_OUTBOX="""async()=>{
 const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('zenimport-financial');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 const read=q=>new Promise((resolve,reject)=>{q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 try{const tx=db.transaction(['runtime','application_state','f_deliveries'],'readonly'),root=await read(tx.objectStore('runtime').get('runtime'));
  return {root,outbox:(await read(tx.objectStore('application_state').get('outbox:'+root.activeGeneration))).value,
    deliveries:await read(tx.objectStore('f_deliveries').index('generation').getAll(root.activeGeneration))};
 }finally{db.close();}
}"""


def test_product_restart_after_independent_server_commit_verifies_same_uuid_without_resend(tmp_path):
    day=date.today()-timedelta(days=1)
    def history(route):
        body=json.loads(route.request.post_data)
        rows=[dict(trxId='crash-commit',currency='VND',dorC='D',remark='Synthetic committed before crash',
            processDate=day.strftime('%d-%m-%Y')+' 10:12:25',amount='100',balance='9000')] if body['from']<=day.isoformat()<=body['to'] else []
        route.fulfill(content_type='application/json',body=json.dumps(dict(error=False,accountNo=body['account'],
            currentPage=body['page'],pageSize=100,totalRecords=len(rows),transactions=rows)))
    with zenmoney(hold_first_write=True) as (url,remote),sync_playwright() as p:
        with product(p,tmp_path,with_bank=True,sdk_url=url) as (browser,worker,popup,identifier):
            browser.route('https://api-ipay.vietinbank.vn/**',history)
            popup.locator('#local-token').fill('synthetic-verified');popup.locator('#local-connect').click()
            expect(popup.locator('.account select')).to_contain_text('Synthetic VND',timeout=30000)
            popup.locator('.account select').select_option(TARGET)
            popup.get_by_role('button',name='Save account',exact=True).click()
            expect(popup.locator('#sync')).to_be_enabled()
            next(page for page in browser.pages if page.url.startswith('https://ipay.')).bring_to_front()
            popup.locator('#sync').click();deadline=time.monotonic()+90;next_wake=0
            # Accelerate capture only before the fault. Delivery and recovery use
            # the product's persisted/recreated native periodic watchdog alone.
            while not remote['committed'].is_set() and time.monotonic()<deadline:
                if time.monotonic()>=next_wake:
                    worker.evaluate("()=>chrome.alarms.create('capture',{when:Date.now()+100,periodInMinutes:.5})")
                    next_wake=time.monotonic()+5
                popup.wait_for_timeout(50)
            assert remote['committed'].is_set(),'The independent fake server never accepted a create'
            assert not remote['release'].is_set()
            product_alarm=popup.evaluate("()=>chrome.alarms.get('zenimport-local-delivery')")
            assert product_alarm and product_alarm['periodInMinutes']==.5
            pending=popup.evaluate(READ_ONLY_OUTBOX)
            command=popup.evaluate("async()=> (await chrome.storage.local.get('capture')).capture")
            request_id=command['command']['request_id']
            assert pending['outbox']['phase']=='dispatching'
            assert len(pending['outbox']['items'])==1 and len(pending['deliveries'])==1
            item=pending['outbox']['items'][0];created=remote['writes'][0][0]
            assert item['zen_id']==created['id'] and json.loads(item['payload'])==created and created['viewed'] is False
            # Resolve column order from the frozen schema rather than assuming it.
            from pathlib import Path
            schema=json.loads(Path('/app/contracts/business/v1/sqlite-v7.json').read_text())
            columns=[column['name'] for column in schema['tables']['deliveries']['columns']]
            delivery=dict(zip(columns,[cell[1] if cell[0]!='null' else None for cell in pending['deliveries'][0]['row']]))
            assert delivery['state']=='attempting' and delivery['ever_attempted']=='1' and delivery['zen_id']==created['id']
            session=browser.new_cdp_session(popup)
            target=next(row for row in session.send('Target.getTargets')['targetInfos'] if row['type']=='service_worker' and row['url']==worker.url)
            assert session.send('Target.closeTarget',dict(targetId=target['targetId']))['success']
            session.detach()
        # Chrome is gone before the HTTP reply is released or its SDK times out.
        assert time.monotonic()-remote['committed_at']<20
        assert not remote['release'].is_set()
        remote['release'].set();reads_before=len(remote['reads'])
        restarted_at=time.monotonic()
        with product(p,tmp_path,with_bank=True,sdk_url=url,open_popup=False) as (browser,worker,popup,restarted_id):
            assert restarted_id==identifier
            browser.route('https://api-ipay.vietinbank.vn/**',history)
            reopened=worker.evaluate(READ_ONLY_OUTBOX)
            assert reopened['outbox']['phase']=='dispatching' and reopened['outbox']['items']==pending['outbox']['items']
            reopened_delivery=dict(zip(columns,[cell[1] if cell[0]!='null' else None for cell in reopened['deliveries'][0]['row']]))
            assert reopened_delivery['state']=='attempting' and reopened_delivery['payload']==delivery['payload']
            deadline=time.monotonic()+270;complete=None
            while time.monotonic()<deadline:
                # No popup or status RPC: status itself restores wakeups. This
                # observes saved capture facts without running financial commands
                # or creating any alarm after restart.
                capture=worker.evaluate("async()=> (await chrome.storage.local.get('capture')).capture") or {}
                assert capture.get('command',{}).get('request_id')==request_id
                if capture.get('job',{}).get('delivery_state')=='complete':complete=capture;break
                assert len(remote['writes'])==1
                popup.wait_for_timeout(500)
            assert complete is not None,str(capture)
            assert complete['job']['delivery']==dict(pending=0,delivered=1,suppressed=0,uncertain=0)
            assert any(created['id'] in ids for ids in remote['reads'][reads_before:])
            assert remote['writes']==[[created]] and list(remote['transactions'])==[created['id']]
            recovered_in=time.monotonic()-restarted_at
            settled=worker.evaluate(READ_ONLY_OUTBOX)
            assert settled['outbox']['phase']=='settled' and settled['outbox']['items']==pending['outbox']['items']
            popup.goto(f'chrome-extension://{identifier}/popup.html')
            expect(popup.locator('#sync')).to_be_enabled(timeout=15000)
            next(page for page in browser.pages if page.url.startswith('https://ipay.')).bring_to_front()
            popup.locator('#sync').click();deadline=time.monotonic()+90;next_wake=0
            while time.monotonic()<deadline:
                capture=worker.evaluate("async()=> (await chrome.storage.local.get('capture')).capture") or {}
                if capture.get('command',{}).get('request_id') not in (None,request_id) and capture.get('job',{}).get('delivery_state')=='complete':break
                # Recovery already completed using the watchdog. This is a new
                # explicit capture, which may use the ordinary fast fixture pace.
                if time.monotonic()>=next_wake:
                    worker.evaluate("()=>{for(const name of ['capture','zenimport-local-delivery'])chrome.alarms.create(name,{when:Date.now()+100,periodInMinutes:.5});}")
                    next_wake=time.monotonic()+5
                popup.wait_for_timeout(250)
            else:raise AssertionError(str(capture))
            assert capture['command']['request_id']!=request_id
            assert remote['writes']==[[created]] and list(remote['transactions'])==[created['id']]

            Path('/results').mkdir(exist_ok=True)
            Path('/results/product-crash-commit.json').write_text(json.dumps(dict(
                recovery_seconds=recovered_in,original_request_id=request_id,zen_id=created['id'],
                creating_posts=len(remote['writes']),forced_worker_stop=True,reopened_outbox_phase=reopened['outbox']['phase'],delivery=complete['job']['delivery'],
                product_alarm=product_alarm,root_generation=settled['root']['activeGeneration'])))
