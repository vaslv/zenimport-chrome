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
