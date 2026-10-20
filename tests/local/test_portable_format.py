"""Golden format roundtrip through bundled SDK/hash/ZIP code under native MV3 CSP."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from test_runtime import installed


def test_native_bundled_portable_codec_preserves_exact_golden_tables_without_workers(tmp_path):
    golden=json.loads(Path('/app/contracts/business/v1/portable-golden-v2.json').read_text())
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        result=worker.evaluate('''async golden=>{
          const parts=[];let extraWorkers=0;
          globalThis.Worker=class{constructor(){extraWorkers++;throw Error('Worker forbidden in format probe');}};
          const output=await portableProbe.createArchive({datasetId:golden.dataset_id,ownerIds:golden.owner_ids,
            archiveId:'00000000-0000-4000-8000-000000000003',sessionId:'00000000-0000-4000-8000-000000000002',
            createdAt:'2026-10-20T00:00:00.000Z',version:'format-only'},async function*(name){yield* golden.rows[name];},
            {async write(bytes){parts.push(bytes);}});
          const rows=Object.fromEntries(portableProbe.TABLES.map(name=>[name,[]]));
          const input=await portableProbe.readArchive(new Blob(parts),{async manifest(){},async row(name,row){rows[name].push(row);}});
          return {rows,digest:input.manifest.dataset_digest,archiveSha:input.archiveSha256,
            originalSha:output.archiveSha256,extraWorkers,tables:input.manifest.tables};
        }''',golden)
        assert result['digest']==golden['expected_digest']
        assert result['rows']==golden['rows'] and result['tables']==golden['expected_tables']
        assert result['archiveSha']==result['originalSha'] and result['extraWorkers']==0


def test_native_archive_screening_and_decimal_rules_match_the_python_vectors(tmp_path):
    vectors=json.loads(Path('/app/contracts/business/v1/archive-value-vectors.json').read_text())
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        result=worker.evaluate('''vectors=>{
          let count=0;
          function check(operation,expected){
            let actual;try{actual={accepted:true,value:operation()};}catch(error){actual={accepted:false,code:error.code};}
            if(actual.accepted!==expected.accepted||('code' in expected&&actual.code!==expected.code)||
                ('value' in expected&&actual.value!==expected.value))throw Error('archive-value-mismatch-'+count);
            count++;
          }
          for(const item of vectors.screening)check(()=>portableProbe.financialJson(item.raw),item.expected);
          for(const item of vectors.metadata)check(()=>portableProbe.metadataValue(item.key,item.value,vectors.dataset_id),item.expected);
          for(const item of vectors.decimals)check(()=>portableProbe.pythonDecimalText(new portableProbe.GraphDecimal(item.token)),{accepted:true,value:item.expected});
          for(const item of vectors.amounts)check(()=>portableProbe.mirrorAmountText(portableProbe.decodeGraphJson(item.raw)),item.expected);
          for(const item of vectors.flags)check(()=>portableProbe.mirrorFlagText(portableProbe.decodeGraphJson(item.raw)),item.expected);
          const exact=portableProbe.financialJson('{"id":9007199254740993,"amount":1.00000000000000000001}');
          return {count,id:exact.id.toString(),amount:exact.amount.toString()};
        }''',vectors)
        assert result==dict(count=sum(len(vectors[key]) for key in ('screening','metadata','decimals','amounts','flags')),
                           id='9007199254740993',amount='1.00000000000000000001')


def test_native_archive_row_boundary_uses_exact_numeric_sources_and_bounded_string_memory(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        result=worker.evaluate('''()=>{
          const limit=portableProbe.LIMITS.row_bytes;
          const prefix='[["text","boundary"],["text","',suffix='"]]\\n';
          const bytes=new TextEncoder().encode(prefix+'x'.repeat(limit-prefix.length-suffix.length)+suffix);
          const parsed=portableProbe.parseJson(bytes);
          const result=portableProbe.rowBytes('dataset_metadata',parsed);
          const exact=portableProbe.archiveJson('[9007199254740993,1e9999,-0.0,1.00000000000000000001]');
          let failure;try{portableProbe.archiveJson('{"a":1,"\\\\u0061":1}');}catch{failure=true;}
          return {bytes:result.bytes.length,length:parsed[1][1].length,overhead:prefix.length+suffix.length,limit,
            exact:exact.map(value=>value.toString()),duplicateRejected:failure===true};
        }''')
        assert result['bytes']==result['limit']==128*1024*1024
        assert result['length']==result['limit']-result['overhead']
        assert result['exact']==['9007199254740993','1e9999','-0.0','1.00000000000000000001']
        assert result['duplicateRejected']


def test_native_bank_model_and_legacy_clock_follow_actual_python_observations(tmp_path):
    vectors=json.loads(Path('/app/contracts/business/v1/bank-record-vectors.json').read_text())
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        count=worker.evaluate('''vectors=>{
          let count=0;
          for(const vector of vectors.records){
            let actual;try{actual={accepted:true,value:portableProbe.bankRecord(vector.input)};}catch{actual={accepted:false};}
            if(JSON.stringify(actual)!==JSON.stringify(vector.expected))throw Error('bank-model-'+count);count++;
          }
          for(const vector of vectors.timestamp_pairs){
            if((portableProbe.timestampProjection(vector.left).micros===portableProbe.timestampProjection(vector.right).micros)!==vector.equal)throw Error('timestamp-'+count);count++;
          }
          for(const vector of vectors.legacy_timestamps){
            if(portableProbe.legacyOccurred(vector.raw,vector.bank,vector.local_date)!==vector.expected)throw Error('legacy-time-'+count);count++;
          }
          return count;
        }''',vectors)
        assert count==sum(len(vectors[key]) for key in ('records','timestamp_pairs','legacy_timestamps'))


def test_native_stored_capture_keeps_unicode_ascii_expansion_separate_from_wire_limit(tmp_path):
    vector=json.loads(Path('/app/contracts/business/v1/bank-record-vectors.json').read_text())['wide_capture']
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        result=worker.evaluate('''vector=>{
          const raw={worker_id:'00000000-0000-4000-8000-000000000000',lease_epoch:1,page_number:1,total_pages:1,total_records:vector.count,
            records:Array.from({length:vector.count},(_,i)=>({...vector.record_base,external_id:'wide-'+i,description:vector.description.repeat(vector.repeat)}))};
          const value={page_number:1,total_pages:1,total_records:vector.count,records:raw.records.map(portableProbe.bankRecord)};
          let wireGuard=false;try{portableProbe.canonicalDto(value);}catch{wireGuard=true;}
          const bytes=portableProbe.utf8.encode(portableProbe.canonicalStoredDto(value));
          return {wire:portableProbe.utf8.encode(JSON.stringify(raw)).length,stored:bytes.length,hash:portableProbe.digest(bytes),wireGuard};
        }''',vector)
        assert result==dict(wire=vector['wire_bytes'],stored=vector['stored_bytes'],hash=vector['stored_sha256'],wireGuard=True)
