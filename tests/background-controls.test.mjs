import test from 'node:test';
import assert from 'node:assert/strict';
import {nextControl,ControlAlarms,CONTROL_ALARM} from '../.local/contracts/background-controls.mjs';
const empty=()=>({controls:{transfer:null,join:null},archives:{recovery:null,restore:null,backup:null,backups:[]}});
function fixture(){
 const storage=empty(),values={},events=[];let alarm;
 const app={assert:async()=>{},root:{pendingSwitchId:null},context:{mode:'local'}};
 const controls={status:async()=>storage.controls,step:async id=>{events.push(id);storage.controls.transfer=null;return {state:'complete'};}};
 const runtime={current:async()=>app,controls:()=>controls,archives:()=>({
  local:{status:async()=>storage.archives},recovery:{current:async()=>storage.archives.recovery},backup:{current:async()=>storage.archives.backup}})};
 const area={get:async()=>values,set:async value=>Object.assign(values,value),remove:async key=>{delete values[key];}};
 const alarms={get:async()=>alarm,create:async(name,options)=>{events.push('arm');alarm={name,...options};},clear:async()=>{alarm=undefined;}};
 return {storage,values,events,app,controls,runtime,area,alarms,driver:new ControlAlarms(runtime,area,alarms),alarm:()=>alarm};
}
test('control wakeup planning never accepts a recovery preview or download acknowledgement',()=>{
 const s=empty();assert.equal(nextControl(s),null);
 s.archives.restore={id:crypto.randomUUID(),phase:'preview'};assert.equal(nextControl(s),null);
 s.archives.recovery={id:crypto.randomUUID(),phase:'pending',awaitingConfirmation:true};assert.equal(nextControl(s),null);
 s.archives.recovery=null;s.archives.backup={id:crypto.randomUUID(),phase:'ready',ackRequested:false,cancelRequested:false};assert.equal(nextControl(s),null);
 s.archives.backup.ackRequested=true;assert.equal(nextControl(s).type,'archive-export-step');
});
test('an already persisted control intent resumes after reconstruction with watchdog before dispatch',async()=>{
 const f=fixture(),id=crypto.randomUUID();f.storage.controls.transfer={id,phase:'importing'};
 const restarted=new ControlAlarms(f.runtime,f.area,f.alarms);await restarted.restore();assert.equal(f.alarm().name,CONTROL_ALARM);
 await restarted.wake();assert.deepEqual(f.events,['arm',id]);assert.equal(f.alarm(),undefined);
});
test('a blocked control is durably paused until explicit retry and exposes only a stable code',async()=>{
 const f=fixture(),id=crypto.randomUUID();f.storage.controls.transfer={id,phase:'importing'};
 f.controls.step=async()=>{f.events.push('failed');throw Object.assign(Error('private response'),{code:'private-token'});};
 await f.driver.wake();assert.deepEqual(await f.driver.pause(),{id,error:'migration_invalid'});assert.equal(f.alarm(),undefined);
 const restarted=new ControlAlarms(f.runtime,f.area,f.alarms);await restarted.wake();assert.equal(f.events.filter(x=>x==='failed').length,1);
 f.controls.step=async()=>{f.storage.controls.transfer=null;return {state:'complete'};};await restarted.retry();await restarted.wake();assert.equal(f.alarm(),undefined);
});
test('held controls retain actionable ZenMoney credential errors',async()=>{
 for(const code of ['zenmoney_auth','zenmoney_not_configured','zenmoney_wrong_owner']){
  const f=fixture(),id=crypto.randomUUID();f.storage.controls.transfer={id,phase:'importing'};
  f.controls.step=async()=>{throw Object.assign(Error('private response'),{code});};
  await f.driver.wake();assert.deepEqual(await f.driver.pause(),{id,error:code});
 }
});
test('worker budgets are bounded and awaiting remote work keeps a periodic watchdog',async()=>{
 const f=fixture(),id=crypto.randomUUID();f.storage.controls.transfer={id,phase:'importing'};let calls=0;
 f.controls.step=async()=>{calls++;return {state:'progress'};};await f.driver.wake();assert.equal(calls,16);assert.equal(f.alarm().periodInMinutes,.5);
 f.controls.step=async()=>{calls++;return {state:'waiting'};};await f.driver.wake();assert.equal(calls,17);assert.ok(f.alarm());
});

test('a native backup preparation resumes the same export id before a snapshot hold exists',()=>{
 const s=empty(),id=crypto.randomUUID();s.archives.preparation={id,generation:crypto.randomUUID(),phase:'quiescing'};
 assert.deepEqual(nextControl(s),{type:'archive-export-step',kind:'local',id});
 s.archives.preparation.phase='cancelled';assert.equal(nextControl(s),null);
});
