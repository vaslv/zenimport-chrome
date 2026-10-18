"""Synthetic BIDV DOM/network; real installed MV3, with no external network."""
import json
from pathlib import Path
import time

from playwright.sync_api import sync_playwright, expect
from support import TOKEN, PopupBackend, http_server, installed, connect

ORIGIN='https://smartbanking.bidv.com.vn'
HTML=Path(__file__).with_name('bidv.html').read_text()


class BidvBank:
    def __init__(self,count=4,empty=False,corrupt=False,stale=False):
        self.count=count;self.empty=empty;self.corrupt=corrupt;self.stale=stale;self.calls=[]

    def __call__(self,route):
        body=json.loads(route.request.post_data);self.calls.append(body)
        rows=[]
        if not self.empty and body['period']['start']<='2026-10-09'<=body['period']['end']:
            for i in range(self.count):
                rows.append({'date':'09/10/2026 10:12:25','remark':'Fixture merchant','amount':'-9,900 VND' if i==0 else '-100,000 VND',
                    'balance':f'{900000-i*100000:,} VND','reference':'shared-reference'})
        if self.corrupt and rows:rows[1]=rows[0].copy()
        offset=body['page']*20
        route.fulfill(content_type='application/json',body=json.dumps({'rows':rows[offset:offset+20],'more':offset+20<len(rows),'stale':self.stale and body['period']['start']!='2025-10-16'}))


def bidv_install(p,url,bank):
    return installed(p,url,bank,bank_origin=ORIGIN,bank_html=HTML,bank_url=ORIGIN+'/tai-khoan')


def test_bidv_popup_discovery_and_real_dom_driver_empty_and_full():
    # Driver RPC replies isolate collection from delivery in this browser check.
    for empty in (False,True):
        service=PopupBackend();bank_api=BidvBank(empty=empty)
        with http_server(service) as url,sync_playwright() as p,bidv_install(p,url,bank_api) as (context,worker,bank,popup,identifier):
            connect(popup,bank,url);expect(popup.locator('#bank')).to_have_text('BIDV')
            expect(popup.locator('.account')).to_have_count(1)
            assert any(c[2] and c[2].get('bank')=='bidv' for c in service.calls)
            # Use the actual connector and driver, replacing only the backend RPC
            # with a synthetic isolated-world ACK. No production configuration.
            bank.goto(ORIGIN+'/tai-khoan/thanh-toan/12345678'+('?clickMenu' if empty else ''))
            result=popup.evaluate("""async () => {
              const adapter=await import('./connectors/bidv/index.js');const [tab]=await chrome.tabs.query({url:'https://smartbanking.bidv.com.vn/*'});
              await adapter.prepare(tab.id);await adapter.selectAccount(tab.id,'12345678');
              return (await adapter.inspect(await chrome.tabs.get(tab.id),'fixture')).documentId;
            }""")
            popup.evaluate("""async documentId=>{
              const [tab]=await chrome.tabs.query({url:'https://smartbanking.bidv.com.vn/*'});
              await chrome.scripting.executeScript({target:{tabId:tab.id,documentIds:[documentId]},func:()=>{
                globalThis.fixtureMessages=[];chrome.runtime.sendMessage=async m=>{fixtureMessages.push(m);return {ok:true};};
              }});
              const adapter=await import('./connectors/bidv/index.js');await adapter.launch(tab.id,{runId:'fixture-bidv',documentId,account:'12345678',interval:{period:{start:'2026-10-01',end:'2026-10-16'}}});
            }""",result)
            def messages():
                return worker.evaluate("""async()=>{const [tab]=await chrome.tabs.query({url:'https://smartbanking.bidv.com.vn/*'});return (await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>globalThis.fixtureMessages}))[0].result;}""")
            deadline=time.monotonic()+15
            while time.monotonic()<deadline:
                values=messages() or []
                if any(m['type'] in ('capture-next','capture-error') for m in values):break
                popup.wait_for_timeout(100)
            assert not any(m['type']=='capture-error' for m in values),values
            pages=[m['data'] for m in values if m['type']=='capture-page']
            assert len(pages)==1 and pages[0]['totalRecords']==(0 if empty else 4)
            assert any(m['type']=='capture-complete' for m in values)
            assert 'fixture-must-not-cross-bridge' not in json.dumps(values)


def test_bidv_selects_account_through_card_without_reloading_preparation():
    service=PopupBackend()
    with http_server(service) as url,sync_playwright() as p,bidv_install(p,url,BidvBank()) as (_,worker,bank,popup,_):
        connect(popup,bank,url)
        bank.evaluate("localStorage.setItem('fixtureRequireCard','true');window.fixtureDocumentMarker='original'")
        popup.evaluate("""async()=>{
          const adapter=await import('./connectors/bidv/index.js');
          const [tab]=await chrome.tabs.query({url:'https://smartbanking.bidv.com.vn/*'});
          await adapter.prepare(tab.id);
        }""")
        assert bank.evaluate('window.fixtureDocumentMarker')=='original'
        bank.goto(ORIGIN+'/tai-khoan/thanh-toan/12345678')
        expect(bank.locator('app-card-account')).to_have_count(0)
        bank.goto(ORIGIN+'/tai-khoan')
        popup.evaluate("""async()=>{
          const adapter=await import('./connectors/bidv/index.js');
          const [tab]=await chrome.tabs.query({url:'https://smartbanking.bidv.com.vn/*'});
          await adapter.selectAccount(tab.id,'12345678');
        }""")
        expect(bank.locator('.card-account--no')).to_have_text('12345678')
        assert bank.evaluate("sessionStorage.getItem('fixtureSelected')")=='12345678'
