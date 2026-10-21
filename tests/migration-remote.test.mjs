import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {RemoteParticipant} from '../.local/contracts/migration-remote.mjs';
import {identity,status} from '../.local/contracts/migration-wire.mjs';
import {participantTransition} from '../.local/contracts/participant-transition.mjs';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const cap={protocol_version:'2',archive_version:'2',financial_schema_version:'1',chunk_bytes:'262144',max_archive_bytes:'67108864',installation_id:id(1),dataset_id:id(5),participant_epoch:'1',state:'active',operation_id:null,awaiting_sync:false,legacy_hold:null,can_import:true};
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const config={url:'https://backend.invalid',token:'synthetic-remote-token'};
const code=expected=>error=>error.code===expected;
test('participant identity and capabilities preserve exact owner strings',async()=>{
  const client=new RemoteParticipant(config,async()=>true,async function(url,options){
    assert.equal(this,undefined);assert.equal(options.headers.Authorization,'Bearer synthetic-remote-token');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
    if(url.endsWith('/identity')){assert.equal(options.method,'POST');assert.equal(options.body,'{}');return json({...cap,owner_ids:['9007199254740993'],checked_at:'100'});}
    return json(cap);
  });
  assert.deepEqual(await client.capabilities(),cap);assert.equal((await client.identity()).owner_ids[0],'9007199254740993');
  assert.throws(()=>identity({...cap,owner_ids:['0'],checked_at:'100'}),code('migration_invalid'));
  assert.throws(()=>identity({...cap,owner_ids:['1','1'],checked_at:'100'}),code('migration_invalid'));
});
test('ungranted permission and invalid chunk indexes prevent any network',async()=>{
  let calls=0;const client=new RemoteParticipant(config,async()=>false,async()=>{calls++;return json(cap);});
  await assert.rejects(client.capabilities(),code('permission_required'));
  await assert.rejects(client.download(id(1),256),code('migration_invalid'));
  await assert.rejects(client.command('source_seal',{}),code('migration_invalid'));assert.equal(calls,0);
});
test('bounded chunk downloads verify the declared checksum and length',async()=>{
  const bytes=new Uint8Array(262144).fill(42),hash=createHash('sha256').update(bytes).digest('hex');
  const client=new RemoteParticipant(config,async()=>true,async()=>new Response(bytes,{headers:{'Content-Type':'application/octet-stream','X-Chunk-SHA256':hash}}));
  assert.deepEqual(await client.download(id(1),0),bytes);
  const bad=new RemoteParticipant(config,async()=>true,async()=>new Response(bytes,{headers:{'Content-Type':'application/octet-stream','X-Chunk-SHA256':'0'.repeat(64)}}));
  await assert.rejects(bad.download(id(1),0),code('migration_invalid'));
  const large=new RemoteParticipant(config,async()=>true,async()=>new Response(new Uint8Array(262145),{headers:{'Content-Type':'application/octet-stream','X-Chunk-SHA256':hash}}));
  await assert.rejects(large.download(id(1),0),code('migration_invalid'));
});
test('accepted commands preserve the integrity receipt without automatic retry',async()=>{
  const request={request_id:id(4),switch_id:id(3),expected_epoch:'1',peer_id:id(2)};
  const result=participantTransition({id:id(1),generation:id(6),epoch:'1',state:'active',operationId:null,everActivated:false,awaitingSync:false},null,'source_start',request,
    {now:'100',datasetId:id(5),archiveId:id(7),eligible:true,legacyHold:false,archive:null,validated:false});
  let calls=0;const client=new RemoteParticipant(config,async()=>true,async(url,options)=>{calls++;assert.ok(url.endsWith('/commands/source_start'));assert.deepEqual(JSON.parse(options.body),request);return json({receipt:result.receipt,work:null});});
  assert.deepEqual((await client.command('source_start',request)).receipt,result.receipt);assert.equal(calls,1);
  assert.throws(()=>status({...cap,operation:null,receipts:[{...result.receipt,receipt_sha256:'0'.repeat(64)}],work:[]},id(3)),code('migration_invalid'));
});
test('an interrupted request or stalled body times out once and redacts errors',async()=>{
  let calls=0;const hanging=new RemoteParticipant(config,async()=>true,async()=>{calls++;return new Promise(()=>{});},10);
  await assert.rejects(hanging.identity(),code('backend_unavailable'));assert.equal(calls,1);
  const body=new RemoteParticipant(config,async()=>true,async()=>new Response(new ReadableStream({start(){}})),10);
  await assert.rejects(body.identity(),code('backend_unavailable'));
  const rejected=new RemoteParticipant(config,async()=>true,async()=>new Response('{"error":{"code":"private token content"}}',{status:403}));
  await assert.rejects(rejected.identity(),error=>error.code==='backend_error'&&!error.message.includes('private token'));
});

