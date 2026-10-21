import assert from 'node:assert/strict';
import test from 'node:test';
import {ExactMoney} from '../.local/contracts/runner.mjs';
import {uniqueSubset,unmatchedSides} from '../.local/contracts/reconciliation-subsets.mjs';
import {singleMatches,groupMatches,edgeKey} from '../.local/contracts/reconciliation-matching.mjs';
const money=value=>ExactMoney.parse(String(value));
const bank=(id,amount='100',changes={})=>({id,account_id:'physical-a',external_id:id,identity_kind:'bank',local_date:'2026-10-20',direction:'expense',amount,occurred_at:'2026-10-20T12:00:00+07:00',...changes});
const tx=(id,amount='100',changes={})=>({id,date:'2026-10-20',incomeAccount:'a',outcomeAccount:'a',incomeInstrument:'2',outcomeInstrument:'2',income:'0',outcome:amount,...changes});
const context=(transactions,changes={})=>({transactions,claimed:new Set(),unknown:new Set(),excluded:new Set(),enabled:[{id:'physical-a',zenmoney_account_id:'a'},{id:'physical-b',zenmoney_account_id:'b'}],grouped:new Set(),...changes});
const candidates=banks=>banks.map(b=>[b,{id:b.account_id==='physical-b'?'b':'a',instrument:'2'}]);

test('all operation types compare the mapped signed leg, including FX and debt',()=>{
  for(const change of [{},{incomeAccount:'b',income:'2',incomeInstrument:'3'},{incomeAccount:'debt',income:'100'}]){
    const matched=singleMatches(context([tx('z','100',change)]),candidates([bank('source')]));
    assert.deepEqual([...matched],[['source',['z','day_amount']]]);
  }
  assert.equal(singleMatches(context([tx('z','100',{outcomeInstrument:'3'})]),candidates([bank('source')])).size,0);
  assert.equal(singleMatches(context([tx('z','100',{income:'1'})]),candidates([bank('source')])).size,0);
});
test('a remote transfer can cover one independent bank movement on each account',()=>{
  const c=context([tx('transfer','100',{incomeAccount:'b',income:'200',incomeInstrument:'2'})]);
  const result=singleMatches(c,candidates([bank('out'),bank('in','200',{account_id:'physical-b',direction:'income'})]));
  assert.deepEqual([...result],[['out',['transfer','day_amount']],['in',['transfer','day_amount']]]);
  const claimed=context(c.transactions,{claimed:new Set([edgeKey('transfer','a')])});
  assert.deepEqual([...singleMatches(claimed,candidates([bank('out'),bank('in','200',{account_id:'physical-b',direction:'income'})]))],[['in',['transfer','day_amount']]]);
});
test('multiplicity pairs in stable time order without inventing a recipient proof',()=>{
  const a=bank('later','100',{occurred_at:'2026-10-20T13:00:00+07:00'}),b=bank('earlier');
  const result=singleMatches(context([tx('z')]),candidates([a,b]));
  assert.deepEqual([...result],[['earlier',['z','day_amount_order']]]);
  assert.deepEqual([...singleMatches(context([tx('z','100',{created:'9007199254740994'}),tx('older','100',{created:'9007199254740993'})]),candidates([b]))],[['earlier',['older','day_amount_order']]]);
});
test('only unique exact bank references bypass a shared target',()=>{
  const enabled=[{id:'physical-a',zenmoney_account_id:'a'},{id:'second',zenmoney_account_id:'a'}];
  assert.equal(singleMatches(context([tx('z')],{enabled}),candidates([bank('source')])).size,0);
  const reference=bank('source','100',{external_id:'vib:id:REF12345'});
  assert.deepEqual([...singleMatches(context([tx('z','100',{comment:'ID:REF12345.'})],{enabled}),candidates([reference]))],[['source',['z','bank_reference']]]);
  for(const ending of ['\n','\r','\r\n','\u2028','\u2029'])assert.equal(singleMatches(context([tx('z','100',{comment:'REF12345'+ending})],{enabled}),candidates([{...reference,external_id:'vib:id:REF12345'+ending}])).size,0);
  assert.equal(singleMatches(context([tx('z','100',{comment:'XREF12345'})],{enabled}),candidates([reference])).size,0);
  assert.equal(singleMatches(context([tx('z','100',{comment:'REF12345'})],{enabled}),candidates([reference,{...reference,id:'second'}])).size,0);
});
test('unknown ownership, exclusions and hold do not become available matches',()=>{
  for(const changes of [{unknown:new Set(['z'])},{excluded:new Set(['z'])},{claimed:new Set([edgeKey('z','a')])}])assert.equal(singleMatches(context([tx('z')],changes),candidates([bank('source')])).size,0);
  assert.equal(singleMatches(context([tx('z','100',{hold:true})]),candidates([bank('source')])).size,0);
});
test('split and settlement proofs reject competing proposals and shared targets',()=>{
  const c=context([tx('a','40'),tx('b','60')]),bs=candidates([bank('source')]);
  assert.deepEqual(groupMatches(c,bs,new Map()),[{account_id:'physical-a',banks:['source'],zens:['a','b'],kind:'split'}]);
  assert.deepEqual(groupMatches(c,candidates([bank('one'),bank('two')]),new Map()),[]);
  assert.deepEqual(groupMatches(context([tx('net','90')]),candidates([bank('expense'),bank('refund','10',{direction:'income'})]),new Map()),[{account_id:'physical-a',banks:['expense','refund'],zens:['net'],kind:'settlement'}]);
});
test('combination search has exact precision, ambiguity and a shared hard budget',()=>{
  const entries=[['a',money('100000000000000000000000.000000000001')],['b',money('0.000000000002')]];
  assert.deepEqual(uniqueSubset(entries,money('100000000000000000000000.000000000003'),{remaining:20000}).ids,['a','b']);
  assert.equal(uniqueSubset([['a',money(1)],['b',money(1)],['c',money(1)]],money(2),{remaining:20000}).reason,'ambiguous');
  const budget={remaining:2};assert.equal(uniqueSubset(entries,money('100000000000000000000000.000000000003'),budget).reason,'budget_exhausted');assert.equal(budget.remaining,0);
  assert.equal(uniqueSubset(Array.from({length:17},(_,i)=>[String(i),money(1)]),money(17),{remaining:20000}).reason,'unsupported_size');
});
test('reports show both unmatched sides even if their daily totals balance',()=>{
  const result=unmatchedSides([money(-100),money(60)],new Map([['z',money(-40)]]));
  assert.deepEqual([...result.missing],[0,1]);assert.deepEqual([...result.extras],['z']);
  assert.deepEqual([...unmatchedSides([money(-100)],new Map([['a',money(-40)],['b',money(-60)]])).missing],[]);
  const preferred=unmatchedSides([money(-100)],new Map([['older',money(-100)],['known',money(-100)]]),new Map([[0,new Set(['known'])]]));
  assert.deepEqual([...preferred.extras],['older']);
});

test('exhausting a later search discards earlier proposals from the same day',()=>{
  const remote=[tx('one','1'),tx('two','2'),...Array.from({length:14},(_,i)=>tx('large-'+i,String((i+1)*100)))];
  const result=groupMatches(context(remote),candidates([bank('unique','3'),bank('exhaust','1000000')]),new Map());
  assert.deepEqual(result,[]);
});
