import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runSuite} from '../scripts/run-business-contracts.mjs';
import {ExactMoney,canonicalDto,calendarDate,localDay,shiftMonths,normalized,moneyFromWire,runScenario,DomainError,FixtureContext} from '../.local/contracts/runner.mjs';

const code=expected=>error=>error instanceof DomainError && error.code===expected;
test('fixture clock and UUID dependencies stay deterministic and exhaust explicitly',()=>{
  const id='00000000-0000-4000-8000-000000000001',ids=[id];
  const context=new FixtureContext('9007199254740993',ids);ids[0]='changed';
  assert.equal(context.now,9007199254740993n);assert.equal(context.nextUUID(),id);
  assert.equal(context.remaining,0);assert.throws(()=>context.nextUUID(),code('unsupported_scenario'));
});
test('TypeScript executes every L2 shared expectation and rejects future stages',async()=>{
  const fetcher=globalThis.fetch;let calls=0;
  globalThis.fetch=()=>{calls++;throw Error('Financial network access forbidden in domain tests');};
  try {
    const result=await runSuite();
    assert.equal(Object.keys(result.scenarios).length,8);
    assert.equal(result.arithmetic_count,500);assert.ok(result.unicode_count>6000);
    assert.equal(result.future_rejected.length,4);assert.equal(calls,0);
  }finally{globalThis.fetch=fetcher;}
});

test('arithmetic satisfies exact inverse, commutativity and sign properties',()=>{
  const {vectors}=JSON.parse(readFileSync(new URL('../contracts/business/v1/arithmetic-vectors.json',import.meta.url),'utf8'));
  for(const row of vectors) {
    const a=ExactMoney.parse(row.left),b=ExactMoney.parse(row.right);
    assert.ok(a.add(b).subtract(b).equals(a));assert.ok(a.add(b).equals(b.add(a)));
    assert.equal(a.compare(b),-b.compare(a)||0);
    assert.equal(a.negate().negate().toString(),a.toString());
  }
  assert.equal(ExactMoney.parse('-0.000').toString(),'0');
  assert.throws(()=>Number(ExactMoney.parse('1.1')),TypeError);
  assert.throws(()=>ExactMoney.parse('9'.repeat(96)).add(ExactMoney.parse('1')),code('amount_overflow'));
  for(const invalid of ['1\n','01',' 1','+1','1e3','NaN','Infinity','0.','-.1'])assert.throws(()=>ExactMoney.parse(invalid),code('invalid_amount'));
});

test('SDK financial projection rejects lossy Number values',()=>{
  assert.equal(moneyFromWire(9007199254740993n).toString(),'9007199254740993');
  assert.throws(()=>moneyFromWire(0.1),code('invalid_amount'));
  assert.throws(()=>moneyFromWire(9007199254740992),code('invalid_amount'));
  assert.throws(()=>moneyFromWire('1.0'),code('invalid_amount'));
});

test('canonical DTO rejects lossy, cyclic, sparse, accessor and invalid-Unicode inputs',()=>{
  const cyclic={};cyclic.self=cyclic;
  let reads=0;const accessor={get secret(){reads++;return 'hidden';}};
  for(const value of [0.1,-0,9007199254740992,undefined,1n,new Date(),cyclic,[,1],Object.assign(new Array(2),{x:1,0:1}),accessor,'\ud800'])
    assert.throws(()=>canonicalDto(value),code('invalid_dto'));
  assert.equal(reads,0);
  assert.equal(canonicalDto({'😀':1,'\ue000':2}),'{'+'"\\ue000":2,"\\ud83d\\ude00":1}');
});

test('calendar boundaries use actual calendar months, offsets and years',()=>{
  assert.equal(shiftMonths('2024-03-31',-1),'2024-02-29');
  assert.equal(calendarDate('0001-01-01'),'0001-01-01');
  assert.equal(localDay('0001-01-01T00:00:00Z','UTC'),'0001-01-01');
  for(const value of ['2026-02-30','0000-01-01','2026-01-01\n'])assert.throws(()=>calendarDate(value),code('invalid_date'));
  assert.throws(()=>localDay('2026-02-30T00:00:00Z','UTC'),code('invalid_date'));
  assert.throws(()=>shiftMonths('0001-01-01',-1),code('invalid_date'));
});

test('normalization uses full casefold and preserves Python whitespace semantics',()=>{
  assert.equal(normalized('ςẞﬃ'),'σssffi');
  assert.equal(normalized('\u0085a\u001cb\ufeff'),'a b\ufeff');
  assert.equal(normalized('😀'.repeat(16000)).length,32000);
  assert.throws(()=>normalized('\ud800'),code('unsupported_unicode'));
});

test('unsupported state assertions, faults and commands cannot falsely pass',async()=>{
  const scenario=JSON.parse(readFileSync(new URL('../contracts/business/v1/scenarios/money-large.json',import.meta.url),'utf8'));
  await assert.rejects(()=>runScenario({...scenario,commands:[{operation:'delivery.advance',input:{}}]}),code('unsupported_command'));
  await assert.rejects(()=>runScenario({...scenario,commands:[{operation:'money.sum',input:{values:['1']},fault:'before_commit'}]}),code('unsupported_scenario'));
  await assert.rejects(()=>runScenario({...scenario,expected:{...scenario.expected,state_assertions:[{unknown:true}]}}),code('unsupported_scenario'));
});
