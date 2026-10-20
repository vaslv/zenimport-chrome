import assert from 'node:assert/strict';
import test from 'node:test';
import {validateMirror,LegacyFacts,financialJson,jsonEqual} from '../.local/contracts/portable-format.mjs';
import {current,legacy,offset,reader} from './portable-fixture-reader.mjs';

async function verify(fixture,rows=fixture.rows,owners=fixture.owner_ids){
  const data=reader(rows);await validateMirror(data,{zenmoney_identity:{owner_ids:owners}},await LegacyFacts.read(data));
}

test('current and converted legacy movement projections agree with original raw data and owner evidence',async()=>{
  for(const fixture of [current,legacy])await verify(fixture);
});

test('mirror proof rejects missing projections, changed exact amounts and substituted owner claims',async()=>{
  for(const [problem,code]of [['state','missing_mirror_context'],['projection','missing_mirror_projection'],['amount','invalid_mirror_projection'],
    ['identity','invalid_entity_identity'],['owner','declared_owner_mismatch']]){
    const rows=structuredClone(current.rows);
    if(problem==='state')rows.zen_mirror_state=[];
    if(problem==='projection')rows.zen_movements=[];
    if(problem==='amount')rows.zen_movements[0][offset('zen_movements','outcome')]=['text','999'];
    if(problem==='identity'){
      const row=rows.zen_entities.find(row=>row[offset('zen_entities','kind')][1]==='transaction'),index=offset('zen_entities','data'),value=JSON.parse(row[index][1]);
      value.id='substituted';row[index]=['text',JSON.stringify(value)];
    }
    await assert.rejects(verify(current,rows,problem==='owner'?['another']:current.owner_ids),{code},problem);
  }
});

test('legacy movement and category positions must have the same archived source proof',async()=>{
  const rows=structuredClone(legacy.rows);rows.zen_movements[0][offset('zen_movements','outcome')]=['text','999'];
  await assert.rejects(verify(legacy,rows),{code:'invalid_legacy_projection'});
  const tags=structuredClone(legacy.rows);tags.zen_tags[0][offset('zen_tags','position')]=['integer','10'];
  await assert.rejects(verify(legacy,tags),{code:'invalid_legacy_tags'});
});

test('new mirror projections retain Decimal quantum while category positions match the raw array',async()=>{
  const rows=structuredClone(current.rows),movement=rows.zen_movements[0];
  const entity=rows.zen_entities.find(row=>row[0][1]===movement[0][1]&&row[1][1]===movement[1][1]),index=offset('zen_entities','data');
  const raw=JSON.parse(entity[index][1]);raw.tag=['category-a'];raw.outcome='replace-exact-decimal';
  entity[index]=['text',JSON.stringify(raw).replace('"replace-exact-decimal"','1.00000000000000000001')];
  movement[offset('zen_movements','outcome')]=['text','1.00000000000000000001'];
  rows.zen_tags=[[movement[0],movement[1],['text','category-a'],['integer','0']]];
  await verify(current,rows);
  rows.zen_tags[0][offset('zen_tags','position')]=['integer','10'];
  await assert.rejects(verify(current,rows),{code:'invalid_mirror_tags'});
});

test('archived facts compare exact numbers and dictionaries without losing raw text or array order',()=>{
  assert.equal(jsonEqual(financialJson('{"a":9007199254740993,"b":1.00}'),financialJson('{"b":1,"a":9007199254740993}')),true);
  assert.equal(jsonEqual(financialJson('[1,2]'),financialJson('[2,1]')),false);
  assert.equal(jsonEqual(financialJson('1.00000000000000000001'),financialJson('1')),false);
});
