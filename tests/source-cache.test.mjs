import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cachedSource,rememberSource,forgetSource,publishSource,SourceChanges} from '../.local/contracts/source-cache.mjs';
import {unpackRow,rowKey,packRow} from '../.local/contracts/storage-cells.mjs';
const golden=JSON.parse(readFileSync(new URL('../contracts/business/v1/portable-financial-v2.json',import.meta.url)));
// Unknown tables are harmless to seed; cache owns only its fixed source cohort.
const rows=()=>Object.fromEntries(Object.entries(golden.rows).map(([table,values])=>[table,values.map(value=>unpackRow(table,value))]));
const stamp=(revision='1',extra={})=>({generation:'g',epoch:'1',credentialEpoch:'1',credentialRef:'c',participantId:'p',participantEpoch:'1',revision,projection:'g',mirror:'{}',mirrorControl:'{}',...extra});
const start=()=>{forgetSource();rememberSource('database:install',stamp(),rows());assert.ok(cachedSource('database:install',stamp()));};
const key=(table,row)=>rowKey(table,packRow(table,row));
test('source cache applies only an exact committed chain and retains immutable older snapshots',()=>{
 start();const before=cachedSource('database:install',stamp()),old=before.bank_accounts[0],row={...old,label:'new'};
 const changes=new SourceChanges();changes.enabled=true;changes.upsert('bank_accounts',key('bank_accounts',row),row);
 publishSource('database:install',stamp(),stamp('2'),changes);
 assert.equal(cachedSource('database:install',stamp()),null);
 assert.equal(cachedSource('other installation',stamp('2')),null);
 assert.equal(cachedSource('database:install',stamp('2')).bank_accounts.find(value=>value.id===old.id).label,'new');
 assert.equal(before.bank_accounts[0].label,old.label);assert.throws(()=>{before.bank_accounts[0].label='mutated';});
 publishSource('database:install',stamp(),stamp('3'),changes);
 assert.equal(cachedSource('database:install',stamp('3')),null);
});
test('unknown revisions, credentials, projection and authority cannot reuse a snapshot',()=>{
 start();for(const field of ['revision','generation','epoch','credentialEpoch','credentialRef','participantId','participantEpoch','projection','mirror','mirrorControl'])
  assert.equal(cachedSource('database:install',stamp('1',{[field]:'different'})),null,field);
 forgetSource();assert.equal(cachedSource('database:install',stamp()),null);
});
test('mirror replacement preserves first tombstones, hard deletion wins and keys stay ordered',()=>{
 start();const changes=new SourceChanges();changes.enabled=true;
 const entity={kind:'transaction',id:'fresh',data:'{}',changed:null,deleted:'0',run_id:'r'};
 const tomb={kind:'transaction',entity_id:'fresh',reason:'soft_delete',data:'first'};
 changes.mirror({full:true,kinds:['transaction'],entities:[entity],tombstones:[tomb,{...tomb,data:'later'}],deletions:[{kind:'transaction',entity_id:'fresh'}]});
 publishSource('database:install',stamp(),stamp('2',{projection:'shadow'}),changes);
 const actual=cachedSource('database:install',stamp('2',{projection:'shadow'}));
 assert.equal(actual.zen_entities.filter(value=>value.kind==='transaction').length,0);
 assert.equal(actual.zen_tombstones.find(value=>value.entity_id==='fresh').data,'first');
 const keys=actual.zen_tombstones.map(row=>key('zen_tombstones',row));assert.deepEqual(keys,[...keys].sort());
});
test('delta and byte budgets discard acceleration instead of retaining incomplete evidence',()=>{
 start();const changes=new SourceChanges();changes.enabled=true;
 for(let i=0;i<10001;i++)changes.remove('bank_transactions',String(i));
 assert.ok(changes.invalid);publishSource('database:install',stamp(),stamp('2'),changes);
 assert.equal(cachedSource('database:install',stamp('2')),null);
 const large=rows();large.zen_entities=[{kind:'merchant',id:'big',data:'x'.repeat(128*1024*1024),changed:null,deleted:'0',run_id:'r'}];
 rememberSource('database:install',stamp(),large);assert.equal(cachedSource('database:install',stamp()),null);
});

test('an oversized mirror response is rejected before touching its entity rows',()=>{
 const changes=new SourceChanges();changes.enabled=true;
 const entities=Array.from({length:10001},()=>new Proxy({},{get(){throw Error('must not inspect discarded rows');}}));
 changes.mirror({entities,tombstones:[],deletions:[],full:false});assert.ok(changes.invalid);assert.deepEqual(changes.items,[]);
});

test('a committed credential change drops the old authority cache',()=>{
 start();const changes=new SourceChanges();changes.enabled=true;
 publishSource('database:install',stamp(),stamp('1',{credentialEpoch:'2',credentialRef:'replacement'}),changes);
 assert.equal(cachedSource('database:install',stamp('1',{credentialEpoch:'2',credentialRef:'replacement'})),null);
});
