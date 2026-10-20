import assert from 'node:assert/strict';
import test from 'node:test';
import {validateCapture,validateRecords,LegacyFacts,createArchive,validateFinancialGraph,digest,utf8,canonicalStoredDto} from '../.local/contracts/portable-format.mjs';
import {current,legacy,offset,reader} from './portable-fixture-reader.mjs';

async function verify(fixture,rows=fixture.rows){const view=reader(rows);await validateCapture(view,await validateRecords(view,await LegacyFacts.read(view)));}
async function manifest(fixture,rows=fixture.rows){
  return (await createArchive({datasetId:fixture.dataset_id,ownerIds:fixture.owner_ids,sessionId:'00000000-0000-4000-8000-000000000002',
    archiveId:'00000000-0000-4000-8000-000000000003',createdAt:'2026-10-20T00:00:00Z',version:'financial-graph-only'},
    async function*(name){yield* rows[name];},{async write(){}})).manifest;
}

test('complete current and legacy captures have a full independent archived-facts proof',async()=>{
  for(const fixture of [current,legacy]){
    await verify(fixture);
    const result=await validateFinancialGraph(reader(fixture.rows),await manifest(fixture),fixture.owner_ids);
    assert.equal(result.datasetDigest,fixture.expected_digest);assert.deepEqual(result.declaredOwners,fixture.owner_ids);
    assert.deepEqual(result.counts,Object.fromEntries(Object.entries(fixture.rows).map(([name,rows])=>[name,String(rows.length)])));
  }
});

test('pages, requests and complete coverage cannot be forged by rehashing the outer archive',async()=>{
  for(const [problem,code]of [['page_digest','invalid_page_digest'],['page_records','invalid_page_evidence'],['captured','invalid_captured_revision'],
    ['records_count','invalid_page_evidence'],['job_request','missing_job_request'],['job_context','missing_job_context'],
    ['job_state','invalid_capture_state'],['job_lease','executable_source_lease'],['coverage','invalid_coverage'],['huge_pages','incomplete_coverage']]){
    const rows=structuredClone(current.rows);
    if(problem==='page_digest')rows.capture_pages[0][offset('capture_pages','digest')]=['text','0'.repeat(64)];
    if(problem==='page_records'){
      const index=offset('capture_pages','payload_json'),payload=JSON.parse(rows.capture_pages[0][index][1]);payload.page_number=0;
      const raw=JSON.stringify(payload);rows.capture_pages[0][index]=['text',raw];rows.capture_pages[0][offset('capture_pages','digest')]=['text',digest(utf8.encode(raw))];
    }
    if(problem==='captured')rows.captured_records.pop();
    if(problem==='records_count')rows.capture_pages[0][offset('capture_pages','records_count')]=['integer','999'];
    if(problem==='job_request')rows.job_requests=[];
    if(problem==='job_context')rows.job_context=[];
    if(problem==='job_state')rows.capture_jobs[0][offset('capture_jobs','capture_state')]=['text','complete'];
    if(problem==='job_lease')rows.capture_jobs[0][offset('capture_jobs','worker_id')]=['text','unused-worker'];
    if(problem==='coverage')rows.coverage[0][offset('coverage','start_date')]=['text','2026-01-01'];
    if(problem==='huge_pages'){
      const copy=structuredClone(rows.capture_intervals.find(row=>row[offset('capture_intervals','state')][1]==='complete'));
      copy[offset('capture_intervals','id')]=['text','ffffffff-ffff-4fff-8fff-ffffffffffff'];copy[offset('capture_intervals','total_pages')]=['integer','9223372036854775807'];
      rows.capture_intervals.push(copy);
    }
    await assert.rejects(verify(current,rows),{code},problem);
  }
});

test('an archived owner claim does not replace a separately expected destination identity',async()=>{
  await assert.rejects(validateFinancialGraph(reader(current.rows),await manifest(current),['another']),{code:'destination_owner_mismatch'});
});

test('complete graph proof verifies every exact table descriptor even with an alternative read adapter',async()=>{
  const changed=structuredClone(current.rows),index=offset('source_schema_migrations','applied_at');
  changed.source_schema_migrations[0][index]=['integer',String(BigInt(changed.source_schema_migrations[0][index][1])+1n)];
  await assert.rejects(validateFinancialGraph(reader(changed),await manifest(current)),{code:'table_integrity_mismatch'});
});

test('captured evidence compares validated record values across dictionary and offset spellings',async()=>{
  const rows=structuredClone(current.rows),page=rows.capture_pages[0],payloadIndex=offset('capture_pages','payload_json'),payload=JSON.parse(page[payloadIndex][1]);
  const record=payload.records[0];record.details={remark:'Fixture',currency:'VND'};
  const bank=rows.bank_transactions.find(row=>row[offset('bank_transactions','external_id')][1]===record.external_id),bankId=bank[0][1];
  const original={...record,occurred_at:new Date(record.occurred_at).toISOString().replace('.000','')},raw=JSON.stringify(original);
  bank[offset('bank_transactions','raw_json')]=['text',raw];
  for(const version of rows.bank_versions)if(version[0][1]===bankId){version[offset('bank_versions','raw_json')]=['text',raw];version[offset('bank_versions','data_json')]=['text',raw];}
  function rehash(){const raw=canonicalStoredDto(payload);page[payloadIndex]=['text',raw];page[offset('capture_pages','digest')]=['text',digest(utf8.encode(raw))];}
  rehash();await verify(current,rows);
  await validateFinancialGraph(reader(rows),await manifest(current,rows),current.owner_ids);
  record.description='Substituted description';rehash();
  await assert.rejects(verify(current,rows),{code:'invalid_captured_revision'});
});
