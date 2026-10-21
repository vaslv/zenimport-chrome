import assert from 'node:assert/strict';
import test from 'node:test';
import {backfillOwnership,ownershipClaims,blockedOwnership,recoverTransferOwnership} from '../.local/contracts/reconciliation-ownership.mjs';
import {edgeKey} from '../.local/contracts/reconciliation-matching.mjs';
const pair=JSON.stringify(['old','zen']);
function context(changes={}){return {known:[{bank_id:'old',zen_id:'zen'}],targets:[],payloads:[],adopted:new Set(),attempted:new Set(),authorizations:new Map(),
  transactions:new Map(),blockingTransactions:new Map(),excluded:new Set(),sourceHash:'source',enabled:[],instruments:new Map(),current:new Map(),revisions:new Map(),...changes};}
const authorization={bank_id:'old',target_id:'a',revision:'1',source_hash:'source',authorized_at:'10'};
test('durable ordinary attempted payload proves the original target without a current mapping',()=>{
  const c=context({payloads:[{bank_id:'old',zen_id:'zen',incomeAccount:'a',outcomeAccount:'a'}]});
  assert.deepEqual(backfillOwnership(c),[{bank_id:'old',zen_id:'zen',target_id:'a',origin:'durable_history',at:'0'}]);
  c.targets=backfillOwnership(c);assert.deepEqual(backfillOwnership(c),[]);
  assert.deepEqual(ownershipClaims(c.known,c.targets),{exact:new Set([edgeKey('zen','a')]),unknown:new Set()});
});
test('a two-sided payload needs adopted or attempted authorization and conflicts stay unresolved',()=>{
  const c=context({payloads:[{bank_id:'old',zen_id:'zen',incomeAccount:'a',outcomeAccount:'b'}],authorizations:new Map([['old',authorization]])});
  assert.deepEqual(backfillOwnership(c),[]);
  for(const property of ['attempted','adopted']){
    assert.equal(backfillOwnership({...c,[property]:new Set([pair])})[0].target_id,'a');
  }
  const conflict={...c,attempted:new Set([pair]),payloads:[{bank_id:'old',zen_id:'zen',incomeAccount:'b',outcomeAccount:'b'}]};
  assert.deepEqual(backfillOwnership(conflict),[]);
});
test('unknown ownership blocks only current affected target days and explicit exclusions release the block',()=>{
  const bank=(id,day)=>[{id,account_id:'physical',external_id:id,identity_kind:'bank',local_date:day,direction:'expense',amount:'100',occurred_at:null},{id:'a',instrument:'2'}];
  const c=context({blockingTransactions:new Map([['zen',{id:'zen',date:'2026-10-20',incomeAccount:'b',outcomeAccount:'a',income:'1',outcome:'100'}]])});
  const candidates=[bank('same','2026-10-20'),bank('other-day','2026-10-21')];
  assert.deepEqual([...blockedOwnership(c,candidates)],['same']);
  assert.deepEqual([...blockedOwnership({...c,excluded:new Set(['zen'])},candidates)],[]);
});

test('backfill indexes immutable payload proofs once instead of rescanning the journal',()=>{
  const size=10000;let reads=0;
  const known=Array.from({length:size},(_,i)=>({bank_id:'bank-'+i,zen_id:'zen-'+i}));
  const payloads=known.map(edge=>({...edge,get incomeAccount(){reads++;return 'original';},outcomeAccount:'original'}));
  const targets=backfillOwnership(context({known,payloads}));
  assert.equal(targets.length,size);assert.ok(reads<=size*4,reads);
  assert.ok(targets.every(row=>row.target_id==='original'));
});


test('late recovery indexes historical owners once before considering unknown UUIDs',()=>{
  const size=10000;let reads=0;
  const known=Array.from({length:size},(_,i)=>({bank_id:'b-'+i,get zen_id(){reads++;return 'z-'+i;}}));
  const transactions=new Map(Array.from({length:size},(_,i)=>['z-'+i,{id:'z-'+i,date:'2026-10-20',incomeAccount:'b',outcomeAccount:'a',income:'1',outcome:'1'}]));
  const candidate=[{id:'peer',account_id:'physical-b',external_id:'peer',identity_kind:'bank',local_date:'2026-10-20',direction:'income',amount:'1',occurred_at:null},{id:'b',instrument:'2'}];
  assert.deepEqual(recoverTransferOwnership(context({known,transactions}),[candidate],'10'),[]);
  assert.ok(reads<=size*6,reads);
});
