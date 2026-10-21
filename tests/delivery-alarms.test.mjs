import test from 'node:test';
import assert from 'node:assert/strict';
import {DeliveryAlarms,DELIVERY_ALARM} from '../.local/contracts/delivery-alarms.mjs';
const fixture=()=>{let alarm;return {get:async()=>alarm,create:async(name,options)=>{alarm={name,scheduledTime:options.when,...options};},clear:async()=>{alarm=undefined;return true;},value:()=>alarm};};
test('watchdog exists before a killed cycle and survives idle state',async()=>{
  const alarms=fixture();let due='100',runs=0;
  const controller=new DeliveryAlarms(alarms,async()=>({next:async()=>due,run:async()=>{runs++;assert.equal(alarms.value().periodInMinutes,.5);throw Error('worker killed');}}),()=>100);
  await assert.rejects(controller.wake(),/worker killed/);assert.equal(runs,1);assert.equal(alarms.value().periodInMinutes,.5);
  due=null;await controller.restore();assert.equal(alarms.value().periodInMinutes,.5);
});
test('overlapping mode restore converges after an old clear',async()=>{
  const alarms=fixture();let active=false,release,entered;
  const inside=new Promise(resolve=>{entered=resolve;});
  const original=alarms.clear;alarms.clear=async()=>{entered();await new Promise(resolve=>{release=resolve;});return original();};
  const controller=new DeliveryAlarms(alarms,async()=>active?{next:async()=> '100',run:async()=>{}}:null,()=>100);
  const first=controller.restore();await inside;active=true;const second=controller.restore();release();await Promise.all([first,second]);
  assert.equal(alarms.value().name,DELIVERY_ALARM);assert.equal(alarms.value().periodInMinutes,.5);
});
test('a wake drains at most three ready units and unrelated alarms do nothing',async()=>{
  const alarms=fixture();let runs=0;const controller=new DeliveryAlarms(alarms,async()=>({next:async()=> '100',run:async()=>{runs++;}}),()=>100);
  await controller.wake('unrelated');assert.equal(runs,0);await controller.wake();assert.equal(runs,3);
});
