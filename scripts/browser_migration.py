"""Explicit Docker acceptance of the built MV3 artifact, not a production tool.

Default/fake mode has no external network. --live uses only a historically
pinned test identity, mounted read-only. Durable seed intents are never resent.
Bank HTML/API are always synthetic; Chromium, popup, permissions, TLS, backend,
SQLite and SDK are real. No production paths or endpoints are accepted.
"""
import argparse
from collections import defaultdict
from contextlib import contextmanager, closing
from copy import deepcopy
from datetime import datetime, timedelta
from decimal import Decimal
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import ssl
import subprocess
import threading
import time
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx
import uvicorn
from playwright.sync_api import sync_playwright, expect
from zenmoney_api import Client, entities, transactions as tx
from zenmoney_api.protocol import decode_json, encode_json
from backend.app import create_app
from backend.config import Settings
from backend import storage
from migration_history import AuditedTransport, write_stage, ledger, originals_unchanged
import migration_lab as lab
from support import BANK, ORIGIN, PopupBackend
from test_integration import pump_until, state


def command(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def certificate(directory, name, *, trusted):
    """Trust one private CA in this disposable container's NSS DB only."""
    root=directory/name
    if root.exists():
        if trusted:trust_certificate(directory,root)
        return root
    root.mkdir()
    command('openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(root/'ca.key'),
        '-out',str(root/'ca.crt'),'-days','2','-subj','/CN=ZenImport disposable acceptance CA')
    command('openssl','req','-newkey','rsa:2048','-nodes','-keyout',str(root/'server.key'),
        '-out',str(root/'server.csr'),'-subj','/CN=localhost')
    (root/'extensions').write_text('subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n')
    command('openssl','x509','-req','-in',str(root/'server.csr'),'-CA',str(root/'ca.crt'),
        '-CAkey',str(root/'ca.key'),'-CAcreateserial','-out',str(root/'server.crt'),
        '-days','2','-extfile',str(root/'extensions'))
    if trusted:trust_certificate(directory,root)
    return root


def trust_certificate(directory,root):
    nss=Path.home()/'.pki/nssdb';nss.mkdir(parents=True,exist_ok=True)
    if not (nss/'cert9.db').exists():command('certutil','-N','--empty-password','-d','sql:'+str(nss))
    command('certutil','-A','-d','sql:'+str(nss),'-n','ZenImport acceptance '+directory.name,
        '-t','C,,','-i',str(root/'ca.crt'))


@contextmanager
def endpoint(service, certificate=None):
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            service.hits+=1
            authorized=self.headers.get('Authorization')=='Bearer '+service.token
            self.send_response(200 if authorized else 401);self.send_header('Content-Type','application/json');self.end_headers()
            self.wfile.write(json.dumps({'api_version':1} if authorized else {'error':{'code':'unauthorized'}}).encode())
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    if certificate:
        context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certificate/'server.crt',certificate/'server.key')
        server.socket=context.wrap_socket(server.socket,server_side=True)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:yield ('https://localhost:' if certificate else 'http://127.0.0.1:')+str(server.server_port)
    finally:server.shutdown();server.server_close();thread.join()


def permissions(worker):return worker.evaluate('chrome.permissions.getAll()')['origins']
def config(worker):return worker.evaluate("async()=> (await chrome.storage.local.get('config')).config || null")


def native_decision(popup, *, allow, screenshot=None):
    # The real Chrome Views dialog has Deny focused by default. Fixed Xvfb
    # display, English Chromium; Tab focuses Allow. No permissions API mock.
    popup.wait_for_timeout(600)
    if screenshot:command('scrot',str(screenshot))
    if allow:command('xdotool','key','Tab')
    command('xdotool','key','Return')
    popup.wait_for_timeout(250)


def connect(popup, bank, worker, url, token, *, allow=True, screenshot=None):
    popup.locator('#connection-settings').evaluate('(e)=>e.open=true')
    popup.locator('#url').fill(url);popup.locator('#token').fill(token)
    origin=url+'/*';had=worker.evaluate('(origin)=>chrome.permissions.contains({origins:[origin]})',origin)
    bank.bring_to_front();popup.locator('#connect').click()
    if not had:native_decision(popup,allow=allow,screenshot=screenshot)
    expect(popup.locator('#connect')).to_be_enabled(timeout=30000)


