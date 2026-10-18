import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePage,accountFromUrl,supports} from '../extension/connectors/bidv/parser.js';
import {connectorFor} from '../extension/connectors/index.js';
import {probePage} from '../extension/connectors/bidv/index.js';

const options={account:'12345678',period:{start:'2026-10-01',end:'2026-10-16'}};
const row=changes=>({date:'09/10/2026 10:12:25',remark:'Fixture merchant',amount:'-100,000 VND',balance:'900,000 VND',reference:'fixture-123',...changes});
const page=(rows=[row()],changes={})=>({accountNo:options.account,period:options.period,currentPage:0,pageSize:100,totalRecords:rows.length,transactions:rows,...changes});

test('BIDV accepts only the accounts routes on the exact HTTPS host',()=>{
  const origin='https://smartbanking.bidv.com.vn';
  assert.equal(connectorFor(origin+'/tai-khoan').id,'bidv');
  assert.equal(accountFromUrl(origin+'/tai-khoan/thanh-toan/12345678'),'12345678');
  for(const url of ['http://smartbanking.bidv.com.vn/tai-khoan',origin+'.evil.test/tai-khoan',origin+'/chuyen-tien',origin+'/tai-khoan/thanh-toan/not-a-number'])assert.equal(supports(url),false);
});
test('BIDV fee, principal and equal amounts sharing a reference have separate stable identities',async()=>{
  const rows=[row({amount:'-9,900 VND'}),row(),row({balance:'800,000 VND'})];
  const parsed=await parsePage(page(rows),options);
  assert.equal(new Set(parsed.ids).size,3);
  assert.equal(parsed.records[0].amount,'9900');
  assert.equal(parsed.records[1].occurred_at,'2026-10-09T10:12:25+07:00');
  assert.equal(parsed.records[0].identity_kind,'fingerprint');
  const reordered=await parsePage(page([...rows].reverse()),options);
  assert.deepEqual(reordered.ids,parsed.ids.toReversed());
  const changed=await parsePage(page([row({remark:'Updated remark'})]),options);
  assert.equal(changed.ids[0],parsed.ids[1]);
  assert.equal(changed.records[0].details.referenceNumber,'fixture-123');
  assert.equal((await parsePage(page([row({password:'never retain'})]),options)).records[0].details.password,undefined);
});
test('BIDV exact integer arithmetic, positive income and negative balance',async()=>{
  const [r]=(await parsePage(page([row({amount:'+9,007,199,254,740,993 VND',balance:'-2,000 VND'})]),options)).records;
  assert.equal(r.amount,'9007199254740993');assert.equal(r.direction,'income');assert.equal(r.balance,'-2000');
  assert.equal((await parsePage(page([]),options)).totalPages,1);
});
test('BIDV rejects incomplete totals, duplicate postings, wrong context and malformed financial data',async()=>{
  for(const p of [page([row(),row()]),page([row()],{totalRecords:2}),page([row()],{currentPage:1}),page([row()],{pageSize:500}),page([row()],{accountNo:'87654321'}),
    ...[{date:'31/02/2026 10:12:25'},{date:'09/10/2026 24:00:00'},{date:'30/09/2026 10:12:25'},
      {amount:'0 VND'},{amount:'-0 VND'},{amount:'-1.5 VND'},{amount:'-1,00 VND'},{amount:'-1 USD'},{amount:'100 VND'},{balance:''},{reference:''}].map(r=>page([row(r)]))])await assert.rejects(parsePage(p,options));
  const first=await parsePage(page(),options);await assert.rejects(parsePage(page(),{...options,seen:first.ids}));
});
test('BIDV transport pages have fixed counts and page-independent identity',async()=>{
  const rows=Array.from({length:101},(_,i)=>row({reference:'fixture-'+i}));
  const first=await parsePage(page(rows.slice(0,100),{totalRecords:101}),options);
  const last=await parsePage(page(rows.slice(100),{totalRecords:101,currentPage:1}),{...options,page:1,total:101,size:100});
  assert.equal(first.totalPages,2);assert.equal(last.records.length,1);
  assert.equal(last.ids[0],(await parsePage(page(rows.slice(100)),options)).ids[0]);
});
test('BIDV transport fits the body limit with maximum Unicode remarks and details',async()=>{
  const rows=Array.from({length:100},(_,i)=>row({reference:'fixture-'+i,remark:'🌏'.repeat(2000)}));
  const parsed=await parsePage(page(rows),options);
  const wire={worker_id:crypto.randomUUID(),lease_epoch:1,page_number:1,total_pages:1,total_records:100,records:parsed.records};
  assert.ok(Buffer.byteLength(JSON.stringify(wire))<2000000);
});
test('BIDV discovery reads only rendered VND payment cards',t=>{
  const before={document:globalThis.document,location:globalThis.location};
  t.after(()=>Object.assign(globalThis,before));
  const card=(number,balance)=>({querySelector:selector=>({textContent:selector.endsWith('--no')?number:balance}),compareDocumentPosition:()=>4});
  globalThis.location={origin:'https://smartbanking.bidv.com.vn',pathname:'/tai-khoan'};
  const cards=[card('12345678','90,000 VND'),card('87654321','100 USD')];
  globalThis.document={readyState:'interactive',querySelectorAll:selector=>selector==='main button, main [role="button"]'?
    [{textContent:'Payment Open account',compareDocumentPosition:()=>4},{textContent:'Savings Open account'}]:cards};
  assert.equal(probePage().accounts_complete,false);assert.equal(probePage().accounts.length,1);
  location.pathname='/tai-khoan/thanh-toan/12345678';
  assert.equal(probePage().account,'12345678');
  document.readyState='loading';assert.equal(probePage(),null);
});
