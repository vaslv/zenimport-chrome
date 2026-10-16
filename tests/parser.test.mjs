import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePage, historyAccount} from '../extension/connectors/vietinbank/parser.js';
import {today,daysAgo,monthsAgo,validDate} from '../extension/dates.js';

const options = {account:'12345678', period:{start:'2026-10-01',end:'2026-10-10'}};
const row = (changes={}) => ({currency:'VND',remark:'Fixture shop',amount:'123456',balance:'9876543',trxId:'fixture-id',processDate:'09-10-2026 10:12:25',dorC:'D',corresponsiveAccount:'fixture-recipient',...changes});
const page = (changes={}) => ({error:false,accountNo:options.account,currentPage:0,pageSize:100,totalRecords:1,transactions:[row()],...changes});
test('exact wire data, details whitelist and unchanged bank id', async()=>{
 const result=await parsePage(page({transactions:[row({password:'must-not-leak'})]}),options), record=result.records[0];
 assert.equal(record.external_id,'vib:id:fixture-id');assert.equal(record.amount,'123456');
 assert.equal(record.occurred_at,'2026-10-09T10:12:25+07:00');assert.equal(record.beneficiary_account,'fixture-recipient');
 assert.equal(record.details.password,undefined);assert.equal(record.direction,'expense');
});
test('legacy f1 identity stays byte-for-byte compatible', async()=>{
 const record=(await parsePage(page({transactions:[row({trxId:''})]}),options)).records[0];
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['12345678','09/10/2026 10:12:25',-123456,9876543,'Fixture shop'])));
 assert.equal(record.external_id,'vib:f1:'+Buffer.from(bytes).toString('hex'));
 for(const value of [null,undefined]){
   const input=row({trxId:value});if(value===undefined)delete input.trxId;
   const fallback=(await parsePage(page({transactions:[input]}),options)).records[0];
   assert.equal(fallback.external_id,record.external_id);
   assert.equal(fallback.identity_kind,'fingerprint');
 }
});
test('empty interval and observed zero-total continuation',async()=>{
 assert.equal((await parsePage(page({totalRecords:0,transactions:[]}),options)).totalPages,1);
 const result=await parsePage(page({currentPage:1,pageSize:1,totalRecords:0}),{...options,page:1,total:2,size:1});
 assert.equal(result.total,2);assert.equal(result.totalPages,2);
});
test('unsafe counters, dates, currencies, amounts and context never advance coverage',async()=>{
 for(const changes of [{error:true},{accountNo:'87654321'},{currentPage:2},{totalRecords:2},{totalRecords:0},
   ...[{currency:'USD'},{amount:'1.2'},{amount:'9007199254740993'},{amount:'-1'},{processDate:'31-02-2026 10:12:25'},{processDate:'30-09-2026 10:12:25'}].map(change=>({transactions:[row(change)]}))]) {
   await assert.rejects(parsePage(page(changes),options));
 }
 await assert.rejects(parsePage(page(),{...options,seen:['vib:id:fixture-id']}));
 await assert.rejects(parsePage(page({currentPage:1,totalRecords:8}),{...options,page:1,total:2,size:100}));
});
test('strict route and bank calendar dates, no browser timezone drift',()=>{
 assert.equal(historyAccount('https://evil.test/payment-history?accountNo=12345678'),null);
 assert.equal(historyAccount('https://ipay.vietinbank.vn/payment-history?accountNo=12345678'),'12345678');
 assert.equal(today('Asia/Ho_Chi_Minh',new Date('2026-10-08T18:00:00Z')),'2026-10-09');
 assert.equal(daysAgo(30,'2026-03-15'),'2026-02-13');assert.equal(monthsAgo(6,'2026-08-31'),'2026-02-28');
 assert.equal(validDate('2026-02-30'),false);
});