@contextmanager
def browser(playwright, directory, bank_api):
    artifact=Path('/app/dist/extension')
    expected={str(p.relative_to(artifact)):hashlib.sha256(p.read_bytes()).hexdigest() for p in artifact.rglob('*') if p.is_file()}
    context=playwright.chromium.launch_persistent_context(str(directory/'profile'),channel='chromium',headless=False,
        args=[f'--disable-extensions-except={artifact}',f'--load-extension={artifact}','--no-sandbox'],
        viewport={'width':1100,'height':850})
    try:
        context.route(ORIGIN+'/**',lambda route:route.fulfill(content_type='text/html',body=BANK))
        context.route('https://api-ipay.vietinbank.vn/**',bank_api)
        worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        identifier=worker.url.split('/')[2]
        bank=context.new_page();bank.goto(ORIGIN+'/payment-history?accountNo=12345678')
        popup=context.new_page();popup.goto(f'chrome-extension://{identifier}/popup.html')
        assert permissions(worker)==[]
        # An extension-page test tab does not receive toolbar activeTab. Grant
        # just the synthetic bank via an explicit, trusted test-page gesture.
        # Server permission below is requested by the shipped Connect handler.
        popup.evaluate("""()=>{const b=document.createElement('button');b.id='test-bank-permission';b.textContent='Test bank permission';b.onclick=()=>chrome.permissions.request({origins:['https://ipay.vietinbank.vn/*']});document.body.append(b);} """)
        popup.locator('#test-bank-permission').click();native_decision(popup,allow=True)
        popup.locator('#test-bank-permission').evaluate('(e)=>e.remove()')
        assert permissions(worker)==[ORIGIN+'/*']
        bank.bring_to_front()
        yield context,worker,bank,popup
    finally:
        context.close()
        assert expected=={str(p.relative_to(artifact)):hashlib.sha256(p.read_bytes()).hexdigest() for p in artifact.rglob('*') if p.is_file()}


class PageBank:
    def __init__(self):self.plan=None;self.later=False;self.calls=[];self.headers=[]
    def __call__(self,route):
        body=json.loads(route.request.post_data);self.calls.append(body)
        self.headers.append(dict(route.request.headers))
        rows=[r for r in self.plan['bank'] if r['source']==body['account'] and (self.later or r['phase']=='initial')
            and body['from']<=r['date']<=body['to']]
        raw=[r['raw'] for r in rows];page=body['page']
        route.fulfill(content_type='application/json',body=json.dumps({'error':False,'accountNo':body['account'],
            'currentPage':page,'pageSize':100,'totalRecords':len(raw) if page==0 else 0,'transactions':raw[page*100:(page+1)*100]}))


