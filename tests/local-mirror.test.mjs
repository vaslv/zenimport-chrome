import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareMirror} from '../.local/contracts/zenmoney-projection.mjs';
import {mirrorReader} from '../.local/contracts/zenmoney-reader.mjs';
import {LocalCredentials} from '../.local/contracts/zenmoney-credentials.mjs';
const full=(extra='')=>'{"serverTimestamp":9007199254740993,"user":[{"id":9007199254740995}],"account":[],"instrument":[],"tag":[],"transaction":[]'+extra+'}';
test('mirror reprojects original exact bytes, both transfer legs, tags and unknown fields',()=>{
 const raw=full().replace('"transaction":[]','"transaction":[{"id":"t","date":"2026-10-20","incomeAccount":"a","outcomeAccount":"b","incomeInstrument":9007199254740997,"outcomeInstrument":2,"income":1.00000000000000000001,"outcome":27000,"viewed":false,"hold":true,"tag":["x","y"],"unknown":1e-90}]');
 const batch=prepareMirror(raw,'0',true,'run');assert.equal(batch.raw,raw);assert.equal(batch.cursor,'9007199254740993');assert.deepEqual(batch.owners,['9007199254740995']);
 assert.deepEqual(batch.movements[0],{kind:'transaction',id:'t',date:'2026-10-20',income_account:'a',outcome_account:'b',income_instrument:'9007199254740997',outcome_instrument:'2',income:'1.00000000000000000001',outcome:'27000',viewed:'0',hold:'1'});
 assert.deepEqual(batch.tags.map(row=>[row.tag_id,row.position]),[['x','0'],['y','1']]);assert.match(batch.entities.find(row=>row.kind==='transaction').data,/1e-90/);
});
test('missing collections are not a full mirror or deletion evidence; partial updates remain partial',()=>{
 for(const raw of [full().replace(',"account":[]',''),full().replace('"transaction":[]','"transaction":[{"id":"x"},{"id":"x"}]'),full().replace('"transaction":[]','"transaction":null'),'{"serverTimestamp":true}',full().replace('"user":[{"id":9007199254740995}]','"user":[]')])assert.throws(()=>prepareMirror(raw,'0',true,'run'),{code:'zenmoney_response'});
 assert.throws(()=>prepareMirror('{"serverTimestamp":1}','2',false,'run'),{code:'zenmoney_response'});
 const partial=prepareMirror('{"serverTimestamp":2}','1',false,'run');assert.deepEqual(partial.kinds,[]);assert.deepEqual(partial.tombstones,[]);
 const deleted=prepareMirror('{"serverTimestamp":2,"deletion":[{"id":"t","object":"transaction","extra":1e-80}]}','1',false,'run',()=> 'd');assert.equal(deleted.deletions[0].id,'d');assert.equal(deleted.tombstones[0].reason,'hard_delete');
});
test('read-only SDK gateway bounds errors, checks permission and never sends financial collections',async()=>{
 let calls=0,allowed=true;
 const reader=mirrorReader({permission:async()=>allowed,fetch:async(url,init)=>{
  calls++;assert.equal(url,'https://api.zenmoney.ru/v8/diff/');const body=JSON.parse(init.body);assert.equal(body.transaction,undefined);assert.equal(body.deletion,undefined);assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');return new Response(full());
 }});
 await reader.read('fixture-token','0',true);allowed=false;await assert.rejects(reader.read('fixture-token','0',true),{code:'zenmoney_permission'});assert.equal(calls,1);
 for(const [status,code]of [[400,'zenmoney_response'],[401,'zenmoney_auth'],[403,'zenmoney_auth'],[429,'zenmoney_rate_limited'],[500,'zenmoney_unavailable']]){
  const failing=mirrorReader({permission:async()=>true,fetch:async()=>new Response('secret-body',{status})});await assert.rejects(failing.read('secret-token','0',true),error=>error.code===code&&!String(error).includes('secret'));
 }
 await assert.rejects(mirrorReader({permission:async()=>true,maxResponseBytes:8,fetch:async()=>new Response(full())}).read('fixture-token','0',true),{code:'zenmoney_response'});
 await assert.rejects(mirrorReader({permission:async()=>true,timeoutMs:5,fetch:()=>new Promise(()=>{})}).read('fixture-token','0',true),{code:'zenmoney_unavailable'});
 const revoked=mirrorReader({permission:async()=>allowed,fetch:async()=>{allowed=false;return new Response(full());}});allowed=true;await assert.rejects(revoked.read('fixture-token','0',true),{code:'zenmoney_permission'});
 const brokenPermission=mirrorReader({permission:async()=>{throw Error('private-permission-detail');},fetch:async()=>{throw Error('must not fetch');}});
 await assert.rejects(brokenPermission.read('secret-token','0',true),error=>error.code==='zenmoney_permission'&&!String(error).includes('private'));
 allowed=true;const failedAndRevoked=mirrorReader({permission:async()=>allowed,fetch:async()=>{allowed=false;throw Error('private-network-detail');}});
 await assert.rejects(failedAndRevoked.read('secret-token','0',true),{code:'zenmoney_permission'});
});
test('SDK read gateway projects fractional clocks to exact Unix seconds',async()=>{
 let calls=0;
 const reader=mirrorReader({clock:()=>1792458000.875,permission:async()=>true,fetch:async(_url,init)=>{
  calls++;assert.equal(JSON.parse(init.body).currentClientTimestamp,1792458000);return new Response(full());
 }});
 await reader.read('fixture-token','0',true);assert.equal(calls,1);
});
test('unverified secret drafts expire after 24 hours and never become configured',async()=>{
 let now=100;const values={};const area={setAccessLevel:async()=>{},set:async data=>Object.assign(values,data),get:async key=>({[key]:values[key]}),remove:async key=>{delete values[key];}};
 const service=new LocalCredentials(area,area,{context:async()=>{throw Error('No Root read for a draft');}},{read:async()=>{throw Error('No network for a draft');}},()=>now);
 await service.saveDraft('synthetic-secret');assert.equal(await service.draft(),'synthetic-secret');now+=86400;assert.equal(await service.draft(),null);assert.deepEqual(values,{});
});
