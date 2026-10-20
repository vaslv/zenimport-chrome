import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {bankRecord,timestampProjection,legacyOccurred,canonicalDto,canonicalStoredDto,digest,utf8} from '../.local/contracts/portable-format.mjs';

const vectors=JSON.parse(readFileSync('contracts/business/v1/bank-record-vectors.json','utf8'));

test('bank wire normalization matches every actual Python model observation',()=>{
  for(const [index,vector]of vectors.records.entries()){
    let actual;try{actual={accepted:true,value:JSON.parse(JSON.stringify(bankRecord(vector.input)))};}catch{actual={accepted:false};}
    assert.deepEqual(actual,vector.expected,'record '+index);
  }
});

test('aware timestamp comparisons retain individual microseconds and explicit offsets',()=>{
  for(const vector of vectors.timestamp_pairs)assert.equal(timestampProjection(vector.left).micros===timestampProjection(vector.right).micros,vector.equal,JSON.stringify(vector));
});

test('legacy clock projection follows actual Vietnam offsets and reference parsing without source edits',()=>{
  for(const vector of vectors.legacy_timestamps)assert.equal(legacyOccurred(vector.raw,vector.bank,vector.local_date),vector.expected,JSON.stringify(vector));
});

test('valid wire-sized Unicode capture retains the larger stored ASCII projection under the row budget',()=>{
  const vector=vectors.wide_capture;
  const input={worker_id:'00000000-0000-4000-8000-000000000000',lease_epoch:1,page_number:1,total_pages:1,total_records:vector.count,
    records:Array.from({length:vector.count},(_,i)=>({...vector.record_base,external_id:'wide-'+i,description:vector.description.repeat(vector.repeat)}))};
  const wire=utf8.encode(JSON.stringify(input));assert.equal(wire.length,vector.wire_bytes);assert.ok(wire.length<2000000);
  const stored={page_number:1,total_pages:1,total_records:vector.count,records:input.records.map(bankRecord)};
  assert.throws(()=>canonicalDto(stored),/invalid_dto/); // Ordinary DTO limit stays frozen.
  const output=utf8.encode(canonicalStoredDto(stored));assert.equal(output.length,vector.stored_bytes);assert.equal(digest(output),vector.stored_sha256);
});
