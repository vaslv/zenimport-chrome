"""Existing bank DOM drivers and coordinator use the real local page owner."""
import json
from pathlib import Path
import sys
import time
import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed,prepare_extension
from test_mirror import call
from test_capture import NOW
sys.path.insert(0,'/app/tests/browser')
from test_bidv import BidvBank


class VietinBank:
    def __init__(self,empty):self.calls=[];self.empty=empty
    def __call__(self,route):
        body=json.loads(route.request.post_data);self.calls.append(body)
        rows=[]
        if not self.empty and body['from']<='2026-10-09'<=body['to']:
            rows=[dict(trxId='fixture-'+str(i),currency='VND',dorC='C' if i==2 else 'D',remark='Fixture merchant',
                processDate='09-10-2026 10:12:25',amount=str(100*(i+1)),balance='9000') for i in range(3)]
        route.fulfill(content_type='application/json',body=json.dumps(dict(error=False,accountNo=body['account'],currentPage=body['page'],
            pageSize=100,totalRecords=len(rows) if body['page']==0 else 0,transactions=rows[body['page']*100:(body['page']+1)*100])))


@pytest.mark.parametrize('bank',['bidv','vietinbank'])
@pytest.mark.parametrize('empty',[False,True])
def test_existing_dom_driver_and_coordinator_commit_complete_local_capture(tmp_path,bank,empty):
    origin='https://smartbanking.bidv.com.vn' if bank=='bidv' else 'https://ipay.vietinbank.vn'
    html=Path('/app/tests/browser/'+('bidv.html' if bank=='bidv' else 'bank.html')).read_text()
    api=BidvBank(empty=empty) if bank=='bidv' else VietinBank(empty)
    path=tmp_path/'extension';prepare_extension(path,hosts=(origin+'/*',))
    bootstrap=path/'probe-worker.mjs';bootstrap.write_text(bootstrap.read_text()+"\nimport {Coordinator} from './coordinator.js';import * as bidv from './connectors/bidv/index.js';import * as vietinbank from './connectors/vietinbank/index.js';globalThis.captureFixture={Coordinator,adapters:{bidv,vietinbank}};\n")
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile',hosts=(origin+'/*',)) as (context,worker,ui,_):
        # Preserve the shared wall clock: the MAIN response timestamp and the
        # ISOLATED driver's freshness gate must not use different test clocks.
        context.route(origin+'/**',lambda r:r.fulfill(content_type='text/html',body=html))
        context.route(origin+'/w2/process' if bank=='bidv' else 'https://api-ipay.vietinbank.vn/**',api)
        page=context.new_page();page.goto(origin+('/tai-khoan' if bank=='bidv' else '/payment-history?accountNo=12345678'))
        for action in ('init','verify','refresh'):assert call(worker,action,now=NOW)['ok']
        result=worker.evaluate("""async ({bank,now})=>{
          const {Coordinator,adapters}=captureFixture;const adapter=adapters[bank];
          const [tab]=await chrome.tabs.query({url:adapter.origin});await adapter.prepare(tab.id);
          const observed=await adapter.inspect(await chrome.tabs.get(tab.id),'fixture-owner');
          const rpc=async(action,args={})=>{const r=await mirrorProbe.run(action,{name:'l6-mirror',now,...args});if(!r.ok)throw Object.assign(Error(r.code),{code:r.code});return r.result;};
          let connection=await rpc('connections-discover',{data:observed.discovery});
          for(const a of connection.accounts)await rpc('accounts-configure',{id:a.id,data:{expected_version:0,selection:'enabled',zenmoney_account_id:'a',import_start:'2026-10-01'}});
          connection=await rpc('connections-get',{id:connection.id});
          const service={capture:{start:data=>rpc('capture-start',{data}),get:id=>rpc('capture-get',{id}),lease:(id,data)=>rpc('capture-lease',{id,data}),
            page:(id,intervalId,number,data)=>rpc('capture-page',{id,intervalId,number,data}),complete:(id,intervalId,data)=>rpc('capture-complete',{id,intervalId,data}),
            pause:(id,data)=>rpc('capture-pause',{id,data}),stop:id=>rpc('capture-stop',{id})}};
          const store={get:async()=> (await chrome.storage.session.get('fixtureCoordinator')).fixtureCoordinator,
            set:async state=>chrome.storage.session.set({fixtureCoordinator:state})};
          const engine=new Coordinator({store,service,connector:()=>adapter,clock:()=>now*1000});
          globalThis.fixtureCoordinator=engine;
          chrome.runtime.onMessage.addListener((m,sender,reply)=>{
            if(!m.type?.startsWith('capture-'))return;
            (async()=>{
              if(sender.frameId!==0||sender.tab?.id!==tab.id||!adapter.supports(sender.url))throw Error('fixture_sender');
              const source={tabId:sender.tab.id,documentId:sender.documentId,account:adapter.accountFromUrl((await chrome.tabs.get(tab.id)).url)};
              if(source.account!==m.account)throw Error('fixture_account');
              if(m.type==='capture-check'){await engine.guard(m.runId,source);return {};}
              if(m.type==='capture-page')return engine.page(m.runId,source,m.data);
              if(m.type==='capture-complete'){await engine.complete(m.runId,source);return {};}
              if(m.type==='capture-next'){await engine.pump();return {};}
              if(m.type==='capture-error'){await engine.pause(m.code);return {};}
              throw Error('fixture_message');
            })().then(value=>reply({ok:true,...value}),e=>reply({ok:false,error:e.code??e.message}));return true;
          });
          await engine.start({connection,bank,tabId:tab.id});return true;
        }""",dict(bank=bank,now=NOW));assert result
        deadline=time.monotonic()+45;state=None
        while time.monotonic()<deadline:
            state=worker.evaluate("async()=> (await chrome.storage.session.get('fixtureCoordinator')).fixtureCoordinator")
            if state and state['phase'] in ('complete','failed','paused'):break
            ui.wait_for_timeout(100)
        assert state and state['phase']=='complete',state
        facts=call(worker,'capture-state')['result']
        assert len(facts['coverage'])==1 and not facts['source_capture_leases']
        assert len(facts['bank_transactions'])==(0 if empty else 4 if bank=='bidv' else 3)
        assert api.calls and 'fixture-must-not-cross-bridge' not in json.dumps(facts)
        assert not page.locator('[data-zenimport],.zenimport').count()
        assert call(worker,'export',now=NOW)['ok']
