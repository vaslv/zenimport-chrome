import {test} from 'node:test';
import assert from 'node:assert/strict';

const server='https://fixture.invalid';
const popupSender={id:'fixture-extension',url:'chrome-extension://fixture-extension/popup.html'};
const configure={type:'configure',url:server+'/',token:'fixture-new'};
const pausedCapture=()=>({phase:'paused',error:'unauthorized',bank:'vietinbank',tabId:42,
  connection:{id:'fixture-connection',accounts:[]},workerId:'fixture-worker',
  command:{connection_id:'fixture-connection',request_id:'fixture-command',reimport_from:null},
  job:{id:'fixture-job',capture_state:'paused',accounts:[]},driver:null,lease:null});

async function fixture(t,capture,{fetcher}={}) {
  const previous={chrome:globalThis.chrome,fetch:globalThis.fetch};
  let listener;
  const local={config:{url:server,token:'fixture-old'},capture:structuredClone(capture),view:{connection:capture.connection}};
  const session={connectionDraft:{url:server,token:'fixture-new'}};
  const calls=[];
  const area=values=>({
    setAccessLevel:async()=>{},
    get:async keys=>structuredClone(Object.fromEntries((typeof keys==='string'?[keys]:keys).map(key=>[key,values[key]]))),
    set:async value=>Object.assign(values,structuredClone(value)),
    remove:async keys=>{for(const key of typeof keys==='string'?[keys]:keys)delete values[key];},
  });
  globalThis.chrome={storage:{local:area(local),session:area(session)},
    runtime:{id:popupSender.id,getURL:path=>'chrome-extension://fixture-extension/'+path,
      onMessage:{addListener:handler=>{listener=handler;}},onStartup:{addListener:()=>{}}},
    alarms:{onAlarm:{addListener:()=>{}},get:async()=>({name:'capture'})},
    tabs:{onRemoved:{addListener:()=>{}},get:async()=>({url:'https://ipay.vietinbank.vn/payment-history?accountNo=12345678'}),sendMessage:async()=>{}},
  };
  globalThis.fetch=async(url,options)=>{
    calls.push({url,options});
    return fetcher ? fetcher(url,options) : Response.json({api_version:1});
  };
  t.after(()=>{globalThis.chrome=previous.chrome;globalThis.fetch=previous.fetch;});
  await import('../extension/background.js?fixture='+crypto.randomUUID());
  const send=(data,sender=popupSender)=>new Promise(resolve=>listener(data,sender,resolve));
  await send({type:'status'}); // Drain initial state restoration before assertions.
  return {local,session,calls,send};
}

for(const known of [true,false])test(`paused token repair preserves ${known?'known':'unknown'} job and does not start synchronization`,async t=>{
  const capture=pausedCapture();if(!known)delete capture.job;
  const f=await fixture(t,capture);
  assert.deepEqual(await f.send(configure),{ok:true,configured:true});
  assert.deepEqual(f.local.config,{url:server,token:'fixture-new'});
  assert.deepEqual(f.local.capture,{...capture,error:null});
  assert.deepEqual(f.local.view,{connection:capture.connection});
  assert.equal(f.session.connectionDraft,undefined);
  assert.deepEqual(f.calls.map(call=>call.url),[server+'/api/v1/info']);
  assert.equal(f.calls[0].options.headers.Authorization,'Bearer fixture-new');
});

test('rejected replacement token preserves old configuration, paused checkpoint and draft',async t=>{
  const capture=pausedCapture();
  const f=await fixture(t,capture,{fetcher:async()=>Response.json({error:{code:'unauthorized'}},{status:401})});
  assert.deepEqual(await f.send(configure),{ok:false,error:'unauthorized'});
  assert.deepEqual(f.local.config,{url:server,token:'fixture-old'});
  assert.deepEqual(f.local.capture,capture);
  assert.equal(f.session.connectionDraft.token,'fixture-new');
});

