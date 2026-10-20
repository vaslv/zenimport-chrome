import assert from 'node:assert/strict';
import test from 'node:test';
import {StorageError,storageFailure} from '../.local/contracts/storage-types.mjs';
import {stageRecord} from '../.local/contracts/storage-stage-types.mjs';

test('nested native quota and bulk errors expose only stable storage codes',()=>{
  const quota=new DOMException('sensitive-native-detail','QuotaExceededError');
  const aborted=Object.assign(new Error('private-abort'),{name:'AbortError',inner:quota});
  const bulk=Object.assign(new Error('private-bulk'),{name:'BulkError',failures:[new DOMException('private-key','ConstraintError'),aborted]});
  for(const error of [quota,aborted,bulk])assert.equal(storageFailure(error).message,'quota_exceeded');
  assert.equal(storageFailure(Object.assign(new Error('private'),{name:'BulkError',failures:[new DOMException('private','ConstraintError')]})).code,'constraint_violation');
  const cyclic=Object.assign(new Error('private'),{name:'AbortError'});cyclic.inner=cyclic;
  assert.equal(storageFailure(cyclic).code,'storage_corrupt');
  assert.equal(storageFailure(new StorageError('stale_epoch')).code,'stale_epoch');
});

const id='00000000-0000-4000-8000-000000000001';
const stage={id,writerId:id,installationId:id,routingEpoch:'1',state:'loading',manifest:'{}\n',
  archiveSha256:null,rowCount:'0',byteCount:'0',createdAt:'1792540800',errorCode:null};
test('staging metadata has exact shape and exact nonnegative counters',()=>{
  assert.equal(stageRecord(stage),stage);
  for(const patch of [{extra:'not-allowed'},{routingEpoch:'0'},{routingEpoch:1},{rowCount:'-1'},
    {byteCount:'268435457'},{rowCount:'01'},{createdAt:'9223372036854775808'},
    {manifest:'😀'.repeat(20000)},{writerId:'invalid'},{state:'activated'},{errorCode:'private error text'}]){
    assert.throws(()=>stageRecord({...stage,...patch}),error=>error.code==='storage_corrupt');
  }
});
test('format completion needs a hash while failed staging needs a redacted reason',()=>{
  assert.throws(()=>stageRecord({...stage,state:'format_valid'}),/storage_corrupt/);
  assert.equal(stageRecord({...stage,state:'format_valid',archiveSha256:'0'.repeat(64)}).state,'format_valid');
  assert.throws(()=>stageRecord({...stage,state:'failed'}),/storage_corrupt/);
  assert.equal(stageRecord({...stage,state:'failed',errorCode:'quota_exceeded'}).errorCode,'quota_exceeded');
});
