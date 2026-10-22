import test from 'node:test';
import assert from 'node:assert/strict';
import {message} from '../.local/contracts/application-messages.mjs';
import {createRpc} from '../.local/contracts/application-rpc.mjs';
import {controlCommand} from '../.local/contracts/application-control-api.mjs';
import {controlCommands,controlFields} from '../.local/contracts/application-control-messages.mjs';
const scope=()=>({dataset_id:crypto.randomUUID(),generation:crypto.randomUUID(),mode:'local',mode_epoch:'1',credential_epoch:'1'});
const command=(type,extra={})=>({type,context:scope(),operation_id:crypto.randomUUID(),...extra});
test('only trusted popup controls may name archive/mode commands and no UI proof is accepted',()=>{
 assert.deepEqual([...controlCommands].sort(),Object.keys(controlFields).sort());
 for(const type of controlCommands){
  assert.throws(()=>message(command(type),'capture'),{code:'unauthorized'});
  assert.throws(()=>message(command(type),'report'),{code:'unauthorized'});
  assert.throws(()=>message(command(type,{proof:{decision:'activated'}}),'popup'),{code:'validation_error'});
 }
 const valid=command('local-configure',{token:'synthetic-only'});assert.equal(message(valid,'popup'),valid);
 assert.throws(()=>message({type:'local-remove',operation_id:crypto.randomUUID()},'popup'),{code:'stale_context'});
 assert.throws(()=>message(command('archive-upload-chunk',{id:crypto.randomUUID(),base64:'x'.repeat(349529)}),'popup'),{code:'validation_error'});
 for(const number of [-1,256,1.5,'1',Number.NaN])assert.throws(()=>message(command('archive-upload-chunk',{number}),'popup'),{code:'validation_error'});
});
test('explicit control commands adopt their own Root response but discard a late prior request',async()=>{
 let selected=scope(),release;
 const rpc=createRpc(async data=>{
  if(data.type==='slow')return new Promise(resolve=>{release=()=>resolve({ok:true,context:{...selected,operation_id:data.operation_id}});});
  if(data.type==='local-configure')selected={...selected,credential_epoch:'2'};
  return {ok:true,context:{...selected,operation_id:data.operation_id}};
 });
 await rpc({type:'status'});const pending=rpc({type:'slow'});await rpc({type:'local-configure'});release();
 await assert.rejects(pending,{code:'stale_context'});await rpc({type:'status'});
});
test('upload RPC rejects malformed/oversized bytes before invoking the named native owner',async()=>{
 let writes=0;const app={assert:async()=>{},context:{mode:'local'}},runtime={controls:()=>({}),archives:()=>({local:{uploadChunk:async()=>{writes++;}}})};
 const id=crypto.randomUUID(),nonce=crypto.randomUUID();
 for(const base64 of ['','a','!!!!','A===','x'.repeat(349529)])await assert.rejects(controlCommand({type:'archive-upload-chunk',id,nonce,number:0,base64},runtime,app));
 assert.equal(writes,0);
 await controlCommand({type:'archive-upload-chunk',id,nonce,number:0,base64:btoa('synthetic')},runtime,app);assert.equal(writes,1);
});
test('archive recovery target is explicit even when recovering a browser from remote mode',async()=>{
 const calls=[],app={assert:async()=>{},context:{mode:'remote'}},id=crypto.randomUUID();
 const runtime={controls:()=>({}),archives:()=>({local:{restoreBegin:async(...args)=>{calls.push(['browser',...args]);return {};},restoreStep:async()=>({phase:'preview'})},
  recovery:{begin:async()=>{calls.push(['server']);return {};}}})};
 const data={type:'archive-import-begin',id,token:'synthetic-local-only',formerWritersRetired:true,acceptPostSnapshotEvidenceLoss:true,replaceInactiveLocalCopy:false};
 await assert.rejects(controlCommand(data,runtime,app),{code:'validation_error'});
 await controlCommand({...data,target:'browser'},runtime,app);assert.equal(calls[0][0],'browser');assert.equal(calls[0][2],'synthetic-local-only');
 await controlCommand({...data,target:'server'},runtime,app);assert.equal(calls[1][0],'server');
});


test('a delayed first status cannot overwrite a subsequently configured context',async()=>{
 const a=scope(),b={...scope(),credential_epoch:'2'};let current=a,release;
 const rpc=createRpc(async data=>{
  if(data.slow)return new Promise(resolve=>{release=()=>resolve({ok:true,context:{...a,operation_id:data.operation_id}});});
  if(data.type==='local-configure')current=b;
  return {ok:true,context:{...current,operation_id:data.operation_id}};
 });
 const first=rpc({type:'status',slow:true});await rpc({type:'status'});await rpc({type:'local-configure'});
 release();await assert.rejects(first,{code:'stale_context'});await rpc({type:'status'});
});
test('parallel replies in an unchanged established context remain valid',async()=>{
 const current=scope();let release;
 const rpc=createRpc(async data=>data.slow?new Promise(resolve=>{release=()=>resolve({ok:true,context:{...current,operation_id:data.operation_id}});})
  :{ok:true,context:{...current,operation_id:data.operation_id}});
 await rpc({type:'status'});const slow=rpc({type:'catalog',slow:true});await rpc({type:'storage-status'});release();await slow;
});

test('explicit snapshot retry invokes remote retry instead of polling a blocked task',async()=>{
 const id=crypto.randomUUID(),calls=[],app={assert:async()=>{}};
 const runtime={controls:()=>({}),archives:()=>({backup:{retry:async value=>{calls.push(value);return {state:'waiting'};}},local:{backupStep:async()=>({phase:'ready'})}})};
 assert.equal(message(command('archive-export-retry',{id,kind:'remote'}),'popup').type,'archive-export-retry');
 assert.deepEqual(await controlCommand({type:'archive-export-retry',id,kind:'remote'},runtime,app),{result:{state:'waiting'}});assert.deepEqual(calls,[id]);
 assert.deepEqual(await controlCommand({type:'archive-export-retry',id,kind:'local'},runtime,app),{result:{phase:'ready'}});
});
