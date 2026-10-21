import test from 'node:test';
import assert from 'node:assert/strict';
import {message,assertMessageContext} from '../.local/contracts/application-messages.mjs';
import {createRpc} from '../.local/contracts/application-rpc.mjs';
const scope=()=>({dataset_id:crypto.randomUUID(),generation:crypto.randomUUID(),mode:'remote',mode_epoch:'1',credential_epoch:'1'});
test('message ownership and exact mode metadata reject forged contexts before a financial handler',()=>{
 assert.throws(()=>message({type:'configure',url:'https://safe.invalid',token:'synthetic'},'capture'),{code:'unauthorized'});
 for(const data of [null,[],{}, {type:'configure',url:0,token:[]},{type:'start',operation_id:'not-uuid'},{type:'status',context:{...scope(),token:'forbidden'}}])
  assert.throws(()=>message(data,'popup'),{code:'validation_error'});
 const context=scope(),data={type:'start',context};assert.equal(message(data,'popup'),data);
 assertMessageContext(context,{...context,operation_id:crypto.randomUUID()});
 assert.throws(()=>assertMessageContext(context,{...scope(),operation_id:crypto.randomUUID()}),{code:'stale_context'});
});
test('UI discards a late response from the old dataset after explicit configuration selects a new one',async()=>{
 const a=scope(),b=scope();let current=a,release;
 const rpc=createRpc(async data=>{
  if(data.type==='slow')return new Promise(resolve=>{release=()=>resolve({ok:true,context:{...a,operation_id:data.operation_id}});});
  return {ok:true,context:{...current,operation_id:data.operation_id}};
 });
 await rpc({type:'status'});const late=rpc({type:'slow'});current=b;await rpc({type:'configure'});release();
 await assert.rejects(late,{code:'stale_context'});
});
test('polling cannot adopt a different server underneath already rendered controls',async()=>{
 const a=scope(),b=scope();let current=a,last;
 const rpc=createRpc(async data=>{last=data;return {ok:true,context:{...current,operation_id:data.operation_id}};});
 await rpc({type:'status'});current=b;await assert.rejects(rpc({type:'status'}),{code:'stale_context'});
 await assert.rejects(rpc({type:'start',connectionId:'old'}),{code:'stale_context'});assert.deepEqual(last.context,a);
});
test('UI never accepts a reply under another operation ID',async()=>{
 const rpc=createRpc(async()=>({ok:true,context:{...scope(),operation_id:crypto.randomUUID()}}));
 await assert.rejects(rpc({type:'status'}),{code:'stale_context'});
});
