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

test('bound same-server token repair retains scope and jobs and rejects a replaced physical dataset',async()=>{
 const area=memoryArea({config:{url:'https://fixture.invalid',token:'old-synthetic'},capture:{phase:'paused',command:{request_id:'retained-command'}}}),control=memoryControl();
 let identity={protocol_version:'2',archive_version:'2',financial_schema_version:'1',chunk_bytes:'262144',max_archive_bytes:'67108864',
  installation_id:crypto.randomUUID(),dataset_id:crypto.randomUUID(),participant_epoch:'1',state:'active',operation_id:null,awaiting_sync:false,legacy_hold:null,can_import:false,owner_ids:['1'],checked_at:'1000'};
 const fetch=async url=>Response.json(String(url).endsWith('/identity')?identity:{api_version:1,context_fencing:1});
 const runtime=new ApplicationRuntime(area,{},'bound-unit',control,{session:memoryArea(),permission:async()=>true,serverPermission:async()=>true,fetch});
 const unverified=await runtime.current();await assert.rejects(unverified.service.capture.start({}),{code:'server_verification_required'});
 const before=await runtime.verifySelected(unverified);assert.equal(before.context.dataset_id,identity.dataset_id);
 const repeated=await runtime.verifySelected(unverified);assert.deepEqual(repeated.context,before.context);await repeated.service.connections.list('bidv');
 assert.notEqual(before.context.generation,before.context.dataset_id);
 const next=await runtime.configure({url:'https://fixture.invalid',token:'replacement-synthetic'},before);
 assert.equal(next.context.dataset_id,before.context.dataset_id);assert.equal(next.context.generation,before.context.generation);
 assert.deepEqual((await next.state.get('capture')).capture.command,{request_id:'retained-command'});
 const root=control.inspect();identity={...identity,dataset_id:crypto.randomUUID()};
 await assert.rejects(runtime.configure({url:'https://fixture.invalid',token:'other-synthetic'},next),{code:'stale_context'});
 assert.deepEqual(control.inspect(),root);assert.deepEqual((await next.state.get('capture')).capture.command,{request_id:'retained-command'});
 runtime.close();
});

test('revoked server permission prevents ordinary requests and credential verification',async()=>{
 const area=memoryArea({config:{url:'https://fixture.invalid',token:'synthetic'}}),control=memoryControl();let granted=true,calls=0;
 const identity={protocol_version:'2',archive_version:'2',financial_schema_version:'1',chunk_bytes:'262144',max_archive_bytes:'67108864',
  installation_id:crypto.randomUUID(),dataset_id:crypto.randomUUID(),participant_epoch:'1',state:'active',operation_id:null,awaiting_sync:false,legacy_hold:null,can_import:false,owner_ids:['1'],checked_at:'1000'};
 const fetch=async url=>{calls++;return Response.json(String(url).endsWith('/identity')?identity:{api_version:1,context_fencing:1});};
 const runtime=new ApplicationRuntime(area,{},'permission-unit',control,{session:memoryArea(),permission:async()=>true,serverPermission:async()=>granted,fetch});
 const app=await runtime.verifySelected(await runtime.current()),before=calls;granted=false;
 await assert.rejects(app.service.capture.start({}),{code:'permission_required'});
 await assert.rejects(runtime.configure({url:'https://fixture.invalid',token:'replacement'},app),{code:'permission_required'});
 assert.equal(calls,before);runtime.close();
});

test('an unavailable legacy server never blocks reading its context or repairing its selected token',async()=>{
 const area=memoryArea({config:{url:'https://fixture.invalid',token:'invalid-synthetic'},capture:{phase:'paused',command:{request_id:'keep'}}}),control=memoryControl();let offline=true;
 const identity={protocol_version:'2',archive_version:'2',financial_schema_version:'1',chunk_bytes:'262144',max_archive_bytes:'67108864',
  installation_id:crypto.randomUUID(),dataset_id:crypto.randomUUID(),participant_epoch:'1',state:'active',operation_id:null,awaiting_sync:false,legacy_hold:null,can_import:false,owner_ids:['1'],checked_at:'1000'};
 const fetch=async url=>{if(offline)throw Error('private-fixture');return Response.json(String(url).endsWith('/identity')?identity:{api_version:1,context_fencing:1});};
 const runtime=new ApplicationRuntime(area,{},'repair-unit',control,{session:memoryArea(),permission:async()=>true,serverPermission:async()=>true,fetch});
 const app=await runtime.current();assert.equal(app.context.mode,'remote');
 await assert.rejects(runtime.verifySelected(app),{code:'backend_unavailable'});
 assert.deepEqual((await (await runtime.current()).state.get('capture')).capture.command,{request_id:'keep'});
 offline=false;const repaired=await runtime.configure({url:'https://fixture.invalid',token:'new-synthetic'},app);
 assert.equal(repaired.context.mode,'remote');assert.equal(repaired.context.generation,app.context.generation);
 assert.deepEqual((await repaired.state.get('capture')).capture.command,{request_id:'keep'});runtime.close();
});
