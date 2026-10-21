import assert from 'node:assert/strict';
import test from 'node:test';
import {categoryControl,categoriesReady} from '../.local/contracts/category-control.mjs';
const stamp={generation:'fixture'};
const control=()=>({id:'10000000-0000-4000-8000-000000000001',state:'ready',source:stamp,counts:{category_evidence:0,category_payments:0,category_predictions:1}});
test('private category publication rejects malformed actor, state and counts',()=>{
  assert.deepEqual(categoryControl(control()),control());
  for(const changes of [{id:'------------------------------------'},{state:'finished'},{source:null},{extra:true},
    {counts:{category_evidence:-1,category_payments:0,category_predictions:1}},
    {counts:{category_evidence:0,category_payments:0,category_predictions:1000001}},
    {counts:{category_evidence:0,category_payments:0,category_predictions:0.5}}])assert.throws(()=>categoryControl({...control(),...changes}));
});
test('only a ready marker for exactly the current financial source opens predictions',async()=>{
  for(const [value,expected] of [[undefined,false],[{...control(),state:'building'},false],[control(),true],[{...control(),source:{generation:'other'}},false]]){
    const db={applicationState:{get:async()=>value===undefined?undefined:{value}}};assert.equal(await categoriesReady(db,stamp),expected);
  }
});