test('valid stale receipts and tasks for other commands or switches are rejected',async()=>{
  const request={request_id:id(4),switch_id:id(3),expected_epoch:'1',peer_id:id(2)},other={...request,request_id:id(9)};
  const proof=participantTransition({id:id(1),generation:id(6),epoch:'1',state:'active',operationId:null,everActivated:false,awaitingSync:false},null,'source_start',other,
    {now:'100',datasetId:id(5),archiveId:id(7),eligible:true,legacyHold:false,archive:null,validated:false}).receipt;
  const stale=new RemoteParticipant(config,async()=>true,async()=>json({receipt:proof,work:null}));
  await assert.rejects(stale.command('source_start',request),code('migration_invalid'));
  const wrong=new RemoteParticipant(config,async()=>true,async()=>json({id:id(4),switch_id:id(9),kind:'validate',state:'queued',error_code:null}));
  await assert.rejects(wrong.finalize({request_id:id(4),switch_id:id(3),expected_epoch:'2'}),code('migration_invalid'));
  await assert.rejects(wrong.retry(id(8)),code('migration_invalid'));
});

test('a reply cannot substitute another peer with an otherwise valid receipt',async()=>{
  const {canonicalParticipant}=await import('../.local/contracts/control-participant-wire.mjs');
  const initial=n=>({id:id(n),generation:id(6),epoch:'1',state:'active',operationId:null,everActivated:false,awaitingSync:false});
  const context={now:'100',datasetId:id(5),archiveId:id(7),eligible:true,legacyHold:false,archive:null,validated:false};
  const start=participantTransition(initial(1),null,'source_start',{request_id:id(4),switch_id:id(3),expected_epoch:'1',peer_id:id(2)},context);
  const seal=participantTransition(start.control,start.operation,'source_seal',{request_id:id(8),switch_id:id(3),expected_epoch:'2',dataset_digest:'a'.repeat(64),archive_sha256:'b'.repeat(64),archive_size:'1'},
    {...context,archive:{sha256:'b'.repeat(64),size:'1'}});
  const request={request_id:id(9),switch_id:id(3),expected_epoch:'1',peer_receipt:seal.receipt};
  const accepted=participantTransition(initial(2),null,'destination_start',request,context);
  const plain={...accepted.receipt,peer_id:id(10)};delete plain.receipt_sha256;
  const wrong={...plain,receipt_sha256:createHash('sha256').update(canonicalParticipant(plain)).digest('hex')};
  const client=new RemoteParticipant(config,async()=>true,async()=>json({receipt:wrong,work:null}));
  await assert.rejects(client.command('destination_start',request),code('migration_invalid'));
});

test('quiescence replies bind the physical participant and exact observed epoch',async()=>{
  let reply={installation_id:id(1),participant_epoch:'7',ready:false},requests=0;
  const client=new RemoteParticipant(config,async()=>true,async(url,options)=>{
    requests++;assert.ok(url.endsWith('/quiesce'));assert.equal(options.method,'POST');
    assert.deepEqual(JSON.parse(options.body),{installation_id:id(1),expected_epoch:'7'});return json(reply);
  });
  assert.equal(await client.quiesce(id(1),'7'),false);reply={...reply,ready:true};assert.equal(await client.quiesce(id(1),'7'),true);
  reply={...reply,participant_epoch:'8'};await assert.rejects(client.quiesce(id(1),'7'),code('migration_invalid'));
  reply={...reply,participant_epoch:'7',installation_id:id(2)};await assert.rejects(client.quiesce(id(1),'7'),code('migration_invalid'));
  assert.equal(requests,4);
});


