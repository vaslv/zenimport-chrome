import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {checkResult,validateChecks} from '../.local/contracts/storage-checks.mjs';

const vectors=JSON.parse(readFileSync(new URL('../contracts/business/v1/sqlite-check-vectors.json',import.meta.url),'utf8')).vectors;

test('every packaged SQLite CHECK has an independent three-valued reference vector',()=>{
  const source=JSON.parse(readFileSync(new URL('../contracts/business/v1/sqlite-v7.json',import.meta.url),'utf8'));
  for(const [table,definition]of Object.entries(source.tables))for(const expression of definition.checks){
    const logical=table==='service_meta'?'dataset_metadata':table==='schema_migrations'?'source_schema_migrations':table==='account_capture_locks'?'source_capture_leases':table;
    assert.ok(vectors.some(vector=>vector.table===table && vector.expression===expression),logical+': '+expression);
  }
  assert.ok(vectors.length>2000);
});

test('CHECK evaluation matches real SQLite including NULL, Unicode and exact money',()=>{
  for(const vector of vectors){
    const table=vector.table==='service_meta'?'dataset_metadata':vector.table==='schema_migrations'?'source_schema_migrations':vector.table==='account_capture_locks'?'source_capture_leases':vector.table;
    assert.equal(checkResult(table,vector.expression,vector.fields),vector.expected,vector.table+': '+vector.expression+' case '+vector.case);
  }
});

test('the predicate engine rejects arbitrary or archived SQL',()=>{
  assert.throws(()=>checkResult('dataset_metadata','DROP TABLE bank_transactions',{}),/schema_unsupported/);
  assert.throws(()=>checkResult('__proto__','1',{}),/schema_unsupported/);
});

test('row checks reject invalid bank money before a database mutation',()=>{
  assert.throws(()=>validateChecks('bank_transactions',[
    ['text','id'],['text','account'],['text','reference'],['text','bank'],['text','1'],['text','2026-10-21'],['null'],
    ['text','expense'],['text','0'],['text','VND'],['text','description'],['null'],['null'],['text','{}'],['integer','1']
  ]),/constraint_violation/);
});
