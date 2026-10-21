import assert from 'node:assert/strict';
import test from 'node:test';
import {outboxControl,outboxActive,readOutbox} from '../.local/contracts/outbox-control.mjs';
const control=()=>({id:'10000000-0000-4000-8000-000000000001',deadline:'1060',phase:'prepared',source:{generation:'fixture'},items:[{bank_id:'bank',zen_id:'zen',payload:'{}'}]});
test('private single-use dispatch metadata rejects malformed or unbounded batches',()=>{
  assert.deepEqual(outboxControl(control()),control());
  for(const changes of [{id:'bad'},{deadline:'-1'},{deadline:1000},{phase:'retry'},{source:null},{extra:true},{items:[]},{items:[...control().items,...control().items]},
    {items:Array.from({length:21},(_,i)=>({bank_id:'bank'+i,zen_id:'zen'+i,payload:'{}'}))},
    {items:[{bank_id:'bank',zen_id:'zen',payload:'x'.repeat(65537)}]}])assert.throws(()=>outboxControl({...control(),...changes}),{code:'storage_corrupt'});
});
test('expiry never grants a retry and private dispatch metadata cannot change generation',async()=>{
  assert.equal(outboxActive(control(),'1000'),true);assert.equal(outboxActive(control(),'1060'),false);
  assert.equal(outboxActive({...control(),phase:'settled'},'1000'),false);
  const db={applicationState:{get:async()=>({value:control()})}};
  await assert.rejects(readOutbox(db,'different'),{code:'storage_corrupt'});
});
