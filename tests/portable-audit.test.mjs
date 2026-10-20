import assert from 'node:assert/strict';
import test from 'node:test';
import {validateAudit,validateRelations,legacyHeader,legacyCell} from '../.local/contracts/portable-format.mjs';

import {current,legacy,offset,reader} from './portable-fixture-reader.mjs';

test('actual Python current and converted-legacy graphs pass classified audit and original fingerprint',async()=>{
  for(const fixture of [current,legacy]){
    await validateRelations(reader(fixture.rows));
    await validateAudit(reader(fixture.rows),{dataset_id:fixture.dataset_id});
  }
});

test('archive audit cannot execute substituted SQL or accept rewritten legacy evidence',async()=>{
  for(const [kind,code]of [['sql','unclassified_legacy_object'],['columns','unclassified_legacy_column'],['bytes','invalid_legacy_audit'],
    ['counts','invalid_legacy_audit'],['backup','invalid_schema_audit'],['metadata','unclassified_metadata'],['secret','credential_material']]){
    const rows=structuredClone(legacy.rows);
    if(kind==='sql')rows.legacy_objects[0][offset('legacy_objects','sql')]=['text','DROP TABLE bank_transactions'];
    if(kind==='columns'){
      const row=rows.legacy_objects.find(row=>row[offset('legacy_objects','type')][1]==='table');row[offset('legacy_objects','columns_json')]=['text','[9007199254740993]'];
    }
    if(kind==='bytes'){const index=offset('legacy_rows','values_json');rows.legacy_rows[0][index][1]+=' ';}
    if(kind==='counts'){
      const index=offset('legacy_imports','manifest_json'),counts=JSON.parse(rows.legacy_imports[0][index][1]);
      counts.bank_transactions++;rows.legacy_imports[0][index]=['text',JSON.stringify(counts)];
    }
    if(kind==='backup')rows.source_schema_migrations[0][offset('source_schema_migrations','backup_path')]=['text','/private/synthetic-path'];
    if(kind==='metadata')rows.dataset_metadata.push([['text','unknown'],['text','synthetic']]);
    if(kind==='secret')rows.zen_entities[0][offset('zen_entities','data')]=['text','{"future":"\\ufeff{\\"token\\":\\"synthetic\\"}"}'];
    await assert.rejects(validateAudit(reader(rows),{dataset_id:legacy.dataset_id}),{code},kind);
  }
});

test('legacy header and numeric tags preserve Python ASCII packing and int semantics',()=>{
  assert.equal(legacyHeader(['é','😀',null]),'[["text","\\u00e9"],["text","\\ud83d\\ude00"],["null",null]]\n');
  assert.equal(legacyCell(['integer','9007199254740993']),9007199254740993n);
  assert.equal(legacyCell(['null',null]),null);assert.equal(legacyCell(['text','unchanged']),'unchanged');
  for(const cell of [['null',''],['integer','01'],['integer','-0'],['integer','1'.repeat(4301)],['real','0x1'],['text',3]])assert.throws(()=>legacyCell(cell));
});
