import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {archiveJson,financialJson,metadataValue,pythonDecimalText,mirrorAmountText,mirrorFlagText,decodeGraphJson,GraphDecimal} from '../.local/contracts/portable-format.mjs';

const vectors=JSON.parse(readFileSync('contracts/business/v1/archive-value-vectors.json','utf8'));
function observe(operation){try{return {accepted:true,value:operation()};}catch(error){return {accepted:false,code:error.code};}}
function compare(actual,expected,label){
  assert.equal(actual.accepted,expected.accepted,label);
  if(Object.hasOwn(expected,'value'))assert.equal(actual.value,expected.value,label);
  if(Object.hasOwn(expected,'code'))assert.equal(actual.code,expected.code,label);
}

test('financial JSON screening matches actual Python across nested credentials and Unicode boundaries',()=>{
  for(const [i,vector]of vectors.screening.entries())compare(observe(()=>financialJson(vector.raw)),vector.expected,'screening '+i);
  const data=financialJson('{"id":9007199254740993,"amount":1.00000000000000000001}');
  assert.equal(data.id,9007199254740993n);assert.equal(data.amount.toString(),'1.00000000000000000001');
});

test('every classified metadata field matches the independent Python expectations',()=>{
  for(const [i,vector]of vectors.metadata.entries())compare(observe(()=>metadataValue(vector.key,vector.value,vectors.dataset_id)),vector.expected,'metadata '+i);
});

test('a 16 MiB invalid identifier is rejected within a 128 MiB JavaScript heap',()=>{
  const result=spawnSync(process.execPath,['--max-old-space-size=128','scripts/portable-values-budget.mjs'],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr);
});

test('native archive JSON recovers every exact numeric token without trusting Number',()=>{
  const value=archiveJson('[9007199254740993,-9007199254740993,1e9999,1e-9999,1.00,-0.0,1e9007199254740993]');
  assert.equal(value[0],9007199254740993n);assert.equal(value[1],-9007199254740993n);
  assert.deepEqual(value.slice(2).map(item=>item.toString()),['1e9999','1e-9999','1.00','-0.0','1e9007199254740993']);
  assert.equal(archiveJson('9007199254740991'),Number.MAX_SAFE_INTEGER);
  const object=archiveJson('{"__proto__":{"safe":true}}');
  assert.equal(Object.getPrototypeOf(object),Object.prototype);assert.equal(Object.hasOwn(object,'__proto__'),true);
  assert.equal({}.safe,undefined);
});

test('archive JSON rejects duplicates, malformed Unicode, excessive nesting and noncanonical numeric cells',()=>{
  for(const raw of ['{"a":1,"\\u0061":1}','{"__proto__":1,"__proto__":1}','"\\ud800"','{"\\udfff":0}',
    '[1,]','01','NaN','Infinity','true false','{"x" 1}','['.repeat(129)+']'.repeat(129),'1'.repeat(4097),'\ufeff{}']){
    assert.throws(()=>archiveJson(raw),undefined,raw.slice(0,30));
  }
  for(const raw of ['1.0','1e0'])assert.throws(()=>archiveJson(raw,true));
  assert.deepEqual(archiveJson('[null,true,false,"a\\u0000b","\\ud83d\\ude00"]'),[null,true,false,'a\0b','😀']);
  const original=JSON.parse;
  try{JSON.parse=(text,reviver)=>original(text,(key,value)=>reviver(key,value));assert.throws(()=>archiveJson('9007199254740993'),/missing_numeric_source/);}
  finally{JSON.parse=original;}
});

test('mirror decimal TEXT retains Python Decimal quantum, sign and scientific notation',()=>{
  for(const vector of vectors.decimals)assert.equal(pythonDecimalText(new GraphDecimal(vector.token)),vector.expected,vector.token);
});

test('mirror amounts and flags never coerce strings, decimal flags or booleans into money',()=>{
  for(const [method,rows]of [[mirrorAmountText,vectors.amounts],[mirrorFlagText,vectors.flags]]){
    for(const vector of rows)compare(observe(()=>method(decodeGraphJson(vector.raw))),vector.expected,'mirror '+vector.raw);
  }
});
