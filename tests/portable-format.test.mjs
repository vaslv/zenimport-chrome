import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Zip,ZipPassThrough} from 'fflate';
import {TABLES,LIMITS,TableScanner,canonical,createArchive,readArchive,rowBytes,validateManifest,datasetDigest} from '../.local/contracts/portable-format.mjs';

const golden=JSON.parse(readFileSync('contracts/business/v1/portable-golden-v2.json','utf8'));
const options={datasetId:golden.dataset_id,ownerIds:golden.owner_ids,sessionId:'00000000-0000-4000-8000-000000000002',
  archiveId:'00000000-0000-4000-8000-000000000003',createdAt:'2026-10-20T00:00:00.000Z',version:'format-only'};
async function archive(rows=golden.rows,config=options){
  const parts=[];const result=await createArchive(config,async function*(name){yield* rows[name];},{async write(part){parts.push(part);}});
  return {result,blob:new Blob(parts)};
}
function manifest(){return {format:'zenimport-portable',archive_version:2,financial_schema_version:1,
  archive_id:options.archiveId,dataset_id:options.datasetId,export_session_id:options.sessionId,created_at:options.createdAt,
  producer:{version:'fixture',engine:'sqlite',contract_revision:'0'.repeat(64)},zenmoney_identity:{owner_ids:golden.owner_ids,proof_version:1},
  tables:structuredClone(golden.expected_tables),required_features:['create-once-journal','permanent-tombstones','target-side-receipts'],dataset_digest:golden.expected_digest};}
async function read(blob){const rows=Object.fromEntries(TABLES.map(name=>[name,[]]));const result=await readArchive(blob,{async manifest(){},async row(name,row){rows[name].push(row);}});return {result,rows};}
function storeZip(entries){
  const parts=[];const zip=new Zip((error,part)=>{if(error)throw error;parts.push(part);});
  for(const [name,raw]of entries){const file=new ZipPassThrough(name);zip.add(file);file.push(raw,true);}zip.end();return new Blob(parts);
}
function rawEntries(){return [['manifest.json',canonical(manifest())],...TABLES.map(name=>['tables/'+name+'.ndjson',new TextEncoder().encode(golden.rows[name].map(row=>JSON.stringify(row)+'\n').join(''))])];}

test('browser-format ZIP preserves all golden bytes, exact values and dataset digest',async()=>{
  const first=await archive();assert.equal(first.result.manifest.dataset_digest,golden.expected_digest);
  assert.deepEqual(first.result.manifest.tables,golden.expected_tables);
  const output=await read(first.blob);assert.deepEqual(output.rows,golden.rows);
  assert.equal(output.result.archiveSha256,first.result.archiveSha256);assert.equal(first.result.bytes,first.blob.size);
  assert.equal(output.rows.source_schema_migrations[0][1][1],'9007199254740993');
  const second=await archive();assert.deepEqual(await first.blob.arrayBuffer(),await second.blob.arrayBuffer());
});

