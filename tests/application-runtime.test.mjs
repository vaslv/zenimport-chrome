import test from 'node:test';
import assert from 'node:assert/strict';
import {ApplicationRuntime} from '../.local/contracts/application-runtime.mjs';
import {memoryArea,memoryControl} from './application-support.mjs';

function fixture(t,values={}){
 const area=memoryArea(values),control=memoryControl(),previous=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({api_version:1,accounts:[]});};
 t.after(()=>{globalThis.fetch=previous;});
 return {area,control,calls,create:()=>new ApplicationRuntime(area,{},'explicit-unit-port',control)};
}
test('legacy remote upgrade preserves pending command and creates no local mode on network failure',async t=>{
 const capture={phase:'planned',command:{request_id:'original-request'}};
 const f=fixture(t,{config:{url:'https://old.invalid',token:'synthetic'},capture,view:{connection:{id:'old-connection'}}});
 const runtime=f.create(),app=await runtime.current();assert.equal(app.context.mode,'remote');assert.equal(f.control.inspect().activeGeneration,null);
 assert.deepEqual((await app.state.get('capture')).capture,capture);assert.equal(f.calls.length,0);
 globalThis.fetch=async()=>{throw Error('sensitive fixture response');};
 await assert.rejects(app.service.capture.start(capture.command),{code:'backend_unavailable'});
 assert.equal((await runtime.current()).context.dataset_id,app.context.dataset_id);
 assert.deepEqual((await (await f.create().current()).state.get('capture')).capture,capture);
});
test('server change isolates capture, profiles, dates and status; late tasks cannot update active context',async t=>{
 const f=fixture(t,{config:{url:'https://a.invalid',token:'synthetic'},capture:{phase:'complete',job:{id:'a-job'}},
  view:{connection:{id:'a-connection'}},profiles:{'https://a.invalid|bidv':'a-profile'},syncHistory:{'https://a.invalid|a-connection':'yesterday'}});
 const runtime=f.create(),a=await runtime.current(),b=await runtime.configure({url:'https://b.invalid',token:'new-fixture'},a);
 assert.notEqual(a.context.dataset_id,b.context.dataset_id);assert.equal(b.context.mode_epoch,'2');
 assert.equal((await b.state.get('capture')).capture,null);assert.equal((await b.state.get('view')).view,null);
 assert.deepEqual((await b.state.get('profiles')).profiles,{});
 await assert.rejects(a.service.capture.get('a-job'),{code:'stale_context'});await assert.rejects(a.state.set({capture:{job:{id:'late'}}}),{code:'stale_context'});
 assert.equal(f.calls.length,1);assert.equal((await b.state.get('capture')).capture,null);
});
test('same-server token correction keeps command identity but fences responses from the old credential',async t=>{
 const f=fixture(t,{config:{url:'https://a.invalid',token:'first'},capture:{phase:'paused',command:{request_id:'unknown-ack'}}});
 const runtime=f.create(),old=await runtime.current(),next=await runtime.configure({url:'https://a.invalid',token:'second'},old);
 assert.equal(next.context.dataset_id,old.context.dataset_id);assert.equal(next.context.mode_epoch,old.context.mode_epoch);
 assert.equal(next.context.credential_epoch,'2');assert.deepEqual((await next.state.get('capture')).capture.command,{request_id:'unknown-ack'});
 await assert.rejects(old.service.accounts.catalog(),{code:'stale_context'});
});
test('an in-flight remote reply is discarded after a pointer change and a missing referenced secret never falls back',async t=>{
 const f=fixture(t,{config:{url:'https://a.invalid',token:'fixture'}}),runtime=f.create(),app=await runtime.current();
 let release;globalThis.fetch=()=>new Promise(resolve=>{release=()=>resolve(Response.json({accounts:[]}));});
 const pending=app.service.accounts.catalog();while(!release)await new Promise(resolve=>setTimeout(resolve,1));
 f.control.mutate({epoch:'2'});release();await assert.rejects(pending,{code:'stale_context'});
 delete f.area.values['remoteCredential:'+f.control.inspect().credentialRef];const missing=await runtime.current();
 assert.equal(missing.config.token,'');assert.equal(missing.context.dataset_id,app.context.dataset_id);
 await assert.rejects(missing.service.accounts.catalog(),{code:'unauthorized'});
 assert.equal(f.control.inspect().activeMode,'remote');
});
test('pending migration and a local Root cannot gain a remote transport as fallback',async t=>{
 const f=fixture(t,{config:{url:'https://a.invalid',token:'fixture'}}),runtime=f.create(),app=await runtime.current();
 f.control.mutate({pendingSwitchId:crypto.randomUUID()});await assert.rejects(app.service.capture.stop('job'),{code:'migration_paused'});
 assert.equal(f.calls.length,0);f.control.mutate({activeMode:'local',activeGeneration:crypto.randomUUID()});
 await assert.rejects(runtime.current(),{code:'local_mode_disabled'});assert.equal(f.calls.length,0);
});
