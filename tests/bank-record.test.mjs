import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {bankRecord,timestampProjection,legacyOccurred} from '../.local/contracts/portable-format.mjs';

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
