/** Immutable capture/page evidence and complete intervals, never a resume command. */
import type {GraphReader} from './relations.js';
import type {BankFacts} from './record-proof.js';
import {aliasKey,versionKey} from './record-proof.js';
import {financialObject,jsonEqual,tupleText} from './json-values.js';
import {digest,requirePortable,utf8} from './format.js';
import {bankRecord,timestampProjection} from '../../domain/bank-record.js';
import type {BankRecordValue} from '../../domain/bank-record.js';
import {calendarDate,localDay} from '../../domain/dates.js';
import {canonicalStoredDto} from '../../domain/codec.js';
import type {RowByTable} from '../storage/schema.generated.js';

function uuid(value:unknown):string{
  requirePortable(typeof value==='string','invalid_job_identity');
  let text=value;
  if(text.startsWith('urn:uuid:'))text=text.slice(9);
  if(text.startsWith('{')&&text.endsWith('}'))text=text.slice(1,-1);
  requirePortable(/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(text),'invalid_job_identity');
  const hex=text.replace(/-/g,'').toLowerCase();return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
}
function request(raw:string):{connectionId:string;requestId:string}{
  const value=financialObject(raw,'invalid_job_identity');
  requirePortable(Object.keys(value).every(key=>['connection_id','request_id','reimport_from'].includes(key)),'invalid_job_identity');
  if(value.reimport_from!==null&&value.reimport_from!==undefined){requirePortable(typeof value.reimport_from==='string','invalid_job_identity');calendarDate(value.reimport_from);}
  return {connectionId:uuid(value.connection_id),requestId:uuid(value.request_id)};
}
function counter(value:unknown,min:number,max:number):number{
  requirePortable(typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max,'invalid_page_evidence');return value;
}
function pageValue(raw:string):{page_number:number;total_pages:number;total_records:number;records:BankRecordValue[]}{
  const value=financialObject(raw,'invalid_page_evidence');
  requirePortable(Object.keys(value).length===4&&['page_number','total_pages','total_records','records'].every(key=>Object.hasOwn(value,key)),'invalid_page_evidence');
  const page_number=counter(value.page_number,1,10000),total_pages=counter(value.total_pages,1,10000),total_records=counter(value.total_records,0,1000000);
  requirePortable(page_number<=total_pages&&Array.isArray(value.records)&&value.records.length<=500&&value.records.length<=total_records,'invalid_page_evidence');
  const records=value.records.map(bankRecord);
  requirePortable(total_records===0?total_pages===1&&page_number===1&&records.length===0:records.length>0,'invalid_page_evidence');
  requirePortable(new Set(records.map(row=>row.external_id)).size===records.length,'invalid_page_evidence');
  return {page_number,total_pages,total_records,records};
}
const vietinFields=new Set('currency remark amount balance trxId processDate dorC refType refId tellerId corresponsiveAccount corresponsiveName channel serviceBranchId serviceBranchName pmtType sendingBankId sendingBranchId sendingBranchName receivingBankId receivingBranchId receivingBranchName'.split(' '));
const bidvFields=new Set('transactionDate referenceNumber transactionRemark transactionAmount balance'.split(' '));
function validateRecord(record:BankRecordValue,account:RowByTable['bank_accounts'],context:RowByTable['job_context'],interval:RowByTable['capture_intervals']):void{
  const scale=Number(account.scale);
  requirePortable(record.currency===account.currency&&(record.amount.split('.')[1]?.length??0)<=scale,'invalid_page_evidence');
  requirePortable(record.local_date>=interval.start_date&&record.local_date<=interval.end_date&&localDay(record.occurred_at,context.timezone)===record.local_date,'invalid_page_evidence');
  const fields=account.bank==='bidv'?bidvFields:vietinFields;
  requirePortable(record.details_state==='complete'&&Object.keys(record.details).every(key=>fields.has(key)),'invalid_page_evidence');
  requirePortable(record.balance===null||(record.balance.split('.')[1]?.length??0)<=scale,'invalid_page_evidence');
}
function sameRecord(left:BankRecordValue,right:BankRecordValue):boolean{
  return timestampProjection(left.occurred_at).micros===timestampProjection(right.occurred_at).micros&&
    jsonEqual({...left,occurred_at:null},{...right,occurred_at:null});
}

