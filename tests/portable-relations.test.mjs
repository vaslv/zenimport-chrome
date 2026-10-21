import assert from 'node:assert/strict';
import test from 'node:test';
import {validateRelations} from '../.local/contracts/portable-format.mjs';

import {current as fixture,definitions,offset,reader} from './portable-fixture-reader.mjs';

test('complete captured and attempted Python fixture passes every native logical relationship',async()=>{
  const result=await validateRelations(reader(fixture.rows));
  assert.deepEqual(result,Object.fromEntries(Object.entries(fixture.rows).map(([name,rows])=>[name,String(rows.length)])));
});

test('every populated foreign-key cohort fails on a missing parent, including composite keys',async()=>{
  let tested=0;
  for(const [name,definition]of Object.entries(definitions)){
    const groups=Object.groupBy(definition.foreign_keys,value=>value.id);
    for(const parts of Object.values(groups)){
      const original=fixture.rows[name].find(row=>parts.every(part=>row[offset(name,part.from)][0]!=='null'));
      if(!original)continue;
      const rows=structuredClone(fixture.rows),index=fixture.rows[name].indexOf(original),column=offset(name,parts[0].from),cell=rows[name][index][column];
      rows[name][index][column]=[cell[0],cell[0]==='integer'?'9223372036854775807':'missing-parent'];
      await assert.rejects(validateRelations(reader(rows)),undefined,name+' FK '+parts[0].id);tested++;
    }
  }
  assert.ok(tested>=30,'representative real fixture must exercise its populated references');
});

test('all packaged insert proofs are rechecked after loading, irrespective of table order',async()=>{
  for(const [table,column]of [['capture_intervals','settings_version'],['delivery_authorizations','settings_version'],['delivery_authorizations','target_id']]){
    const rows=structuredClone(fixture.rows),index=offset(table,column),cell=rows[table][0][index];
    rows[table][0][index]=[cell[0],cell[0]==='integer'?String(BigInt(cell[1])+1n):'wrong-target'];
    await assert.rejects(validateRelations(reader(rows)),{code:'invalid_insert_proof'});
  }
  const rows=structuredClone(fixture.rows),account=structuredClone(rows.bank_accounts[0]),old=account[offset('bank_accounts','id')][1];
  account[offset('bank_accounts','id')]=['text','second-account'];account[offset('bank_accounts','source_key')]=['text','second-source'];
  rows.bank_accounts.push(account);
  const snapshot=structuredClone(rows.job_accounts[0]);snapshot[offset('job_accounts','account_id')]=['text','second-account'];rows.job_accounts.push(snapshot);
  for(const row of rows.capture_intervals)if(row[offset('capture_intervals','account_id')][1]===old)row[offset('capture_intervals','account_id')]=['text','second-account'];
  await assert.rejects(validateRelations(reader(rows)),{code:'invalid_insert_proof'});
});

test('relational checks enforce native uniqueness and CHECKs without accepting source authority',async()=>{
  const rows=structuredClone(fixture.rows);rows.zen_entities.push(structuredClone(rows.zen_entities[0]));
  await assert.rejects(validateRelations(reader(rows)),{code:'duplicate_or_unordered_key'});
  const invalid=structuredClone(fixture.rows);invalid.bank_transactions[0][offset('bank_transactions','amount')]=['text','-1'];
  await assert.rejects(validateRelations(reader(invalid)));
  // A relationally sound graph may still have invalid raw financial projections.
  const inconsistent=structuredClone(fixture.rows);inconsistent.bank_transactions[0][offset('bank_transactions','amount')]=['text','999'];
  await validateRelations(reader(inconsistent));
});

test('immutable repeated parent facts are bounded to one lookup per proof run without hiding a new missing key',async()=>{
  const rows=structuredClone(fixture.rows),base=rows.zen_entities.find(row=>row[offset('zen_entities','run_id')][0]!=='null');
  assert.ok(base);
  for(let i=0;i<2000;i++){
    const row=structuredClone(base);row[offset('zen_entities','kind')]=['text','merchant'];
    row[offset('zen_entities','id')]=['text','cache-'+String(i).padStart(5,'0')];rows.zen_entities.push(row);
  }
  const source=reader(rows),calls=new Map(),counted={...source,async find(table,columns,values){
    if(table==='zen_sync_runs'){const key=JSON.stringify(values);calls.set(key,(calls.get(key)??0)+1);}
    return source.find(table,columns,values);
  }};
  const key=JSON.stringify([base[offset('zen_entities','run_id')]]);
  await validateRelations(counted);assert.equal(calls.get(key),1);
  await validateRelations(counted);assert.equal(calls.get(key),2,'a later proof has no retained facts cache');
  rows.zen_entities.at(-1)[offset('zen_entities','run_id')]=['text','missing-new-parent'];
  await assert.rejects(validateRelations(counted),{code:'invalid_relationship'});
});