test('archive withdrawal is capability-gated and binds its exact permanent command',async()=>{
 const request={id:id(12),installation_id:id(1),expected_epoch:'1',dataset_id:id(13),archive_sha256:'a'.repeat(64),archive_size:'10',owner_ids:['1'],former_writers_retired:true,accept_post_snapshot_evidence_loss:true};
 const ordered=value=>JSON.stringify(value,(_key,item)=>item!==null&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
 const proof={withdrawal_version:'1',decision:'withdrawn',id:request.id,request_sha256:createHash('sha256').update(ordered(request)).digest('hex'),installation_id:id(1),dataset_id:id(5),participant_epoch:'1'};
 let calls=0,corrupt=false;
 const client=new RemoteParticipant(config,async()=>true,async(url,init)=>{
  calls++;if(url.endsWith('/archives/capabilities'))return json({archive_control_version:'1',recovery_withdrawal:true});
  assert.ok(url.endsWith('/archives/recoveries/withdraw'));assert.deepEqual(JSON.parse(init.body),request);
  return json(corrupt?{...proof,request_sha256:'f'.repeat(64)}:proof);
 });
 assert.deepEqual(await client.archiveCapabilities(),{archive_control_version:'1',recovery_withdrawal:true});
 assert.deepEqual(await client.archiveWithdraw(request),proof);assert.equal(calls,2);
 corrupt=true;await assert.rejects(client.archiveWithdraw(request),code('migration_invalid'));
 const old=new RemoteParticipant(config,async()=>true,async()=>json({archive_control_version:'1',recovery_withdrawal:false}));
 await assert.rejects(old.archiveCapabilities(),code('unsupported_migration_version'));
 const missing=new RemoteParticipant(config,async()=>true,async()=>new Response(JSON.stringify({error:{code:'not_found'}}),{status:404}));
 await assert.rejects(missing.archiveCapabilities(),code('unsupported_migration_version'));
 await assert.rejects(missing.archiveWithdraw(request),code('unsupported_migration_version'));
});

test('backup withdrawal uses separate capability discovery and exact canonical request evidence',async()=>{
 const request={id:id(20),installation_id:id(1),expected_epoch:'9007199254740993'};
 const canonical=JSON.stringify(Object.fromEntries(Object.entries(request).sort(([a],[b])=>a.localeCompare(b))));
 const proof={withdrawal_version:'1',decision:'withdrawn',id:request.id,request_sha256:createHash('sha256').update(canonical).digest('hex'),installation_id:id(1),dataset_id:id(5),participant_epoch:'9007199254740995'};
 let result=proof,calls=0;
 const client=new RemoteParticipant(config,async()=>true,async(url,init)=>{
  calls++;if(url.endsWith('/backups/capabilities'))return json({archive_control_version:'1',backup_withdrawal:true});
  assert.ok(url.endsWith('/backups/withdraw'));assert.deepEqual(JSON.parse(init.body),request);return json(result);
 });
 assert.deepEqual(await client.archiveBackupCapabilities(),{archive_control_version:'1',backup_withdrawal:true});
 assert.deepEqual(await client.archiveBackupWithdraw(request),proof);assert.equal(calls,2);
 for(const patch of [{id:id(21)},{installation_id:id(2)},{request_sha256:'f'.repeat(64)},{extra:true},{participant_epoch:9007199254740993}]){
  result={...proof,...patch};await assert.rejects(client.archiveBackupWithdraw(request),code('migration_invalid'));
 }
 const count=calls;await assert.rejects(client.archiveBackupWithdraw({...request,extra:true}),code('migration_invalid'));assert.equal(calls,count);
 const missing=new RemoteParticipant(config,async()=>true,async()=>new Response(JSON.stringify({error:{code:'not_found'}}),{status:404}));
 await assert.rejects(missing.archiveBackupCapabilities(),code('unsupported_migration_version'));
 await assert.rejects(missing.archiveBackupWithdraw(request),code('unsupported_migration_version'));
});
