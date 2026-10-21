import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {canonicalParticipant,checkPeerReceipt,ParticipantError,RECEIPT_KEYS} from '../.local/contracts/control-participant-wire.mjs';

const vectors=JSON.parse(readFileSync('contracts/business/v1/participant-wire-vectors.json','utf8'));
test('receipt fields match the pinned HTTP protocol including explicit null keys',()=>{
  const contract=JSON.parse(readFileSync('contracts/business/v1/portable-http-v2.json','utf8'));
  assert.deepEqual([...RECEIPT_KEYS].sort(),[...contract.schemas.Receipt.required].sort());
});
test('protocol receipt integrity and exact string counters match every Python observation',()=>{
  for(const item of vectors.receipts){
    if(item.accepted){
      const result=checkPeerReceipt(item.value,item.command,item.local_id,item.operation??undefined);
      assert.deepEqual(result,item.value);assert.ok(Object.isFrozen(result));
    }else assert.throws(()=>checkPeerReceipt(item.value,item.command,item.local_id,item.operation??undefined),ParticipantError);
  }
});
test('protocol preimages match Python Unicode ordering, byte limits, depth and scalar rules',()=>{
  for(const item of vectors.canonical){
    if(item.hex===null)assert.throws(()=>canonicalParticipant(item.value),ParticipantError);
    else assert.equal(Buffer.from(canonicalParticipant(item.value)).toString('hex'),item.hex);
  }
});
test('non-JSON JavaScript shapes never become protocol hash preimages',()=>{
  const extra=[];extra.unexpected=true;const symbol={};symbol[Symbol('hidden')]='ignore';
  for(const value of [Array(1),extra,symbol,undefined,NaN,1n,new Date(),()=>{}])assert.throws(()=>canonicalParticipant(value),ParticipantError);
  const cyclic=[];cyclic.push(cyclic);assert.throws(()=>canonicalParticipant(cyclic),ParticipantError);
});
