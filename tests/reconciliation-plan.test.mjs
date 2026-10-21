import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceGroups} from '../.local/contracts/reconciliation-plan.mjs';
test('oversized imported Cartesian ownership is rejected before materializing pairs',()=>{
  const rows={link_groups:[{id:'g',kind:'settlement'}],link_bank_members:Array.from({length:1001},(_,i)=>({group_id:'g',bank_id:'b'+i})),link_zen_members:Array.from({length:1000},(_,i)=>({group_id:'g',zen_id:'z'+i}))};
  assert.throws(()=>sourceGroups({rows}),error=>error.code==='unsupported_scenario');
});

test('a hundred thousand unchanged terminal identities emit no timestamp-only writes',async()=>{
  const {knownReconciliation}=await import('../.local/contracts/reconciliation-known.mjs');
  const size=100000,processing=Array.from({length:size},(_,i)=>({bank_id:'b'+i,state:'delivered',reason:'zenmoney_exists',updated_at:'1'}));
  const receipts=processing.map((row,i)=>({bank_id:row.bank_id,zen_id:'z'+i,origin:'mirror_exists',at:'1'}));
  const rows={bank_processing:processing,processing_receipts:receipts,deliveries:[],delivery_attempts:[],zen_tombstones:[],link_groups:[],link_bank_members:[],link_zen_members:[]};
  const facts={blockingTransactions:new Map(receipts.map(row=>[row.zen_id,{id:row.zen_id}]))};
  const started=performance.now();assert.deepEqual(knownReconciliation({rows},facts,'2'),[]);assert.ok(performance.now()-started<10000);
  assert.equal(processing[0].updated_at,'1');
});
