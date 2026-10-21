import assert from 'node:assert/strict';
import test from 'node:test';
import {authorizationTask} from '../.local/contracts/authorization-queue.mjs';
test('private queued authorization metadata has exact identities and integer time',()=>{
  const task={id:'10000000-0000-4000-8000-000000000001',jobId:'20000000-0000-4000-8000-000000000001',at:'1000'};
  assert.deepEqual(authorizationTask(task),task);
  for(const change of [{id:'bad'},{jobId:'bad'},{at:'-1'},{at:1000},{at:'9223372036854775808'},{extra:true}])assert.throws(()=>authorizationTask({...task,...change}),{code:'storage_corrupt'});
});
