/** Offline format interop CLI: the golden fixture deliberately lacks a financial graph. */
import {open,readFile,writeFile} from 'node:fs/promises';
import {createArchive,readArchive,TABLES} from '../.local/contracts/portable-format.mjs';
const [mode,path]=process.argv.slice(2);
const golden=JSON.parse(await readFile('contracts/business/v1/portable-golden-v2.json','utf8'));
if(mode==='write'){
  const output=await open(path,'wx',0o600);
  try{
    const value=await createArchive({datasetId:golden.dataset_id,ownerIds:golden.owner_ids,
      archiveId:'00000000-0000-4000-8000-000000000003',sessionId:'00000000-0000-4000-8000-000000000002',
      createdAt:'2026-10-20T00:00:00.000Z',version:'format-only'},async function*(name){yield* golden.rows[name];},
      {async write(part){await output.writeFile(part);}});
    if(value.manifest.dataset_digest!==golden.expected_digest)throw Error('format_digest_mismatch');
    await output.sync();console.log('PASS: TypeScript golden ZIP exported; no activation authority');
  }finally{await output.close();}
}else if(mode==='read'){
  const rows=Object.fromEntries(TABLES.map(name=>[name,[]]));
  const value=await readArchive(new Blob([await readFile(path)]),{async manifest(){},async row(name,row){rows[name].push(row);}});
  if(JSON.stringify(rows)!==JSON.stringify(golden.rows)||value.manifest.dataset_digest!==golden.expected_digest)throw Error('format_roundtrip_mismatch');
  await writeFile(path+'.typescript.json',JSON.stringify({digest:value.manifest.dataset_digest,tableCount:value.manifest.tables.length}),{mode:0o600});
  console.log('PASS: Python ZIP verified by TypeScript; all 49 tables/raw scalars agree');
}else throw Error('Expected write or read');
