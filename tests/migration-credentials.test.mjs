import test from 'node:test';
import assert from 'node:assert/strict';
import {ServerCredentials} from '../.local/contracts/migration-credentials.mjs';
const id='00000000-0000-4000-8000-000000000001';
const base={protocol_version:'2',archive_version:'2',financial_schema_version:'1',chunk_bytes:'262144',max_archive_bytes:'67108864',installation_id:id,dataset_id:'00000000-0000-4000-8000-000000000003',participant_epoch:'1',state:'active',operation_id:null,awaiting_sync:false,legacy_hold:null,can_import:true,owner_ids:['1'],checked_at:'100'};
function fixture(){
  const values={},requests=[];let permission=true,reply=base,drop=false,reorder=false;
  const area={async setAccessLevel(value){assert.equal(value.accessLevel,'TRUSTED_CONTEXTS');},async get(key){return reorder?JSON.parse(JSON.stringify({[key]:values[key]},(_key,value)=>value!==null&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).reverse()):value)):structuredClone({[key]:values[key]});},async set(patch){if(!drop)Object.assign(values,structuredClone(patch));},async remove(){throw Error('forbidden');}};
  const vault=new ServerCredentials(area,async()=>permission,async(url,options)=>{requests.push({url,options});return Response.json(reply);});
  return {vault,values,requests,deny(){permission=false;},reply(value){reply=value;},drop(){drop=true;},reorder(){reorder=true;}};
}
test('server candidates verify and acknowledge secrets without selecting Root',async()=>{
  const f=fixture(),candidate=await f.vault.verify({url:'https://fixture.invalid/',token:' synthetic-only '},['1']);
  const secret=await f.vault.read(candidate.ref);
  assert.equal(secret.url,'https://fixture.invalid');assert.equal(secret.token,'synthetic-only');assert.equal(secret.legacy,false);
  assert.deepEqual(Object.keys(f.values).sort(),['remoteCandidate:'+candidate.ref,'remoteCredential:'+candidate.ref].sort());
  assert.equal((await f.vault.verifiedCandidate(candidate.ref)).installation_id,id);
  assert.ok(f.requests.every(row=>row.url.endsWith('/migration/portable/identity')&&row.options.method==='POST'&&row.options.credentials==='omit'));
});
test('wrong owner and revoked permission save no server candidate',async()=>{
  const f=fixture();await assert.rejects(f.vault.verify({url:'https://fixture.invalid',token:'synthetic'},['2']),{code:'migration_wrong_account'});
  assert.deepEqual(f.values,{});f.deny();await assert.rejects(f.vault.verify({url:'https://fixture.invalid',token:'synthetic'}),{code:'permission_required'});assert.deepEqual(f.values,{});
});
test('lost storage acknowledgment cannot expose a usable candidate',async()=>{
  const f=fixture();f.drop();await assert.rejects(f.vault.verify({url:'https://fixture.invalid',token:'synthetic'}),{code:'recovery_required'});
});
test('same address with replaced physical server fails fresh candidate validation',async()=>{
  const f=fixture(),saved=await f.vault.verify({url:'https://fixture.invalid',token:'synthetic'});
  f.reply({...base,installation_id:'00000000-0000-4000-8000-000000000002'});
  await assert.rejects(f.vault.verifiedCandidate(saved.ref),{code:'migration_invalid'});
});
test('legacy reference verification needs no candidate proof and never alters it',async()=>{
  const f=fixture(),ref=crypto.randomUUID();f.values['remoteCredential:'+ref]={version:1,ref,url:'https://fixture.invalid',token:'synthetic',contextId:crypto.randomUUID(),legacy:true};
  const before=structuredClone(f.values);assert.equal((await f.vault.verifyReference(ref,['1'])).installation_id,id);assert.deepEqual(f.values,before);
  await assert.rejects(f.vault.proof(ref),{code:'recovery_required'});
});
test('corrupt server secret cannot issue an authenticated request',async()=>{
  const f=fixture(),candidate=await f.vault.verify({url:'https://fixture.invalid',token:'synthetic'}),count=f.requests.length;
  f.values['remoteCredential:'+candidate.ref].unexpected='secret';await assert.rejects(f.vault.verifyReference(candidate.ref),{code:'recovery_required'});assert.equal(f.requests.length,count);
});

test('a new expected owner cannot override the candidate original owner binding',async()=>{
  const f=fixture(),saved=await f.vault.verify({url:'https://fixture.invalid',token:'synthetic'},['1']);
  f.reply({...base,owner_ids:['2']});
  await assert.rejects(f.vault.verifiedCandidate(saved.ref,['2']),{code:'migration_wrong_account'});
});

test('storage key reordering does not invalidate acknowledged credentials',async()=>{
  const f=fixture();f.reorder();const saved=await f.vault.verify({url:'https://fixture.invalid',token:'synthetic'});
  assert.equal((await f.vault.read(saved.ref)).token,'synthetic');
  assert.equal((await f.vault.verifiedCandidate(saved.ref)).installation_id,id);
});

test('candidate dataset lineage is bound independently of physical installation',async()=>{
  const f=fixture(),saved=await f.vault.verify({url:'https://fixture.invalid',token:'synthetic'});
  f.reply({...base,dataset_id:'00000000-0000-4000-8000-000000000004'});
  await assert.rejects(f.vault.verifiedCandidate(saved.ref),{code:'migration_invalid'});
});


test('restored route credentials are immutable, acknowledged and independently scoped',async()=>{
 const f=fixture(),saved=await f.vault.verify({url:'https://fixture.invalid',token:'synthetic'});
 const target=crypto.randomUUID(),context=crypto.randomUUID(),before=await f.vault.read(saved.ref),calls=f.requests.length;
 await f.vault.cloneContext(saved.ref,target,context);
 assert.deepEqual(await f.vault.read(saved.ref),before);
 assert.deepEqual(await f.vault.read(target),{version:1,ref:target,url:before.url,token:before.token,contextId:context,legacy:false});
 assert.equal(f.requests.length,calls);await f.vault.cloneContext(saved.ref,target,context);
 await assert.rejects(f.vault.cloneContext(saved.ref,target,crypto.randomUUID()),{code:'recovery_required'});
 assert.equal((await f.vault.read(target)).contextId,context);
 const missing=crypto.randomUUID();f.drop();await assert.rejects(f.vault.cloneContext(saved.ref,missing,context),{code:'recovery_required'});
});
