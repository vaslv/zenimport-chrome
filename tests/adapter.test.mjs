import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspect,selectAccount,prepare,running,launch} from '../extension/connectors/vietinbank/index.js';

const account='12345678', url=`https://ipay.vietinbank.vn/payment-history?accountNo=${account}`;
const probe={account,accounts_complete:false,accounts:[]};
function fixture(t,{status='loading',empty=0,registered=true}={}) {
 const calls=[];let currentUrl=url,reloads=0,probes=0;
 const api={
  tabs:{get:async()=>({id:7,url:currentUrl,status}),update:async(_,data)=>{currentUrl=data.url;},reload:async()=>{reloads++;}},
  scripting:{getRegisteredContentScripts:async()=>registered?[{id:'observer'}]:[],registerContentScripts:async()=>{},
   executeScript:async injection=>{
    calls.push(injection);
    assert.equal(injection.injectImmediately,true,'must not wait for document_idle');
    return [{documentId:reloads?'document-new':'document-current',result:injection.func?.name==='probePage'?(probes++<empty?null:probe):true}];
   }},
 };
 const previous=globalThis.chrome;globalThis.chrome=api;
 t.after(()=>{if(previous===undefined)delete globalThis.chrome;else globalThis.chrome=previous;});
 return {calls,setUrl:value=>{currentUrl=value;},reloads:()=>reloads};
}
for(const status of ['loading','complete']) {
 test(`ready account can be selected while tab is ${status}`,async t=>{
  const f=fixture(t,{status});
  assert.equal(await selectAccount(7,account),'document-current');
  assert.equal(f.calls.length,1);
 });
}
test('an unfinished account DOM is retried before collection',async t=>{
 const f=fixture(t,{empty:1});
 assert.equal(await selectAccount(7,account),'document-current');
 assert.equal(f.calls.length,2);
});
test('login redirect is rejected without running capture scripts',async t=>{
 const f=fixture(t);f.setUrl('https://ipay.vietinbank.vn/login');
 await assert.rejects(selectAccount(7,account),e=>e.code==='bank_login_required');
 assert.equal(f.calls.length,0);
});
test('initial observer reload waits for a new document without idle resources',async t=>{
 const f=fixture(t,{registered:false});
 await prepare(7);assert.equal(f.reloads(),1);assert.equal(f.calls.length,2);
});
test('existing observer does not reload a bank session',async t=>{
 const f=fixture(t);await prepare(7);assert.equal(f.reloads(),0);
});
test('probe, running check and launch are immediate and preserve document binding',async t=>{
 const f=fixture(t);
 assert.equal((await inspect({id:7,url},'fixture-profile')).currentAccount,account);
 const driver={runId:'fixture-run',documentId:'document-current',account};
 assert.equal(await running(7,driver),true);await launch(7,driver);
 for(const call of f.calls.slice(1))assert.deepEqual(call.target,{tabId:7,documentIds:['document-current']});
});

test('DOM probe waits for parsing but accepts interactive before full load',async t=>{
 fixture(t);
 const originalDocument=globalThis.document, originalLocation=globalThis.location;
 globalThis.document={readyState:'loading',querySelector:()=>({textContent:account+' - Fixture - Current account'})};
 globalThis.location={href:url};
 t.after(()=>{
  if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;
  if(originalLocation===undefined)delete globalThis.location;else globalThis.location=originalLocation;
 });
 chrome.scripting.executeScript=async injection=>[{documentId:'fixture-document',result:injection.func()}];
 await assert.rejects(inspect({id:7,url},'fixture-profile'),e=>e.code==='bank_login_required');
 document.readyState='interactive';
 assert.equal((await inspect({id:7,url},'fixture-profile')).currentAccount,account);
 assert.equal((await inspect({id:7,url},'fixture-profile')).ownerName,'Fixture');
});
