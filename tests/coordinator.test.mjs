import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Coordinator} from '../extension/coordinator.js';
import {remoteService} from '../.local/contracts/application-remote.mjs';

function fixture(bank='synthetic-second-bank') {
 let state, count=0, failAck=false, failStartAck=false, running=false;
 const events=[], persisted=[];
 const connection={id:'connection',accounts:[{id:'account-a',source_key:'source-a',selection:'enabled'},
   {id:'account-b',source_key:'source-b',selection:'enabled'},{id:'account-c',source_key:'source-c',selection:'ignored'}]};
 const job={id:'job',capture_state:'planned',delivery_state:'waiting',accounts:['a','b'].map(x=>({account_id:'account-'+x,
   intervals:[{id:'interval-'+x,state:'planned',period:{start:'2026-10-01',end:'2026-10-10'}}]}))};
 const pages = new Map();
 const backend={request:async(path,method,body)=>{
   events.push({path,method,body});
   if(path==='/jobs'){
     if(failStartAck){failStartAck=false;throw Object.assign(Error(),{code:'backend_unavailable'});}
     return structuredClone(job);
   }
   if(path.endsWith('/lease'))return {epoch:1,expires_at:'2099-01-01T00:00:00Z'};
   if(method==='PUT') {
     const old=pages.get(path);if(old)assert.deepEqual(old,body);else pages.set(path,structuredClone(body));
     if(failAck){failAck=false;throw Object.assign(Error(),{code:'backend_unavailable'});}
     return {};
   }
   if(path.endsWith('/complete')){const id=path.split('/')[4];for(const a of job.accounts)for(const i of a.intervals)if(i.id===id)i.state='complete';
     if(job.accounts.every(a=>a.intervals.every(i=>i.state==='complete')))job.capture_state='complete';return {};}
   if(path.endsWith('/capture-status'))return {};
   if(path.endsWith('/stop')){job.capture_state='cancelled';return {};}
   return structuredClone(job);
 }};
 const store={get:async()=>structuredClone(state),set:async value=>{state=structuredClone(value);persisted.push(structuredClone(value));}};
 const adapter={running:async()=>running,selectAccount:async(tab,source)=>{events.push({select:source,tabId:tab});return 'document';},
   launch:async()=>{running=true;},abort:async()=>{running=false;},parsePage:async()=>({records:[{external_id:'fixture'}],total:1,size:100,totalPages:1})};
 const create=(options={})=>new Coordinator({store,service:remoteService(backend),...options,connector:name=>{assert.equal(name,bank);return adapter;},uuid:()=>`uuid-${++count}`});
 return {create,store,events,persisted,pages,job,connection,start:{connection,bank,tabId:42},source:{tabId:42,documentId:'document',account:'source-a'},
   loseAck:()=>{failAck=true;},loseStartAck:()=>{failStartAck=true;},stopDriver:()=>{running=false;}};
}
test('ACK-before-checkpoint, worker re-creation, lost ACK replay and ignored account',async()=>{
 const f=fixture();let engine=f.create();await engine.start(f.start);
 let state=await f.store.get();const run=state.driver.runId;
 f.loseAck();await assert.rejects(engine.page(run,f.source,{currentPage:0}));
 assert.equal((await f.store.get()).received,0);assert.equal(f.pages.size,1);
 engine=f.create(); // New service-worker module, same durable store and server.
 await engine.page(run,f.source,{currentPage:0});assert.equal((await f.store.get()).received,1);
 await engine.complete(run,f.source);await engine.pump();
 state=await f.store.get();assert.equal(state.driver.account,'source-b');
 assert.equal(f.events.some(e=>e.select==='source-c'),false);
 await assert.rejects(engine.page(run,f.source,{currentPage:0}),{code:'capture_context_changed'});
});
test('stale document, wrong account and different connection cannot reuse an active capture',async()=>{
 const f=fixture();const engine=f.create();await engine.start(f.start);const run=(await f.store.get()).driver.runId;
 for(const source of [{...f.source,documentId:'new'},{...f.source,tabId:43},{...f.source,account:'other'}]) {
   await assert.rejects(engine.page(run,source,{currentPage:0}),{code:'capture_context_changed'});
 }
 await assert.rejects(engine.start({...f.start,connection:{id:'other'}}),{code:'account_busy'});
 assert.equal(f.pages.size,0);
});
test('popup closure does not own capture; pause/cancel do not delete acknowledged pages',async()=>{
 const f=fixture();const engine=f.create();await engine.start(f.start);const run=(await f.store.get()).driver.runId;
 await engine.page(run,f.source,{currentPage:0});await engine.pause();
 assert.equal((await f.store.get()).phase,'paused');assert.equal(f.pages.size,1);
 await engine.stop();assert.equal((await f.store.get()).phase,'cancelled');assert.equal(f.pages.size,1);
});
test('a persisted driver not actually launched is restarted from server checkpoint',async()=>{
 const f=fixture();await f.create().start(f.start);const old=(await f.store.get()).driver.runId;
 f.stopDriver();await f.create().pump();assert.notEqual((await f.store.get()).driver.runId,old);
});
test('manual resume rebinds a paused job to a reopened bank tab with a new command UUID',async()=>{
 const f=fixture();const engine=f.create();await engine.start(f.start);
 const old=(await f.store.get()).command.request_id;
 await engine.pause();await engine.start({...f.start,tabId:77});
 const state=await f.store.get();assert.equal(state.tabId,77);assert.notEqual(state.command.request_id,old);
 assert.equal(state.job.id,'job');
});

