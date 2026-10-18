import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepare,inspect,selectAccount} from '../extension/connectors/bidv/index.js';

const origin='https://smartbanking.bidv.com.vn',account='12345678';
function fixture(t,{registered=true,injected=true}={}) {
  const previous=globalThis.chrome,calls=[];let reloads=0,url=origin+'/tai-khoan';
  globalThis.chrome={tabs:{get:async()=>({id:7,url}),reload:async()=>{reloads++;},update:async(_,data)=>{url=data.url;}},
    scripting:{getRegisteredContentScripts:async()=>registered?[{}]:[],registerContentScripts:async data=>calls.push({registered:data}),
      executeScript:async data=>{
        calls.push(data);assert.equal(data.injectImmediately,true);
        if(data.func?.name==='openAccountCard')url=origin+'/tai-khoan/thanh-toan/'+data.args[0];
        return [{documentId:reloads?'new-document':'old-document',result:data.world==='MAIN'?injected:
          data.func?.name==='probePage'?{account,accounts_complete:false,accounts:[{source_key:account}]}:true}];
      }}};
  t.after(()=>{globalThis.chrome=previous;});
  return {calls,reloads:()=>reloads,url:()=>url,setUrl:value=>{url=value;}};
}
for(const registered of [true,false])test(`BIDV prepares a tab missing its observer (registration ${registered})`,async t=>{
  const f=fixture(t,{registered,injected:false});await prepare(7);
  assert.equal(f.reloads(),0);
  assert.ok(f.calls.some(c=>c.files?.includes('connectors/bidv/observer.js')));
  assert.equal(f.calls.filter(c=>c.registered).length,registered?0:1);
  assert.ok(f.calls.some(c=>c.world==='MAIN'));
});
test('BIDV already injected observer does not reload the bank',async t=>{
  const f=fixture(t);await prepare(7);assert.equal(f.reloads(),0);
});
test('BIDV binds selected account URL, DOM and document before launching capture',async t=>{
  const f=fixture(t);assert.equal(await selectAccount(7,account),'old-document');
  assert.equal(f.url(),origin+'/tai-khoan/thanh-toan/'+account);
  assert.equal((await inspect({id:7,url:f.url()},'fixture-profile')).discovery.bank,'bidv');
  f.setUrl(origin+'/dang-nhap');await assert.rejects(selectAccount(7,account),e=>e.code==='bank_login_required');
});