class Acceptance:
    def __init__(self, directory, live):
        self.directory=directory;self.live=live;self.path=directory/'journal.json';self.bank_api=PageBank()
        if live:
            self.identity=json.loads(Path('/run/secrets/identity.json').read_text())
            self.token=lab.read_env('/run/secrets/test-token.env').get('ZENMONEY_TEST_TOKEN','')
            lab.validate_source(self.identity,self.token,self.identity['run'])
            self.remote=None
        else:
            from delivery_factory import FakeZenMoney
            self.remote=FakeZenMoney(directory/'unused.sqlite3')
            self.remote.data['account']=[{'id':str(uuid4()),'user':1,'instrument':2,'type':'debt','title':'Fixture debt','balance':0}]
            self.token='fixture-test-token-never-real'
            self.identity={'run':str(uuid4()),'expected_user':1}
        self.api=self.client(directory/'seed-audit.jsonl')
        data=self.read()
        if self.path.exists():
            self.journal=decode_json(self.path.read_bytes())
            assert self.journal['user']==self.identity['expected_user'] and self.journal['run']==self.identity['run']
        else:
            self.journal=self.plan(data);lab.save(self.path,self.journal)
        self.check_baseline(data)

    def client(self,audit):
        transport=httpx.MockTransport(self.remote.handle) if self.remote else None
        return Client(self.token,transport=AuditedTransport(audit,transport=transport))

    def read(self):
        data=self.api.read_diff()
        if self.live:lab.validate_identity(data,self.identity,self.token,self.identity['run'])
        else:assert data['user'][0]['id']==1
        return data

    def plan(self,data):
        user=self.identity['expected_user'];run=self.identity['run'];prefix='ZenImport CHROME '+uuid4().hex[:8]
        instrument=next(x['id'] for x in data['instrument'] if x.get('shortTitle')=='VND')
        debt=next(x['id'] for x in data['account'] if x.get('type')=='debt')
        tags=[entities.tag(user=user,title=prefix+' '+s,showIncome=i,budgetIncome=i,showOutcome=not i,budgetOutcome=not i) for s,i in [('Expense',False),('Income',True)]]
        journal={'run':run,'user':user,'stages':{},'baseline':{k:data[k] for k in ('account','tag','merchant','transaction')},
            'debt_account':debt,'variants':{},'catalog':{'account':[],'tag':tags},'completed':{}}
        day=(datetime.now(ZoneInfo('Asia/Ho_Chi_Minh')).date()-timedelta(days=3)).isoformat()
        for case in ('copied','empty'):
            accounts=[entities.account(user=user,title=prefix+' '+case+' '+str(i),instrument=instrument) for i in range(2)]
            journal['catalog']['account'].extend(accounts)
            plan={'accounts':accounts,'seed':[],'bank':[],'created':{},'import_start':day,'api_tokens':{k:secrets.token_urlsafe(32) for k in ('a','b')}}
            def add(amount,source='12345678',phase='initial',kind=None,known=False):
                serial=len(plan['bank'])+1
                raw={'trxId':prefix.replace(' ','')+'-'+case+'-'+str(serial),'currency':'VND','dorC':'C' if amount>0 else 'D',
                    'remark':prefix+' '+case+' '+str(serial),'processDate':datetime.fromisoformat(day).strftime('%d-%m-%Y')+f' 10:{serial:02d}:25',
                    'amount':str(abs(amount)),'balance':'9000','corresponsiveAccount':'known-shop' if known else 'shop-'+str(serial),
                    'corresponsiveName':'Known shop' if known else 'Fixture person'}
                target=accounts[0 if source=='12345678' else 1]
                plan['bank'].append({'source':source,'date':day,'amount':amount,'target':target['id'],'raw':raw,'phase':phase,'seed_kind':kind})
                if kind:
                    common={'user':user,'date':day,'now':int(datetime.fromisoformat(day+f'T10:{serial:02d}:25+07:00').timestamp()),'viewed':True,'comment':raw['remark'],'payee':raw['corresponsiveName']}
                    if kind=='transfer':
                        row=tx.transfer(from_account=accounts[0]['id'],to_account=accounts[1]['id'],from_instrument=instrument,to_instrument=instrument,amount_out=abs(amount),amount_in=abs(amount),**common)
                    elif kind=='debt':row=tx.debt(action='lend',account=target['id'],debt_account=debt,instrument=instrument,amount=abs(amount),**common)
                    else:
                        builder=tx.income if amount>0 else tx.expense
                        row=builder(account=target['id'],instrument=instrument,amount=abs(amount),categories=[tags[amount>0]['id']],**common)
                    plan['seed'].append(row)
            for amount in (-1001,-1003,-1007):add(amount,kind='expense',known=True)
            add(2003,kind='income');add(-607,kind='expense');add(-607,kind='expense')
            add(-1103,kind='transfer');add(1103,source='87654321')
            # This positive bank leg belongs to the seeded transfer, not a new entry.
            plan['bank'][-1]['seed_kind']='transfer-side'
            add(-161,kind='debt');add(-1709,known=True);add(1907,source='87654321')
            add(-2011,phase='later',known=True)
            journal['variants'][case]=plan
        return journal

    def check_baseline(self,data):
        assert originals_unchanged(data,self.journal),'Preexisting test data changed'

    def seed(self):
        if self.remote:
            self.remote.data['account'].extend(deepcopy(self.journal['catalog']['account']))
            self.remote.data['tag'].extend(deepcopy(self.journal['catalog']['tag']))
            for plan in self.journal['variants'].values():
                self.remote.transactions.update({r['id']:deepcopy(r) for r in plan['seed']})
        else:
            write_stage(self.api,self.path,self.journal,'browser-catalog',self.journal['catalog'])
            for case,plan in self.journal['variants'].items():write_stage(self.api,self.path,self.journal,'browser-seed-'+case,{'transaction':plan['seed']})

    @contextmanager
    def serve(self, path, token, cert=None):
        # Every server start rechecks the pinned remote identity before any worker.
        self.read()
        path.parent.mkdir(parents=True,exist_ok=True)
        if self.remote:self.remote.path=path
        app=create_app(Settings(path,token,self.token),client_factory=lambda _:self.client(path.parent/'sdk-audit.jsonl'))
        sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        options={'ssl_certfile':str(cert/'server.crt'),'ssl_keyfile':str(cert/'server.key')} if cert else {}
        server=uvicorn.Server(uvicorn.Config(app,log_level='critical',timeout_graceful_shutdown=15,**options))
        thread=threading.Thread(target=lambda:server.run(sockets=[sock]),daemon=True);thread.start()
        deadline=time.monotonic()+15
        while not server.started and time.monotonic()<deadline:time.sleep(.02)
        assert server.started
        url=('https://localhost:' if cert else 'http://127.0.0.1:')+str(port)
        try:
            # This fixture represents one known login with two accounts. A page
            # showing a single account cannot establish that membership itself;
            # never weaken automatic login isolation to satisfy this scenario.
            payload={'bank':'vietinbank','profile_key':'fixture-shared-login','profile_identity':'user_selected',
                'connector_version':'1.0.0','capabilities':{'timezone':'Asia/Ho_Chi_Minh','currencies':['VND'],
                    'max_window_days':30,'earliest_date':None,'details':'included'},'accounts_complete':True,
                'accounts':[{'source_key':source,'identity_scope':'bank','label':'Fixture '+source,
                    'masked_number':'••'+source[-4:],'currency':'VND','scale':0,'supported':True}
                    for source in ('12345678','87654321')]}
            with httpx.Client(verify=ssl.create_default_context(cafile=str(cert/'ca.crt')) if cert else True) as client:
                response=client.post(url+'/api/v1/connections/discover',headers={'Authorization':'Bearer '+token},json=payload)
                assert response.status_code==200,response.status_code
            yield url,app
        finally:server.should_exit=True;thread.join(60);assert not thread.is_alive()

    def audit(self,path):
        return [identifier for line in path.read_bytes().splitlines() for identifier in decode_json(line)['entities'].get('transaction',[])] if path.exists() else []

    def capture(self, label, path, popup, bank, worker, expected):
        # The one-shot run marker prevents blind retries after interruption.
        if label in self.journal['completed']:raise RuntimeError('Stage already complete; use a new acceptance directory')
        audit=path.parent/'sdk-audit.jsonl';before=len(self.audit(audit))
        previous=(state(worker) or {}).get('command',{}).get('request_id')
        # Worker completion precedes the popup's next 1.5-second poll. Wait for
        # the actual Sync button, otherwise the click can mean Stop old capture.
        expect(popup.locator('#sync')).to_have_text('Synchronize',timeout=10000)
        expect(popup.locator('#sync')).to_be_enabled()
        bank.bring_to_front();popup.locator('#sync').click()
        pump_until(popup,worker,lambda:(state(worker) or {}).get('command',{}).get('request_id') not in (None,previous),timeout=60)
        pump_until(popup,worker,lambda:(state(worker) or {}).get('phase')=='complete',timeout=90)
        pump_until(popup,worker,lambda:(state(worker) or {}).get('job',{}).get('delivery_state')=='complete',timeout=120)
        sent=self.audit(audit)[before:]
        assert len(sent)==expected and len(set(sent))==expected,(label,len(sent),expected)
        with closing(storage.connect_readonly(path)) as db:
            storage.check_integrity(db)
            assert db.execute('SELECT count(*) FROM bank_accounts').fetchone()[0]==2
            plan=self.bank_api.plan
            for raw,zen in db.execute('SELECT b.external_id,d.zen_id FROM bank_transactions b JOIN deliveries d ON b.id=d.bank_id'):
                if raw in plan['created']:assert plan['created'][raw]==zen,'Changed delivery UUID'
                plan['created'][raw]=zen
        assert not bank.locator('[id*=zenimport], [class*=zenimport]').count()
        # Credentials never enter the page or the bank's captured requests.
        page_text=bank.content()
        for secret in [self.token,*self.bank_api.plan['api_tokens'].values()]:
            assert secret not in page_text and secret not in json.dumps(self.bank_api.headers)
        result={'stage':label,'created':len(sent),'capture':'complete','delivery':'complete'}
        self.journal['completed'][label]=result;lab.save(self.path,self.journal)
        print(json.dumps(result),flush=True)

    def verify(self,case,*,later=True):
        plan=self.journal['variants'][case];data=self.read();self.check_baseline(data)
        records=[r for r in plan['bank'] if later or r['phase']=='initial']
        targets={a['id'] for a in plan['accounts']}
        rows=[r for r in data['transaction'] if not r.get('deleted') and targets.intersection((r.get('incomeAccount'),r.get('outcomeAccount')))]
        expected_ids={r['id'] for r in plan['seed']}|set(plan['created'].values())
        assert {r['id'] for r in rows}==expected_ids,'Missing or duplicated remote IDs'
        originals={r['id']:r for r in rows}
        for row in plan['seed']:
            assert all(originals[row['id']].get(k)==row.get(k) for k in ('date','income','outcome','incomeAccount','outcomeAccount','tag','viewed'))
        for identifier in plan['created'].values():assert originals[identifier]['viewed'] is False
        known=[r for r in records if r['amount'] in (-1709,-2011)]
        for r in known:
            identifier=plan['created']['vib:id:'+r['raw']['trxId']]
            assert originals[identifier]['tag']==[self.journal['catalog']['tag'][0]['id']]
        gross=ledger(rows,targets);daily=defaultdict(Decimal);expected_daily=defaultdict(Decimal)
        for (day,target,_,side),amount in gross.items():daily[day,target]+=amount*(1 if side=='income' else -1)
        for row in records:expected_daily[row['date'],row['target']]+=Decimal(row['amount'])
        assert {k:v for k,v in daily.items() if v}=={k:v for k,v in expected_daily.items() if v}
        net={target:sum(v for (_,account),v in daily.items() if account==target) for target in targets}
        for target in targets:
            assert net[target]==sum(Decimal(r['amount']) for r in records if r['target']==target)
            if self.live:assert Decimal(next(a['balance'] for a in data['account'] if a['id']==target))==net[target]
        return {'case':case,'bank_records':len(records),'remote_active':len(rows),'new_ids':len(plan['created']),
            'exact_ids':True,'balances':self.live,'daily_net':True,'categories_unread':True,'baseline_preserved':True}