test('lost start ACK resumes in the new tab with the original command and worker identity',async()=>{
 const f=fixture();let engine=f.create();f.loseStartAck();
 await assert.rejects(engine.start(f.start),{code:'backend_unavailable'});
 await engine.pause('backend_unavailable');
 const paused=await f.store.get();assert.equal(paused.phase,'paused');assert.equal(paused.job,undefined);
 engine=f.create(); // A restarted worker reads the durable unknown-job command.
 const connection={...f.connection,accounts:f.connection.accounts.map(a=>({...a,label:'Fresh discovery'}))};
 await engine.start({...f.start,connection,tabId:77});
 const state=await f.store.get();
 assert.equal(state.phase,'collecting');assert.equal(state.error,null);
 assert.equal(state.tabId,77);assert.deepEqual(state.connection,connection);
 assert.equal(state.workerId,paused.workerId);assert.deepEqual(state.command,paused.command);
 assert.deepEqual(f.events.filter(e=>e.path==='/jobs').map(e=>e.body.request_id),[paused.command.request_id,paused.command.request_id]);
 assert.deepEqual(f.events.filter(e=>e.select).map(e=>e.tabId),[77]);
 assert.equal(state.job.id,'job');
});

test('completion time is recorded once, only after capture and delivery succeed',async()=>{
 const f=fixture();let now=Date.parse('2026-10-16T05:00:00Z');
 const engine=f.create({clock:()=>now});
 f.job.capture_state='complete';await engine.start(f.start);
 assert.equal((await f.store.get()).completedAt,undefined);
 f.job.delivery_state='blocked';await engine.pump();
 assert.equal((await f.store.get()).completedAt,undefined);
 f.job.delivery_state='complete';now+=120000;await engine.pump();
 const completed=(await f.store.get()).completedAt;
 assert.equal(completed,'2026-10-16T05:02:00.000Z');
 now+=3600000;await f.create({clock:()=>now}).pump();
 assert.equal((await f.store.get()).completedAt,completed);
 // Do not invent completion time for captures made before timestamp tracking.
 const old=await f.store.get();delete old.startedAt;delete old.completedAt;await f.store.set(old);
 await engine.pump();assert.equal((await f.store.get()).completedAt,undefined);
});
