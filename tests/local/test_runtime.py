"""Installed MV3/IndexedDB feasibility with synthetic data and offline execution."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import shutil
import subprocess
import threading
import time
import zipfile

import pytest
from playwright.sync_api import sync_playwright

RESULTS = Path('/results')
WORKER = """import * as probe from './feasibility.mjs';
import * as domain from './domain.mjs';globalThis.domain=domain;
import * as storageProbe from './storage.mjs';globalThis.storageProbe=storageProbe;
import * as authorityProbe from './authority.mjs';globalThis.authorityProbe=authorityProbe;
import * as applicationProbe from './application.mjs';globalThis.applicationProbe=applicationProbe;
import * as mirrorProbe from './mirror.mjs';globalThis.mirrorProbe=mirrorProbe;
import * as portableProbe from './portable.mjs';globalThis.portableProbe=portableProbe;
import * as migrationProbe from './migration.mjs';globalThis.migrationProbe=migrationProbe;
globalThis.probe=probe;globalThis.boot=crypto.randomUUID();
chrome.runtime.onMessage.addListener((data,sender,reply)=>{
  if(data.type==='mirror-probe'){mirrorProbe.run(data.action,data.args).then(reply);return true;}
  if(data.type==='authority-probe'){authorityProbe.run(data.action,data.args).then(reply);return true;}
  if(data.type==='storage-probe'){storageProbe.run(data.action,data.args).then(reply);return true;}
  if(data.type==='probe-wake'){reply({boot:globalThis.boot});return;}
  if(data.type==='probe-wire'){probe.exactRoundtrip('message-exact',data.raw).then(reply);return true;}
  if(data.type!=='probe-state')return;
  probe.databaseState(data.name).then(state=>reply({state,boot:globalThis.boot}));return true;
});
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
chrome.alarms.get('probe-recover').then(alarm=>{if(!alarm)chrome.alarms.create('probe-recover',{periodInMinutes:.5});});
"""


def prepare_extension(path, *, hosts=()):
    path.mkdir(parents=True,exist_ok=True)
    archive=next(Path('/app/dist').glob('zenimport-chrome-*.zip'))
    with zipfile.ZipFile(archive) as source:
        assert all('probe' not in name and 'node_modules' not in name for name in source.namelist())
        source.extractall(path)
    manifest=json.loads((path/'manifest.json').read_text())
    # Probe entry/host grants exist only in this disposable test installation.
    manifest['background']['service_worker']='probe-worker.mjs'
    manifest['host_permissions']=list(hosts)
    (path/'manifest.json').write_text(json.dumps(manifest))
    (path/'probe-worker.mjs').write_text(WORKER)
    (path/'probe.html').write_text('<!doctype html><html lang="en"><title>Isolated runtime probe</title><body>Probe</body></html>')
    shutil.copyfile('/app/.local/probes/feasibility.mjs',path/'feasibility.mjs')
    shutil.copyfile('/app/.local/probes/domain.mjs',path/'domain.mjs')
    shutil.copyfile('/app/.local/probes/storage.mjs',path/'storage.mjs')
    shutil.copyfile('/app/.local/probes/authority.mjs',path/'authority.mjs')
    shutil.copyfile('/app/.local/probes/application.mjs',path/'application.mjs')
    shutil.copyfile('/app/.local/probes/mirror.mjs',path/'mirror.mjs')
    shutil.copyfile('/app/.local/probes/portable.mjs',path/'portable.mjs')
    shutil.copyfile('/app/.local/probes/migration.mjs',path/'migration.mjs')


@contextmanager
def installed(p,path,profile, *, hosts=(),known_id=None):
    if not (path/'manifest.json').exists():prepare_extension(path,hosts=hosts)
    options={'executable_path':os.environ['CHROME_EXECUTABLE']} if os.getenv('CHROME_EXECUTABLE') else {'channel':'chromium'}
    context=p.chromium.launch_persistent_context(str(profile),headless=False,
        ignore_default_args=['--disable-extensions'],
        args=[f'--disable-extensions-except={path}',f'--load-extension={path}','--no-sandbox',
              '--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run'],**options)
    try:
        page=None
        if known_id:
            # Explicitly wake the persisted worker through a genuine extension
            # message before waiting for Playwright's worker event.
            page=context.new_page();page.goto(f'chrome-extension://{known_id}/probe.html')
            page.wait_for_function('()=>typeof globalThis.chrome?.runtime?.sendMessage==="function"')
            page.evaluate('()=>Promise.race([chrome.runtime.sendMessage({type:"probe-wake"}),new Promise((_,reject)=>setTimeout(()=>reject(Error("worker_wake_timeout")),10000))])')
        worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        identifier=worker.url.split('/')[2]
        if page is None:
            page=context.new_page();page.goto(f'chrome-extension://{identifier}/probe.html')
        # A serviceworker event exposes the target before its module graph and
        # extension bindings have necessarily finished loading. Require a real
        # message reply before allowing direct probe evaluations on cold CI hosts.
        page.wait_for_function('()=>typeof globalThis.chrome?.runtime?.sendMessage==="function"')
        ready=message(page,{'type':'probe-wake'})
        assert ready.get('boot')==worker.evaluate('globalThis.boot')
        yield context,worker,page,identifier
    finally:context.close()


@contextmanager
def fake_api():
    calls=[]
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            files={'/probe.mjs':('text/javascript',Path('/app/.local/probes/feasibility.mjs').read_bytes()),
                   '/init.mjs':('text/javascript',b'import * as probe from "/probe.mjs";globalThis.probe=probe;'),
                   '/':('text/html',b'<!doctype html><script type="module" src="/init.mjs"></script>')}
            if self.path not in files:self.send_error(404);return
            kind,body=files[self.path]
            self.send_response(200);self.send_header('Content-Type',kind);self.end_headers();self.wfile.write(body)
        def do_POST(self):
            body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            assert not body.get('transaction') and not body.get('deletion')
            assert self.headers.get('Authorization')=='Bearer fixture-local-sdk-token'
            calls.append(self.path)
            if self.path=='/slow':time.sleep(.2)
            self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers()
            raw=b'{"serverTimestamp":9007199254740993,"user":[{"id":1}],"account":[],"instrument":[],"tag":[],"transaction":[],"fixtureExact":1.00000000000000000001,"fixtureInteger":9007199254740993}'
            try:self.wfile.write(raw)
            except (BrokenPipeError,ConnectionResetError):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:yield f'http://127.0.0.1:{server.server_port}',calls
    finally:server.shutdown();server.server_close();thread.join()


def message(page,data):
    return page.evaluate('data=>Promise.race([chrome.runtime.sendMessage(data),new Promise((_,reject)=>setTimeout(()=>reject(Error("message_response_timeout")),10000))])',data)


def test_installed_sdk_storage_transactions_and_upgrades(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (context,worker,page,identifier):
        raw='{"amount":1.00000000000000000001,"id":9007199254740993}'
        result=worker.evaluate('raw=>probe.exactRoundtrip("exact",raw)',raw)
        assert result=={'wire':raw,'generation':'1'}
        assert message(page,{'type':'probe-wire','raw':raw})==result
        assert worker.evaluate('()=>probe.atomicFailure("unique")')=={'code':'ConstraintError','records':1,'receipts':0}
        assert worker.evaluate('()=>probe.atomicFailure("quota-injected",true)')=={'code':'QuotaExceededError','records':1,'receipts':0}
        assert worker.evaluate('()=>probe.upgradeProbe("upgrade")')=={'failed':False,'priorClosed':True,'value':'yes','version':2}
        assert worker.evaluate('()=>probe.upgradeProbe("upgrade-failed",true)')=={'failed':True,'priorClosed':True,'value':'yes','version':1}


def test_real_idb_quota_abort_on_bounded_web_origin():
    # Chrome ignores DevTools quota overrides for extension origins. Exercise the
    # same bundled repository on a bounded native web origin; extension disk
    # exhaustion is separately injected above, without claiming native evidence.
    with fake_api() as (url,_),sync_playwright() as p:
        options={'executable_path':os.environ['CHROME_EXECUTABLE']} if os.getenv('CHROME_EXECUTABLE') else {'channel':'chromium'}
        browser=p.chromium.launch(headless=False,args=['--no-sandbox','--disable-background-networking'],**options)
        try:
            page=browser.new_page();page.goto(url);page.wait_for_function('()=>!!globalThis.probe')
            page.evaluate('()=>probe.databaseState("quota-native")')
            session=page.context.new_cdp_session(page)
            session.send('Storage.overrideQuotaForOrigin',{'origin':url,'quotaSize':1})
            result=page.evaluate('()=>probe.nativeQuotaWrite("quota-native",4*1024*1024)')
            assert result['code'] in ('QuotaExceededError','AbortError')
            assert result['records']==result['receipts']==0
            session.send('Storage.overrideQuotaForOrigin',{'origin':url})
            assert page.evaluate('()=>probe.nativeQuotaWrite("quota-native",4*1024*1024)')=={'code':'','records':1,'receipts':1}
        finally:browser.close()


def test_worker_termination_and_complete_browser_restart_preserve_state(tmp_path):
    extension,profile=tmp_path/'extension',tmp_path/'profile'
    with sync_playwright() as p:
        with installed(p,extension,profile) as (context,worker,page,identifier):
            worker.evaluate('()=>probe.exactRoundtrip("restart",\'{"id":9007199254740993}\')')
            before=worker.evaluate('boot')
            worker.evaluate('chrome.alarms.clear("probe-recover")')
            session=context.browser.new_browser_cdp_session()
            target=next(t for t in session.send('Target.getTargets')['targetInfos'] if t['type']=='service_worker' and identifier in t['url'])
            assert session.send('Target.closeTarget',{'targetId':target['targetId']})['success']
            result=message(page,{'type':'probe-state','name':'restart'})
            assert result['boot']!=before and result['state']['records']==1 and result['state']['generation']=='1'
            page.wait_for_function('async()=>!!(await chrome.alarms.get("probe-recover"))')
        with installed(p,extension,profile,known_id=identifier) as (_,worker,page,_):
            result=message(page,{'type':'probe-state','name':'restart'})
            assert result['state']=={'records':1,'receipts':0,'generation':'1'}


def native_decision(page,allow):
    page.wait_for_timeout(600)
    if allow:
        subprocess.run(['xdotool','key','Tab'],check=True)
        subprocess.run(['xdotool','key','Return'],check=True)
    else:subprocess.run(['xdotool','key','Escape'],check=True)
    page.wait_for_timeout(250)


def test_trusted_storage_is_unavailable_to_bank_content_context(tmp_path):
    with fake_api() as (url,_),sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile',hosts=['http://127.0.0.1/*']) as (context,worker,_,_):
        worker.evaluate('async()=>{await chrome.storage.local.setAccessLevel({accessLevel:"TRUSTED_CONTEXTS"});await chrome.storage.session.setAccessLevel({accessLevel:"TRUSTED_CONTEXTS"});await chrome.storage.local.set({fixtureSecret:"synthetic"});await chrome.storage.session.set({fixtureSecret:"synthetic"});}')
        bank=context.new_page();bank.goto(url)
        result=worker.evaluate('''async()=>{const [tab]=await chrome.tabs.query({url:"http://127.0.0.1/*"});
          const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:async()=>{
            const result={};for(const area of ["local","session"]){
              try{await chrome.storage[area].get("fixtureSecret");result[area]="exposed";}
              catch{result[area]="blocked";}
            }return result;
          }});return result.result;}''')
        assert result=={'local':'blocked','session':'blocked'}


def test_native_optional_host_permission_denied_granted_revoked_and_sdk_timeout(tmp_path):
    with fake_api() as (url,calls),sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,page,_):
        origin='http://127.0.0.1/*'
        assert worker.evaluate('()=>chrome.permissions.contains({permissions:["unlimitedStorage"]})')
        args={'token':'fixture-local-sdk-token','endpoint':url+'/sdk'}
        denied=worker.evaluate('a=>probe.readProbe(a.token,a.endpoint)',args)
        assert not denied['ok'] and calls==[]
        page.evaluate("""origin=>{const b=document.createElement('button');b.id='permission';b.textContent='Permission';
          b.onclick=async()=>{try{globalThis.requested={origins:[origin]};globalThis.allowed=await chrome.permissions.request(globalThis.requested);}
          catch(e){globalThis.allowed='error';globalThis.permissionError=e.message;}};document.body.append(b);}""",origin)
        page.locator('#permission').click();native_decision(page,False)
        decision=page.evaluate('()=>({allowed:globalThis.allowed,error:globalThis.permissionError,requested:globalThis.requested,manifest:chrome.runtime.getManifest()})')
        assert decision['allowed'] is False,decision
        page.locator('#permission').click();native_decision(page,True)
        page.wait_for_function('()=>globalThis.allowed===true')
        result=worker.evaluate('a=>probe.readProbe(a.token,a.endpoint)',args)
        assert result=={'ok':True,'calls':1,'owners':['1'],'cursor':'9007199254740993','exact':'1.00000000000000000001','integer':'9007199254740993'}
        timeout=worker.evaluate('a=>probe.readProbe(a.token,a.endpoint,40)',args|{'endpoint':url+'/slow'})
        assert not timeout['ok'] and timeout['calls']==1 and timeout['code']=='timeout'
        assert worker.evaluate('origin=>chrome.permissions.remove({origins:[origin]})',origin)
        after=worker.evaluate('a=>probe.readProbe(a.token,a.endpoint)',args)
        assert not after['ok'] and calls==['/sdk','/slow']


def test_large_history_bounded_chunks_and_resource_record(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (context,worker,_,_):
        measurements=[]
        for size,payload in [(1000,256),(10000,256),(100000,2048)]:
            result=worker.evaluate('a=>probe.bulkSeed(a.name,a.size,a.payload)',{'name':f'bulk-{size}','size':size,'payload':payload})
            assert result['records']==size and result['maxChunkMs']<10000
            measurements.append(result)
        peak=Path('/sys/fs/cgroup/memory.peak')
        assert peak.is_file(),'Docker cgroup memory evidence is required'
        evidence={'browser':context.browser.version,'architecture':os.uname().machine,
                  'container_peak_bytes':int(peak.read_text()),'measurements':measurements}
        if RESULTS.is_dir():
            name='chrome'+context.browser.version.split('.')[0] if os.getenv('CHROME_EXECUTABLE') else 'current'
            (RESULTS/f'local-runtime-{name}.json').write_text(json.dumps(evidence,indent=2))
