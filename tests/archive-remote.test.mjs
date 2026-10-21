import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {RemoteParticipant} from '../.local/contracts/migration-remote.mjs';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const config={url:'http://127.0.0.1:18792',token:'fixture-only-token'};
const hash='a'.repeat(64),context={id:id(1),installation_id:id(2),expected_epoch:'1'};
const backup={id:id(1),installation_id:id(2),initial_epoch:'1',kind:'backup',phase:'ready',dataset_id:id(3),created_at:'100',archive_sha256:hash,archive_size:'1',chunks:'1',dataset_digest:'b'.repeat(64),acknowledged_at:null,error_code:null};
const recovery={...context,dataset_id:id(3),archive_sha256:hash,archive_size:'1',owner_ids:['1'],former_writers_retired:true,accept_post_snapshot_evidence_loss:true};
const preview={id:id(4),archive_sha256:hash,sdk_sha256:'c'.repeat(64),source_hash:'d'.repeat(64),checked_at:'100',cursor:'9007199254740993',bank_transactions:'2',zen_transactions:'2',missing_bank:0,extra_zen:0,unchecked_accounts:1};
const json=value=>Response.json(value),code=value=>error=>error.code===value;
const client=(reply,inspect=()=>{})=>new RemoteParticipant(config,async()=>true,async(url,options)=>{inspect(url,options);return json(reply);});

test('archive transport uses authenticated isolated routes and exact immutable request identity',async()=>{
  const calls=[];const gateway=client(backup,(url,o)=>calls.push([url,o]));assert.deepEqual(await gateway.archiveBackup(context),backup);
  assert.ok(calls[0][0].endsWith('/migration/archives/backups'));assert.deepEqual(JSON.parse(calls[0][1].body),context);
  assert.equal(calls[0][1].credentials,'omit');assert.equal(calls[0][1].redirect,'error');assert.equal(calls.length,1);
  const result={...backup,kind:'recovery',phase:'uploading',dataset_digest:null};
  assert.deepEqual(await client(result).archiveRestore(recovery),result);
  await assert.rejects(client({...result,installation_id:id(9)}).archiveRestore(recovery),code('migration_invalid'));
  await assert.rejects(client({...result,archive_size:'2'}).archiveRestore(recovery),code('migration_invalid'));
  await assert.rejects(gateway.archiveRestore({...recovery,former_writers_retired:false}),code('migration_invalid'));
});

test('archive status rejects malformed counts, phases, digests and cross-request replies',async()=>{
  for(const change of [{id:id(9)},{initial_epoch:'01'},{initial_epoch:'9223372036854775806'},{archive_size:1},{archive_size:'67108865'},{chunks:'2'},
    {dataset_digest:null},{kind:'backup',phase:'activated'},{acknowledged_at:'99'},{error_code:'private response body'},{phase:'blocked',error_code:null}]){
    await assert.rejects(client({...backup,...change}).archiveStatus(id(1)),code('migration_invalid'));
  }
  await assert.rejects(client({...backup,extra:'ignored?'}).archiveStatus(id(1)),code('migration_invalid'));
});

test('preview binds raw snapshot checksum and exact integers without treating cancelled cleanup as activation',async()=>{
  assert.deepEqual(await client(preview).archivePreview(id(1),hash),preview);
  await assert.rejects(client({...preview,cursor:9007199254740992}).archivePreview(id(1),hash),code('migration_invalid'));
  await assert.rejects(client({...preview,archive_sha256:'b'.repeat(64)}).archivePreview(id(1),hash),code('migration_invalid'));
  await assert.rejects(client({...preview,missing_bank:.5}).archivePreview(id(1),hash),code('migration_invalid'));
  const activated={...backup,kind:'recovery',phase:'activated'};
  assert.deepEqual(await client(activated).archiveActivate(id(1),id(4),true),activated);
  await assert.rejects(client({...activated,phase:'cleaned'}).archiveActivate(id(1),id(4),true),code('migration_invalid'));
  let calls=0;await assert.rejects(client(activated,()=>calls++).archiveActivate(id(1),id(4),false),code('migration_paused'));assert.equal(calls,0);
});

test('archive chunk transfer verifies checksum, byte length and bounded binary response',async()=>{
  const bytes=new Uint8Array([42]),checksum=createHash('sha256').update(bytes).digest('hex');
  assert.deepEqual(await client({number:'0',bytes:'1',sha256:checksum},(url,o)=>{
    assert.ok(url.endsWith('/archives/'+id(1)+'/chunks/0'));assert.deepEqual(JSON.parse(o.body),{data:'Kg==',sha256:checksum});
  }).archiveUpload(id(1),0,bytes),{number:'0',bytes:'1',sha256:checksum});
  await assert.rejects(client({number:'1',bytes:'1',sha256:checksum}).archiveUpload(id(1),0,bytes),code('migration_invalid'));
  for(const data of [bytes,new Uint8Array(262145)]){
    const gateway=new RemoteParticipant(config,async()=>true,async()=>new Response(data,{headers:{'Content-Type':'application/octet-stream','X-Chunk-SHA256':checksum}}));
    if(data.length===1)assert.deepEqual(await gateway.archiveDownload(id(1),0),bytes);
    else await assert.rejects(gateway.archiveDownload(id(1),0),code('migration_invalid'));
  }
});

test('archive controls require verified acknowledgements and never retry unknown requests',async()=>{
  const ack={...backup,acknowledged_at:'100'};assert.deepEqual(await client(ack).archiveAcknowledge(id(1),hash),ack);
  await assert.rejects(client(backup).archiveAcknowledge(id(1),hash),code('migration_invalid'));
  assert.deepEqual(await client({complete:true}).archiveClean(id(1)),{complete:true});
  await assert.rejects(client({complete:'true'}).archiveClean(id(1)),code('migration_invalid'));
  let calls=0;const unavailable=new RemoteParticipant(config,async()=>true,async()=>{calls++;throw Error('synthetic-secret');});
  await assert.rejects(unavailable.archiveBackup(context),code('backend_unavailable'));assert.equal(calls,1);
  const old=new RemoteParticipant(config,async()=>true,async()=>new Response('{}',{status:404}));
  await assert.rejects(old.archiveStatus(id(1)),code('unsupported_migration_version'));
  const denied=new RemoteParticipant(config,async()=>false,async()=>{assert.fail('permission must precede fetch');});
  await assert.rejects(denied.archiveStatus(id(1)),code('permission_required'));
});


test('a typed missing archive is distinct from a server without archive support',async()=>{
  const missing=new RemoteParticipant(config,async()=>true,async()=>new Response('{"error":{"code":"not_found"}}',{status:404}));
  await assert.rejects(missing.archiveStatus(id(1)),code('not_found'));
  await assert.rejects(missing.archiveAction(id(1),'cancel'),code('not_found'));
  await assert.rejects(client(backup).archiveAction(id(1),'cancel'),code('migration_invalid'));
  await assert.rejects(client(backup).archiveAction(id(1),'finalize'),code('migration_invalid'));
});
