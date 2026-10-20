import assert from 'node:assert/strict';
import test from 'node:test';
import {validateRecords,LegacyFacts} from '../.local/contracts/portable-format.mjs';
import {current,legacy,offset,reader} from './portable-fixture-reader.mjs';

async function verify(fixture,rows=fixture.rows){const view=reader(rows);return validateRecords(view,await LegacyFacts.read(view));}

test('current and converted legacy bank facts retain complete raw revisions and account frontiers',async()=>{
  for(const fixture of [current,legacy]){
    const facts=await verify(fixture);assert.equal(facts.banks.size,fixture.rows.bank_transactions.length);
    assert.equal(facts.versions.size,fixture.rows.bank_versions.length);
  }
});

test('raw current fields, versions and aliases cannot be changed behind matching archive hashes',async()=>{
  for(const [problem,code]of [['processing','missing_processing_state'],['version','invalid_current_revision'],['revision_projection','invalid_revision_projection'],
    ['gap','incomplete_revision_history'],['alias','missing_bank_alias'],['amount','bank_raw_mismatch'],['microsecond','bank_raw_mismatch'],['frontier','invalid_coverage_frontier']]){
    const rows=structuredClone(current.rows);
    if(problem==='processing')rows.bank_processing=[];
    if(problem==='version')rows.bank_versions=[];
    if(problem==='revision_projection')rows.bank_versions[0][offset('bank_versions','data_json')]=['text','{}'];
    if(problem==='gap')rows.bank_versions[0][offset('bank_versions','revision')]=['integer','3'];
    if(problem==='alias')rows.bank_aliases=[];
    if(problem==='amount')rows.bank_transactions[0][offset('bank_transactions','amount')]=['text','999'];
    if(problem==='microsecond'){
      const index=offset('bank_transactions','occurred_at');rows.bank_transactions[0][index][1]=rows.bank_transactions[0][index][1].replace(/(Z|[+-][0-9]{2}:[0-9]{2})$/,'.000001$1');
    }
    if(problem==='frontier')rows.bank_accounts[0][offset('bank_accounts','last_complete_end')]=['text','2026-01-01'];
    await assert.rejects(verify(current,rows),{code},problem);
  }
});

test('raw record dictionary ordering and equivalent offset timestamps do not rewrite bank evidence',async()=>{
  const rows=structuredClone(current.rows),index=offset('bank_transactions','occurred_at'),original=rows.bank_transactions[0][index][1];
  const utc=new Date(original).toISOString().replace('.000','');rows.bank_transactions[0][index]=['text',utc];
  await verify(current,rows);
  assert.equal(rows.bank_transactions[0][index][1],utc);
});

test('legacy projections remain bound to the original classified bank rows',async()=>{
  const rows=structuredClone(legacy.rows);rows.bank_transactions[0][offset('bank_transactions','description')]=['text','changed'];
  await assert.rejects(verify(legacy,rows),{code:'invalid_legacy_bank_projection'});
  const version=structuredClone(legacy.rows);version.bank_versions[0][offset('bank_versions','data_json')]=['text','{}'];
  await assert.rejects(verify(legacy,version),{code:'invalid_legacy_proof'});
});