def settings(popup, bank, plan, *, copied=False):
    for source,target in zip(('12345678','87654321'),plan['accounts']):
        bank.goto(ORIGIN+'/payment-history?accountNo='+source);bank.bring_to_front()
        popup.locator('#account-settings').evaluate('(e)=>e.open=true');popup.locator('#refresh-accounts').click()
        expect(popup.locator('.account').filter(has_text=source)).to_have_count(1)
        if copied:continue
        form=popup.locator('.account').filter(has_text=source)
        form.locator('select').select_option(target['id']);form.locator('input[type=date]').fill(plan['import_start'])
        form.get_by_role('button',name='Save account',exact=True).click()
        expect(popup.locator('#status')).to_contain_text('Account saved')
    bank.goto(ORIGIN+'/payment-history?accountNo=12345678');bank.bring_to_front()
    popup.locator('#account-settings').evaluate('(e)=>e.open=true');popup.locator('#refresh-accounts').click()
    expect(popup.locator('#sync')).to_be_enabled()
    popup.locator('#history-settings').evaluate('(e)=>e.open=true');popup.locator('#reimport').fill(plan['import_start'])


def security(directory,context,worker,bank,popup,trusted,untrusted):
    probe=PopupBackend();probe.hits=0;probe.token=secrets.token_urlsafe(32)
    old=config(worker)
    with endpoint(probe,trusted) as url:
        connect(popup,bank,worker,url,probe.token,allow=False,screenshot=directory/'permission-denied.png')
        assert probe.hits==0 and config(worker)==old
        assert url+'/*' not in permissions(worker)
        connect(popup,bank,worker,url,'incorrect-token',screenshot=directory/'permission-allow.png')
        expect(popup.locator('#status')).to_contain_text('Check the server token')
        assert probe.hits==1 and config(worker)==old
        # A valid chain with the wrong hostname must still fail.
        before=probe.hits
        connect(popup,bank,worker,url.replace('localhost','127.0.0.1'),probe.token)
        expect(popup.locator('#status')).to_contain_text('Cannot reach')
        assert probe.hits==before and config(worker)==old
    with endpoint(probe,untrusted) as url:
        before=probe.hits;connect(popup,bank,worker,url,probe.token)
        expect(popup.locator('#status')).to_contain_text('Cannot reach')
        assert probe.hits==before and config(worker)==old
    assert 'https://*/*' not in permissions(worker)
    return dict(native_permission_denied=True,native_permission_allowed=True,wrong_token_rejected=True,
        hostname_mismatch_rejected=True,untrusted_certificate_rejected=True,previous_config_preserved=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    mode=parser.add_mutually_exclusive_group(required=True);mode.add_argument('--fake',action='store_true');mode.add_argument('--live',action='store_true')
    parser.add_argument('--state',type=Path,default=Path('/state'))
    parser.add_argument('--resume-verified-prefix',action='store_true',help='Explicit recovery after copied case and optionally verified empty A; never a partial financial job')
    args=parser.parse_args()
    # No arbitrary server/DB options: only the isolated mount is accepted.
    assert args.state==Path('/state')
    os.umask(0o077);directory=args.state;directory.mkdir(exist_ok=True)
    with (directory/'.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if args.resume_verified_prefix:
            assert args.live and (directory/'run-started').exists() and not (directory/'empty/b').exists()
            acceptance=Acceptance(directory,True)
            wanted={'copied-'+s for s in ('a-initial','a-repeat','b-initial','b-repeat','b-new','b-new-repeat')}
            finished=set(acceptance.journal['completed'])
            assert finished in (wanted,wanted|{'empty-a-initial'},wanted|{'empty-a-initial','empty-a-repeat'})
            assert set(acceptance.journal['stages'])=={'browser-catalog','browser-seed-copied','browser-seed-empty'}
            assert all(s['state']=='verified' for s in acceptance.journal['stages'].values())
            with closing(storage.connect_readonly(directory/'copied/b/db.sqlite3')) as db:
                storage.check_integrity(db)
                assert db.execute("SELECT count(*) FROM bank_processing WHERE state!='delivered'").fetchone()[0]==0
            results=[acceptance.verify('copied')]
            assert len(acceptance.audit(directory/'copied/a/sdk-audit.jsonl'))==2
            assert len(acceptance.audit(directory/'copied/b/sdk-audit.jsonl'))==1
            if 'empty-a-initial' in finished:
                with closing(storage.connect_readonly(directory/'empty/a/db.sqlite3')) as db:
                    storage.check_integrity(db)
                    assert db.execute("SELECT count(*) FROM bank_processing WHERE state!='delivered'").fetchone()[0]==0
                    assert db.execute("SELECT count(*) FROM capture_jobs WHERE capture_state!='complete' OR delivery_state!='complete'").fetchone()[0]==0
                assert len(acceptance.audit(directory/'empty/a/sdk-audit.jsonl'))==2
                acceptance.verify('empty',later=False)
            else:assert not (directory/'empty').exists()
            (directory/('resume-verified-'+str(len(finished)))).touch(exist_ok=False)
        else:
            if (directory/'run-started').exists():raise RuntimeError('One-shot acceptance: inspect prior result before creating a new directory')
            (directory/'run-started').touch()
            acceptance=Acceptance(directory,args.live);acceptance.seed();results=[]
        trusted=certificate(directory,'trusted',trusted=True);untrusted=certificate(directory,'untrusted',trusted=False)
        checks=None
        with sync_playwright() as p:
            for case,plan in acceptance.journal['variants'].items():
                if args.resume_verified_prefix and case=='copied':continue
                case_directory=directory/case;case_directory.mkdir(exist_ok=True)
                profile_directory=case_directory/('resume-'+str(len(finished)) if args.resume_verified_prefix else 'browser')
                profile_directory.mkdir()
                with browser(p,profile_directory,acceptance.bank_api) as (context,worker,bank,popup):
                    version=context.browser.version
                    acceptance.bank_api.plan=plan;acceptance.bank_api.later=False
                    a=case_directory/'a/db.sqlite3';b=case_directory/'b/db.sqlite3'
                    with acceptance.serve(a,plan['api_tokens']['a']) as (url_a,app):
                        connect(popup,bank,worker,url_a,plan['api_tokens']['a'])
                        settings(popup,bank,plan,copied=case+'-a-initial' in acceptance.journal['completed'])
                        if case+'-a-initial' not in acceptance.journal['completed']:
                            acceptance.capture(case+'-a-initial',a,popup,bank,worker,2)
                        if case+'-a-repeat' not in acceptance.journal['completed']:
                            acceptance.capture(case+'-a-repeat',a,popup,bank,worker,0)
                        before_a=len(acceptance.audit(a.parent/'sdk-audit.jsonl'))
                    if case=='copied':
                        b.parent.mkdir(parents=True)
                        with closing(sqlite3.connect(a)) as source, closing(sqlite3.connect(b)) as target:source.backup(target)
                    with acceptance.serve(b,plan['api_tokens']['b'],trusted) as (url_b,app):
                        if checks is None:checks=security(directory,context,worker,bank,popup,trusted,untrusted)
                        connect(popup,bank,worker,url_b,plan['api_tokens']['b'])
                        assert config(worker)['url']==url_b
                        assert state(worker) is None,'Old capture leaked across servers'
                        assert popup.locator('#last-sync').is_hidden(),'Old server timestamp leaked'
                        settings(popup,bank,plan,copied=case=='copied')
                        acceptance.capture(case+'-b-initial',b,popup,bank,worker,0)
                        acceptance.capture(case+'-b-repeat',b,popup,bank,worker,0)
                        acceptance.bank_api.later=True
                        acceptance.capture(case+'-b-new',b,popup,bank,worker,1)
                        acceptance.capture(case+'-b-new-repeat',b,popup,bank,worker,0)
                        results.append(acceptance.verify(case))
                        assert len(acceptance.audit(a.parent/'sdk-audit.jsonl'))==before_a,'Old server received writes'
                        assert 'https://*/*' not in permissions(worker)
                        popup.screenshot(path=str(directory/('popup-'+case+'.png')),full_page=True)
                        # Finish this independent browser case before stopping B:
                        # release HTTPS keep-alive/speculative TLS connections.
                        # The same profile was used for both A and B in the case.
                        context.close()
            summary={'mode':'live-test-account' if args.live else 'offline-fixture','chromium':version,
                'extension_version':json.loads(Path('/app/dist/extension/manifest.json').read_text())['version'],
                'artifact_unchanged':True,'certificate_checks_enabled':True,'security':checks,'variants':results,
                'jobs':list(acceptance.journal['completed'].values()),'bank':'synthetic-only','production_access':False,
                'resumed_verified_copied_case':args.resume_verified_prefix}
            lab.save(directory/'results.json',summary)
            print(encode_json(summary).decode(),flush=True)
        acceptance.api.close()


if __name__=='__main__':main()