export async function validateCapture(reader:GraphReader,banks:BankFacts):Promise<void>{
  for await(const _ of reader.rows('source_capture_leases'))requirePortable(false,'capture_not_quiescent');
  const intervals=new Map<string,RowByTable['capture_intervals']>(),jobs=new Map<string,RowByTable['capture_jobs']>(),contexts=new Map<string,RowByTable['job_context']>();
  const states=new Map<string,string[]>(),pages=new Map<string,RowByTable['capture_pages'][]>(),captured=new Map<string,Map<string,RowByTable['captured_records']>>();
  for await(const row of reader.rows('capture_intervals')){
    calendarDate(row.start_date);calendarDate(row.end_date);intervals.set(row.id,row);
    const values=states.get(row.job_id)??[];values.push(row.state);states.set(row.job_id,values);
  }
  for await(const row of reader.rows('job_context'))contexts.set(row.job_id,row);
  for await(const job of reader.rows('capture_jobs')){
    jobs.set(job.id,job);
    requirePortable(['complete','failed','cancelled'].includes(job.capture_state)&&['waiting','running','complete','blocked'].includes(job.delivery_state),'capture_not_quiescent');
    requirePortable(job.worker_id===null&&job.lease_expires_at===null,'executable_source_lease');calendarDate(job.end_date);
    const values=states.get(job.id)??[];
    requirePortable(values.every(state=>['complete','failed','cancelled'].includes(state))&&(['failed','cancelled'].find(state=>values.includes(state))??'complete')===job.capture_state,'invalid_capture_state');
    const command=request(job.request_json);
    requirePortable(command.connectionId===job.connection_id&&command.requestId===job.request_id,'invalid_job_identity');
    const receipt=await reader.find('job_requests',['request_id'],[['text',job.request_id]]);
    requirePortable(receipt!==null&&receipt.job_id===job.id&&receipt.request_json===job.request_json,'missing_job_request');
  }
  for await(const row of reader.rows('job_requests')){
    const command=request(row.request_json),job=jobs.get(row.job_id);
    requirePortable(job!==undefined&&command.requestId===row.request_id&&command.connectionId===job.connection_id,'invalid_job_identity');
  }
  for await(const row of reader.rows('captured_records')){
    const key=tupleText(row.interval_id,row.page_number),values=captured.get(key)??new Map<string,RowByTable['captured_records']>();values.set(row.bank_id,row);captured.set(key,values);
  }
  for await(const page of reader.rows('capture_pages')){
    const values=pages.get(page.interval_id)??[];values.push(page);pages.set(page.interval_id,values);
    requirePortable(digest(utf8.encode(page.payload_json))===page.digest,'invalid_page_digest');
    const payload=pageValue(page.payload_json);
    requirePortable(BigInt(payload.page_number)===BigInt(page.page_number)&&BigInt(payload.records.length)===BigInt(page.records_count)&&canonicalStoredDto(payload)===page.payload_json,'invalid_page_evidence');
    const interval=intervals.get(page.interval_id),account=interval===undefined?undefined:banks.accounts.get(interval.account_id);
    requirePortable(interval!==undefined&&account!==undefined,'invalid_relationship');const context=contexts.get(interval.job_id);requirePortable(context!==undefined,'missing_job_context');
    requirePortable(interval.total_pages!==null&&interval.total_records!==null&&BigInt(payload.total_pages)===BigInt(interval.total_pages)&&BigInt(payload.total_records)===BigInt(interval.total_records),'invalid_page_evidence');
    const witnessed=new Set<string>(),proofs=captured.get(tupleText(page.interval_id,page.page_number))??new Map<string,RowByTable['captured_records']>();
    for(const record of payload.records){
      validateRecord(record,account,context,interval);
      const id=banks.aliases.get(aliasKey(interval.account_id,record.external_id)),proof=id===undefined?undefined:proofs.get(id),version=proof===undefined?undefined:banks.versions.get(versionKey(proof.bank_id,proof.revision));
      requirePortable(id!==undefined&&!witnessed.has(id)&&version!==undefined&&sameRecord(bankRecord(financialObject(version.raw_json,'invalid_captured_revision')),record),'invalid_captured_revision');witnessed.add(id);
    }
    requirePortable(witnessed.size===proofs.size,'invalid_captured_revision');
  }
  for(const interval of intervals.values())if(interval.state==='complete'){
    const actual=(pages.get(interval.id)??[]).sort((a,b)=>BigInt(a.page_number)<BigInt(b.page_number)?-1:1);
    requirePortable(interval.total_pages!==null&&BigInt(interval.total_pages)>=1n&&BigInt(interval.total_pages)<=10000n&&
      BigInt(actual.length)===BigInt(interval.total_pages)&&actual.every((row,i)=>BigInt(row.page_number)===BigInt(i+1)),'incomplete_coverage');
    requirePortable(interval.total_records!==null&&actual.reduce((sum,row)=>sum+BigInt(row.records_count),0n)===BigInt(interval.total_records),'incomplete_coverage');
  }
  for await(const row of reader.rows('coverage')){
    const interval=intervals.get(row.interval_id);
    requirePortable(interval!==undefined&&interval.state==='complete'&&row.account_id===interval.account_id&&row.start_date===interval.start_date&&row.end_date===interval.end_date,'invalid_coverage');
  }
}
