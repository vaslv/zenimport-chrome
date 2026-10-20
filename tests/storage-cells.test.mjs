import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {encodeKey,packRow,rowKey,unpackRow,validateCells} from '../.local/contracts/storage-cells.mjs';

const root=new URL('../contracts/business/v1/',import.meta.url);
const load=name=>JSON.parse(readFileSync(new URL(name,root),'utf8'));

test('all 49 column cohorts preserve required/null shape without claiming graph validity',()=>{
  const schema=load('sqlite-v7.json'),policy=load('portable-policy.json');
  for(const [name,mapping]of Object.entries(policy.logical_tables)){
    const columns=schema.tables[mapping.source].columns;
    const fields=Object.fromEntries(columns.map(column=>[column.name,column.logical_required?(column.type==='INTEGER'?'0':'text'):null]));
    assert.deepEqual(unpackRow(name,packRow(name,fields)),fields,name);
    const missing={...fields};delete missing[columns[0].name];
    assert.throws(()=>packRow(name,missing),/invalid_row/);
    assert.throws(()=>packRow(name,{...fields,unexpected:'private-value'}),/invalid_row/);
  }
});

test('portable golden scalar rows roundtrip exactly including integers above Number precision',()=>{
  const golden=load('portable-golden-v2.json');
  for(const [table,rows]of Object.entries(golden.rows))for(const row of rows){
    assert.deepEqual(packRow(table,unpackRow(table,row)),row);
    assert.deepEqual(validateCells(table,row),row);
  }
});

test('signed 64-bit keys order MIN, negatives, zero and MAX without Number conversion',()=>{
  const values=['-9223372036854775808','-9007199254740993','-10','-1','0','1','2','10','9007199254740993','9223372036854775807'];
  const keys=values.map(value=>rowKey('source_schema_migrations',[['integer',value],['integer','0'],['null']]));
  assert.deepEqual([...keys].sort(),keys);
  assert.equal(new Set(keys).size,values.length);
});

test('IDB ASCII keys preserve UTF-8 tuple order rather than JavaScript UTF-16 order',()=>{
  const values=['','\0','a','a\0','a/b','a/b\0','café','\ue000','\uffff','😀','\u{10ffff}'];
  const expected=[...values].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
  // Use ordinary ASCII key comparison: locale collation is never an IDB rule.
  const ordered=[...values].sort((a,b)=>{const x=encodeKey([['text',a]]),y=encodeKey([['text',b]]);return x<y?-1:x>y?1:0;});
  assert.deepEqual(ordered,expected);
  assert.notEqual(encodeKey([['text','a'],['text','/b']]),encodeKey([['text','a/'],['text','b']]));
});

for(const value of ['-0','01','1.0','1e3','9223372036854775808','-9223372036854775809',9007199254740992,true]){
  test('invalid integer scalar fails without exposing its value: '+String(value),()=>{
    assert.throws(()=>validateCells('source_schema_migrations',[['integer',value],['integer','0'],['null']]),error=>error.message==='invalid_row');
  });
}

test('null primary keys, malformed cell tags, holes and lone surrogates fail closed',()=>{
  for(const input of [[['null'],['text','value']],[['text','id','extra'],['text','value']],[['blob','eA=='],['text','value']],[['text','id'],['text','\ud800']]]){
    assert.throws(()=>validateCells('dataset_metadata',input),/invalid_row/);
  }
  const sparse=Array(2);sparse[0]=['text','id'];
  assert.throws(()=>validateCells('dataset_metadata',sparse),/invalid_row/);
});

test('raw JSON stays opaque exact text and is not narrowed by the cell codec',()=>{
  const raw='{"id":9007199254740993,"amount":0.123456789012345678901,"note":"\\ud800"}';
  const row=[['text','future.raw'],['text',raw]];
  assert.deepEqual(validateCells('dataset_metadata',row),row);
  assert.equal(unpackRow('dataset_metadata',row).value,raw);
});