test('a held snapshot produces identical ZIP metadata across timezones',()=>{
  const directory=mkdtempSync(join(tmpdir(),'zenimport-format-timezone-'));
  try{
    for(const [index,timezone]of ['UTC','Asia/Ho_Chi_Minh','Pacific/Honolulu'].entries()){
      const result=spawnSync(process.execPath,['scripts/portable-format-interop.mjs','write',join(directory,String(index)+'.zip')],
        {env:{...process.env,TZ:timezone},encoding:'utf8',timeout:20000});
      assert.equal(result.status,0,result.stderr);
    }
    assert.deepEqual(readFileSync(join(directory,'0.zip')),readFileSync(join(directory,'1.zip')));
    assert.deepEqual(readFileSync(join(directory,'0.zip')),readFileSync(join(directory,'2.zip')));
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('manifest counters, exact keys, real UTC dates, identities and required features are strict',()=>{
  assert.equal(validateManifest(manifest()).dataset_digest,golden.expected_digest);
  for(const change of [{archive_version:1},{financial_schema_version:2},{dataset_id:options.datasetId.toUpperCase()+'bad'},
    {created_at:'0000-01-01T00:00:00Z'},{created_at:'2026-02-29T00:00:00Z'},{created_at:'2026-01-01T24:00:00Z'},
    {created_at:'2026-01-01T00:00:60Z'},{created_at:'2026-01-01T00:00:00.1234567Z'},{secret:'forbidden'},
    {zenmoney_identity:{owner_ids:['b','a'],proof_version:1}},{required_features:[]}])assert.throws(()=>validateManifest({...manifest(),...change}));
  for(const stamp of ['0001-01-01T00:00:00Z','2000-02-29T23:59:59.123456Z','2026-10-20T00:00:00.000Z'])assert.equal(validateManifest({...manifest(),created_at:stamp}).created_at,stamp);
  for(const number of ['0',true,-1,0.1,268435457,9007199254740992]){
    const value=manifest();value.tables[0].rows=number;assert.throws(()=>validateManifest(value));
  }
});

test('manifest key order is immaterial but dataset descriptor order is fixed',async()=>{
  const value=manifest();value.tables=value.tables.map(item=>Object.fromEntries(Object.entries(item).reverse()));
  assert.equal(datasetDigest(value),golden.expected_digest);validateManifest(value);
  const entries=rawEntries();entries[0][1]=canonical(value);assert.deepEqual((await read(storeZip(entries))).rows,golden.rows);
});

test('table scanner handles every UTF-8/line boundary and preserves opaque raw JSON',async()=>{
  const name='zen_entities',bytes=rowBytes(name,golden.rows[name][0]).bytes;
  for(const width of [1,2,3,17,4096]){
    const rows=[],scanner=new TableScanner(name,async row=>{rows.push(row);});
    for(let i=0;i<bytes.length;i+=width)await scanner.push(bytes.subarray(i,i+width));
    assert.deepEqual(scanner.finish(),golden.expected_tables.find(item=>item.name===name));assert.deepEqual(rows,golden.rows[name]);
  }
});

for(const [label,mutate]of [
  ['extra ZIP member',entries=>{entries.push(['../escape',new Uint8Array()]);}],
  ['duplicate ZIP member',entries=>{entries[1]=entries[0];}],
  ['wrong member name',entries=>{entries[1][0]='tables/unknown.ndjson';}],
  ['BOM-prefixed member name',entries=>{entries[0][0]='\ufeffmanifest.json';}],
  ['BOM-prefixed JSON',entries=>{entries[0][1]=new Uint8Array([239,187,191,...entries[0][1]]);}],
  ['duplicate JSON key',entries=>{entries[0][1]=new TextEncoder().encode(new TextDecoder().decode(entries[0][1]).replace('{','{"archive_version":2,'));}],
  ['bad content hash',entries=>{entries.find(([name])=>name==='tables/dataset_metadata.ndjson')[1]=new TextEncoder().encode('[]\n');}],
  ['truncated line',entries=>{const item=entries.find(([name])=>name==='tables/source_schema_migrations.ndjson');item[1]=item[1].subarray(0,item[1].length-1);}],
  ['unordered rows',entries=>{const item=entries.find(([name])=>name==='tables/source_schema_migrations.ndjson');item[1]=new TextEncoder().encode(new TextDecoder().decode(item[1]).trimEnd().split('\n').reverse().join('\n')+'\n');}],
])test('archive rejects '+label,async()=>{
  const entries=rawEntries();mutate(entries);await assert.rejects(()=>read(storeZip(entries)));
});

test('headers, CRC, trailing bytes, hidden data and inflated bounds cannot bypass integrity',async()=>{
  const {blob}=await archive(),original=new Uint8Array(await blob.arrayBuffer());
  for(const position of [0,6,14,original.length-22,original.length-6]){
    const changed=original.slice();changed[position]^=255;await assert.rejects(()=>read(new Blob([changed])));
  }
  await assert.rejects(()=>read(new Blob([new Uint8Array([0]),original])));
  await assert.rejects(()=>read(new Blob([original,new Uint8Array([0])])));
  await assert.rejects(()=>read(new Blob([new Uint8Array(LIMITS.compressed_bytes+1)])),/archive_too_large/);
});

test('unsigned ZIP descriptors are parsed by their span rather than a possible CRC signature',async()=>{
  const raw=new Uint8Array(await storeZip(rawEntries()).arrayBuffer()),view=new DataView(raw.buffer);
  const central=view.getUint32(raw.length-6,true),compressed=view.getUint32(central+20,true);
  const descriptor=30+view.getUint16(26,true)+view.getUint16(28,true)+compressed;
  assert.equal(view.getUint32(descriptor,true),0x08074b50);
  const changed=new Uint8Array(raw.length-4);changed.set(raw.subarray(0,descriptor));changed.set(raw.subarray(descriptor+4),descriptor);
  const current=new DataView(changed.buffer),end=changed.length-22;let cursor=central-4;
  for(let i=0;i<TABLES.length+1;i++){
    const local=current.getUint32(cursor+42,true);if(local>descriptor)current.setUint32(cursor+42,local-4,true);
    cursor+=46+current.getUint16(cursor+28,true)+current.getUint16(cursor+30,true)+current.getUint16(cursor+32,true);
  }
  assert.equal(cursor,end);current.setUint32(end+16,central-4,true);
  assert.deepEqual((await read(new Blob([changed]))).rows,golden.rows);
});

test('a failing sink exposes no completed archive or leaked private error',async()=>{
  await assert.rejects(()=>createArchive(options,async function*(name){yield* golden.rows[name];},{async write(){throw Error('private-secret-detail');}}),error=>error.code==='archive_write_failed'&&!error.message.includes('private'));
  const rows=structuredClone(golden.rows);rows.source_schema_migrations.reverse();await assert.rejects(()=>archive(rows),/duplicate_or_unordered_key/);
  const {blob}=await archive();
  await assert.rejects(()=>readArchive(blob,{async manifest(){},async row(){throw new DOMException('private-quota-detail','QuotaExceededError');}}),error=>error.code==='quota_exceeded'&&!error.message.includes('private'));
});