for(const phase of ['planned','collecting','paused'])test(`unfinished ${phase} capture rejects another server before any request`,async t=>{
  const capture={...pausedCapture(),phase};const f=await fixture(t,capture);
  assert.deepEqual(await f.send({...configure,url:'https://another.invalid'}),{ok:false,error:'account_busy'});
  if(phase!=='paused')assert.deepEqual(await f.send(configure),{ok:false,error:'account_busy'});
  assert.deepEqual(f.local.capture,capture);assert.equal(f.local.config.token,'fixture-old');
  assert.equal(f.calls.length,0);
});

test('failure recovery completes before a queued token repair can change configuration',async t=>{
  const capture={...pausedCapture(),phase:'collecting',error:null,
    driver:{runId:'fixture-run',documentId:'fixture-document',account:'12345678'},
    lease:{epoch:1,expires_at:'2000-01-01T00:00:00Z'}};
  let reachedPause,releasePause;
  const pausing=new Promise(resolve=>{reachedPause=resolve;});
  const release=new Promise(resolve=>{releasePause=resolve;});
  const f=await fixture(t,capture,{fetcher:async(url)=>{
    if(url.endsWith('/capture-status')){reachedPause();await release;}
    return url.endsWith('/info')?Response.json({api_version:1}):Response.json({error:{code:'unauthorized'}},{status:401});
  }});
  const failed=f.send({type:'capture-check',runId:'fixture-run',account:'12345678'},
    {id:popupSender.id,frameId:0,tab:{id:42},documentId:'fixture-document',url:'https://ipay.vietinbank.vn/payment-history?accountNo=12345678'});
  await pausing;
  const repaired=f.send(configure);
  releasePause();
  assert.deepEqual(await failed,{ok:false,error:'unauthorized'});
  assert.deepEqual(await repaired,{ok:true,configured:true});
  assert.equal(f.local.capture.phase,'paused');assert.equal(f.local.capture.error,null);
  assert.equal(f.local.capture.workerId,capture.workerId);
  assert.deepEqual(f.local.capture.command,capture.command);
  assert.equal(f.local.config.token,'fixture-new');
  assert.deepEqual(f.calls.map(call=>new URL(call.url).pathname),[
    '/api/v1/jobs/fixture-job/lease','/api/v1/jobs/fixture-job/capture-status','/api/v1/info']);
});

