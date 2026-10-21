import assert from 'node:assert/strict';
import test from 'node:test';
import {movementFact,reviewedFact,tagFact,bankFact,historicalBank,sourceFacts} from '../.local/contracts/source-facts.mjs';
const entity=(data,kind='transaction')=>({id:'tx',kind,data,deleted:'0'});
const row={id:'bank',account_id:'physical',revision:'2',amount:'1',direction:'expense',external_id:'canonical',identity_kind:'bank',local_date:'2026-10-20',occurred_at:null};
const account={id:'physical',bank:'fixture',scale:'2'};
test('mirror scientific amounts become exact plain decimals without losing learning quantum',()=>{
  const r=entity('{"income":0.0000000000000,"outcome":1.00000000000000000001e2,"incomeAccount":"a","outcomeAccount":"a","incomeInstrument":9007199254740993,"outcomeInstrument":2,"viewed":true,"tag":["cat"],"created":9007199254740993}');
  const movement=movementFact(r),payment=reviewedFact(r);
  assert.equal(movement.outcome,'100.000000000000000001');assert.equal(movement.income,'0');
  assert.equal(movement.incomeInstrument,'9007199254740993');assert.equal(movement.created,'9007199254740993');
  assert.equal(payment.incomeScaleAllowed,false);assert.equal(payment.outcomeScaleAllowed,false);assert.equal(payment.viewed,true);
  assert.equal(reviewedFact(entity('{"income":0,"outcome":1.000000000000e2}')).outcomeScaleAllowed,true);
});
test('tag direction flags retain Python null/default and false/zero distinctions',()=>{
  assert.equal(tagFact(entity('{"showIncome":null,"showOutcome":0}', 'tag')).showIncome,true);
  assert.equal(tagFact(entity('{"showIncome":null,"showOutcome":0}', 'tag')).showOutcome,false);
  assert.equal(tagFact(entity('{"showOutcome":0.0}', 'tag')).showOutcome,false);
});
test('historical bank revisions preserve canonical identity and recover legacy signed units',()=>{
  const current=bankFact(row,account);
  const version={bank_id:'bank',revision:'1',data_json:'{"date":"2026-10-19","amount_minor":-123,"description":"Prior"}',raw_json:'{"details":{"corresponsiveAccount":"recipient","corresponsiveName":"Name","extra":9007199254740993}}'};
  const bank=historicalBank(current,version,'2');assert.equal(bank.amount,'1.23');assert.equal(bank.direction,'expense');assert.equal(bank.occurred_at,null);assert.equal(bank.external_id,'canonical');assert.equal(bank.beneficiary_account,'recipient');assert.equal(bank.revision,'1');
  assert.equal(historicalBank(current,{...version,revision:'2'},'2'),current);
  for(const details of [[],false,0,''])assert.equal(historicalBank(current,{...version,raw_json:JSON.stringify({details})},'2').amount,'1.23');
});
test('permanent tombstone reappearance stays in blocking data but never enters eligible matching or training',()=>{
  const rows={bank_accounts:[],bank_transactions:[],bank_versions:[],zen_tombstones:[{kind:'transaction',entity_id:'tx'}],zen_entities:[entity('{"income":0,"outcome":1,"outcomeAccount":"a","incomeAccount":"a"}') ]};
  const facts=sourceFacts({rows});assert.equal(facts.blockingTransactions.size,1);assert.equal(facts.transactions.size,0);assert.equal(facts.reviewed.size,0);assert.equal(facts.entities.has('transaction'),false);
});
