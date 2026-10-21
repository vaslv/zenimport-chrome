import assert from 'node:assert/strict';
import test from 'node:test';
import {buildCategoryEvidence,categoryContext,predictCategory,predictionRecipient} from '../.local/contracts/category-prediction.mjs';
const tag=(id,changes={})=>({id,title:id,deleted:false,archive:false,showIncome:true,showOutcome:true,...changes});
const bank=(id,changes={})=>({id,account_id:'physical',external_id:id,identity_kind:'bank',local_date:'2026-10-20',direction:'expense',amount:'100',occurred_at:null,
  bank:'bidv',currency:'VND',description:'Fixture payment',beneficiary_account:'merchant',beneficiary_name:'Shop',...changes});
const tx=(id,changes={})=>({id,viewed:true,hold:false,deleted:false,tags:['a'],incomeAccount:'target',outcomeAccount:'target',incomeInstrument:'2',outcomeInstrument:'2',
  income:'0',outcome:'100',incomeScaleAllowed:true,outcomeScaleAllowed:true,...changes});
function input(count=3){return {banks:Array.from({length:count},(_,i)=>bank('b'+i)),bankExclusions:new Set(),zenExclusions:new Set(),tags:new Map([['a',tag('a')],['b',tag('b')]]),
  transactions:new Map(Array.from({length:count},(_,i)=>['z'+i,tx('z'+i)])),accounts:new Map([['target',{type:'checking'}]]),instruments:new Map([['2','VND']]),
  bindings:new Map([['physical',new Set(['target'])]]),groups:[],receipts:Array.from({length:count},(_,i)=>({bank_id:'b'+i,zen_id:'z'+i,origin:'day_amount'})),deliveries:new Map()};}
function context(data,changes={}){const evidence=buildCategoryEvidence(data);return categoryContext({tags:data.tags,banks:[...data.banks,bank('new')],payments:evidence.payments,rules:[],manual:new Map(),...changes});}

test('three independent reviewed payments predict a category without counting the target itself',()=>{
  assert.equal(predictCategory(bank('new'),context(input(2)),true).category_id,null);
  assert.equal(predictCategory(bank('new'),context(input()),true).category_id,'a');
  assert.equal(predictCategory(bank('b0'),context(input()),true).category_id,null);
  assert.equal(predictCategory(bank('new'),context(input()),false).reason,'zenmoney_unavailable');
});
test('unreviewed predictions, chronological guesses, transfers, debts and changed amounts cannot train',()=>{
  for(const change of [{viewed:false},{hold:true},{deleted:true},{outcome:'101'},{income:'1'},{incomeAccount:'other'},{outcomeScaleAllowed:false}]){
    const data=input();data.transactions.set('z0',tx('z0',change));assert.equal(predictCategory(bank('new'),context(data),true).category_id,null);
  }
  for(const origin of ['day_amount_order']){const data=input();data.receipts[0].origin=origin;assert.equal(buildCategoryEvidence(data).payments.length,2);}
  const data=input();data.accounts.set('target',{type:'debt'});assert.equal(buildCategoryEvidence(data).payments.length,0);
});
test('one remote UUID cannot impersonate several independent payments',()=>{
  const data=input();data.receipts.forEach(row=>row.zen_id='z0');assert.equal(buildCategoryEvidence(data).payments.length,0);
});
test('a reviewed split counts once; mixed categories or duplicate tag IDs retain a blocker',()=>{
  const data=input(2);data.banks.push(bank('split'));data.groups.push({kind:'split',banks:['split'],zens:['s1','s2']});
  data.transactions.set('s1',tx('s1',{outcome:'40'}));data.transactions.set('s2',tx('s2',{outcome:'60'}));
  assert.equal(predictCategory(bank('new'),context(data),true).category_id,'a');
  data.transactions.set('s2',tx('s2',{outcome:'60',tags:['b']}));assert.equal(predictCategory(bank('new'),context(data),true).reason,'conflicting_history');
  const repeated=input();repeated.transactions.set('z0',tx('z0',{tags:['a','a']}));
  const evidence=buildCategoryEvidence(repeated);assert.equal(evidence.evidence.filter(row=>row.zen_id==='z0').length,1);
  assert.equal(predictCategory(bank('new'),context(repeated),true).reason,'conflicting_history');
});
test('manual choice and a unique explicit recipient rule take precedence over history',()=>{
  const data=input(),rules=[{bank:'bidv',direction:'expense',name:'SHOP',category_id:'b'}];
  assert.equal(predictCategory(bank('new'),context(data,{rules}),true).source,'rule');
  assert.equal(predictCategory(bank('new'),context(data,{rules,manual:new Map([['new','a']])}),true).source,'manual');
  rules.push({...rules[0],category_id:'a'});assert.equal(predictCategory(bank('new'),context(data,{rules}),true).category_id,null);
});
test('unsupported Unicode cannot hide a known conflicting category or replace a strong recipient identity',()=>{
  const data=input(4);data.transactions.set('z3',tx('z3',{tags:['b']}));data.tags.set('b',tag('b',{title:'\u{1FAE9}'}));
  assert.equal(predictCategory(bank('new'),context(data),true).reason,'conflicting_history');
  assert.equal(predictCategory(bank('b3'),context(data),true).category_id,'a');
  assert.equal(predictCategory(bank('new',{beneficiary_name:'\u{1FAE9}'}),context(input()),true).category_id,null);
  const lower=input(4);lower.banks[3].beneficiary_name='\u{1FAE9}';lower.transactions.set('z3',tx('z3',{tags:['b']}));
  assert.equal(predictCategory(bank('new'),context(lower),true).reason,'conflicting_history');
  assert.equal(predictionRecipient(bank('x',{beneficiary_name:'\u{1FAE9}',description:'\u{1FAE9}'})),'account:merchant');
  assert.equal(predictCategory(bank('new'),context(data,{manual:new Map([['new','a']])}),true).category_id,'a');
});
test('tag direction, archival state, exclusions and strongest current delivery identity remain authoritative',()=>{
  for(const change of [{archive:true},{deleted:true},{showOutcome:false}]){
    const data=input();data.tags.set('a',tag('a',change));assert.equal(buildCategoryEvidence(data).payments.length,0);
  }
  const data=input();data.zenExclusions.add('z0');assert.equal(buildCategoryEvidence(data).payments.length,2);
  data.zenExclusions.clear();data.bankExclusions.add('b0');assert.equal(buildCategoryEvidence(data).payments.length,2);
  data.bankExclusions.clear();data.receipts.push({bank_id:'b0',zen_id:'obsolete',origin:'old'});data.deliveries.set('b0','z0');assert.equal(buildCategoryEvidence(data).payments.length,3);
});