async function bankProfiles(t,{lostCreateAck=false}={}) {
  const records=[{id:'connection-a',bank:'vietinbank',profile_key:'profile-a',profile_identity:'user_selected',label:'Personal',
    accounts_complete:false,accounts:[{id:'account-a',source_key:'12345678',currency:'VND'}]}];
  const live={account:'12345678'};let loses=lostCreateAck;
  const f=await fixture(t,{...pausedCapture(),phase:'complete'},{fetcher:async(url,options)=>{
    const path=new URL(url).pathname;
    if(path.endsWith('/info'))return Response.json({api_version:1});
    if(path.endsWith('/connections'))return Response.json({connections:records});
    if(path.endsWith('/discover')){
      const body=JSON.parse(options.body);let c=records.find(c=>c.profile_key===body.profile_key);
      if(!c){c={id:'connection-'+records.length,accounts:[]};records.push(c);}
      Object.assign(c,{bank:body.bank,profile_key:body.profile_key,profile_identity:body.profile_identity,label:body.label || c.label});
      for(const account of body.accounts)if(!c.accounts.some(a=>a.source_key===account.source_key))c.accounts.push({id:'account-'+account.source_key,...account});
      if(loses && body.label){loses=false;throw Error('fixture lost ACK');}
      return Response.json(c);
    }
    throw Error('Unexpected endpoint '+url);
  }});
  chrome.tabs.query=async()=>[{id:42,url:'https://ipay.vietinbank.vn/payment-history?accountNo='+live.account}];
  chrome.scripting={executeScript:async()=>[{documentId:'fixture-document',result:{account:live.account,accounts_complete:false,
    accounts:[{source_key:live.account,identity_scope:'bank',currency:'VND',scale:0,supported:true}]}}]};
  return {...f,records,live};
}
test('new login never silently appends its accounts to the last connection',async t=>{
  const f=await bankProfiles(t);assert.equal((await f.send({type:'inspect'})).connection.id,'connection-a');
  f.live.account='87654321';const result=await f.send({type:'inspect'});
  assert.equal(result.selectionRequired,true);assert.equal(result.connection,null);
  assert.deepEqual(f.records[0].accounts.map(a=>a.source_key),['12345678']);
  assert.deepEqual(await f.send({type:'start',connectionId:'connection-a'}),{ok:false,error:'bank_connection_required'});
  assert.ok(!f.calls.some(c=>c.url.endsWith('/jobs')));
});
test('named creation retries the same profile after a lost ACK, then automatically matches the right login',async t=>{
  const f=await bankProfiles(t,{lostCreateAck:true});f.live.account='87654321';
  assert.equal((await f.send({type:'create-bank-connection',label:'Work'})).ok,false);
  const pending=Object.values(f.local.creatingProfiles)[0].profileKey;assert.ok(pending);
  assert.equal((await f.send({type:'create-bank-connection',label:'Work'})).connection.profile_key,pending);
  assert.equal(f.records.length,2);
  f.live.account='12345678';assert.equal((await f.send({type:'inspect'})).connection.id,'connection-a');
  f.live.account='87654321';assert.equal((await f.send({type:'inspect'})).connection.profile_key,pending);
  assert.deepEqual(await f.send({type:'start',connectionId:'connection-a'}),{ok:false,error:'bank_connection_changed'});
  assert.ok(!f.calls.some(c=>c.url.endsWith('/jobs')));
});
test('unknown account needs an explicit existing-connection association and a running job prevents switching',async t=>{
  const f=await bankProfiles(t);f.live.account='87654321';
  assert.equal((await f.send({type:'inspect'})).connection,null);
  assert.equal((await f.send({type:'select-bank-connection',profileKey:'profile-a'})).connection.accounts.length,2);
  f.local.capture.phase='paused';
  assert.deepEqual(await f.send({type:'create-bank-connection',label:'Other'}),{ok:false,error:'account_busy'});
  assert.deepEqual(await f.send({type:'select-bank-connection',profileKey:'profile-a'}),{ok:false,error:'account_busy'});
});
test('one-time import dates are scoped to the selected connection',async t=>{
  const f=await bankProfiles(t);await f.send({type:'inspect'});
  assert.deepEqual(await f.send({type:'reimport',connectionId:'connection-a',date:'2026-08-01'}),{ok:true});
  f.live.account='87654321';const b=await f.send({type:'create-bank-connection',label:'Work'});
  assert.equal((await f.send({type:'status'})).reimportFrom,'');
  await f.send({type:'reimport',connectionId:b.connection.id,date:'2026-09-01'});
  f.live.account='12345678';assert.equal((await f.send({type:'inspect'})).reimportFrom,'2026-08-01');
  assert.deepEqual(await f.send({type:'reimport',connectionId:b.connection.id,date:''}),{ok:false,error:'bank_connection_changed'});
});

// A creation ACK can be lost immediately before the user changes bank logins.
// That pending identity is reusable only for the same observed physical accounts.
test('lost creation ACK cannot merge a later login into its pending connection',async t=>{
  const f=await bankProfiles(t,{lostCreateAck:true});f.live.account='87654321';
  assert.equal((await f.send({type:'create-bank-connection',label:'Work'})).ok,false);
  const pending=Object.values(f.local.creatingProfiles)[0].profileKey;
  f.live.account='11112222';const other=await f.send({type:'create-bank-connection',label:'Family'});
  assert.equal(other.ok,true);assert.notEqual(other.connection.profile_key,pending);
  assert.equal(f.records.length,3);
  assert.deepEqual(f.records.find(c=>c.profile_key===pending).accounts.map(a=>a.source_key),['87654321']);
  assert.deepEqual(other.connection.accounts.map(a=>a.source_key),['11112222']);
});
