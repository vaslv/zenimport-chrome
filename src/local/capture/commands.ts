/** Narrow normalized local capture requests, retaining exact lease epochs. */
import {object,text,counter} from './validation.js';
import {CaptureError,requireCapture} from './errors.js';
import {int64} from '../storage/types.js';
import {bankRecord} from '../../domain/bank-record.js';
import {calendarDate} from '../../domain/dates.js';
export function uuid(value:unknown){const id=text(value,36,36);requireCapture(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));return id.toLowerCase();}
function positive(value:unknown){try{const n=int64(typeof value==='string'?value:String(counter(value)));requireCapture(BigInt(n)>0n);return n;}catch{throw new CaptureError('validation_error');}}
export function startCommand(input:unknown){
  const data=object(input,['connection_id','request_id','reimport_from']);let start:string|null=null;
  if(data.reimport_from!=null){try{start=calendarDate(text(data.reimport_from,10,10));}catch{throw new CaptureError('validation_error');}}
  return {connection_id:uuid(data.connection_id),request_id:uuid(data.request_id),reimport_from:start};
}
export function leaseCommand(input:unknown){const data=object(input,['worker_id']);return {worker_id:uuid(data.worker_id)};}
function counters(data:Record<string,unknown>){
  const pages=counter(data.total_pages),records=counter(data.total_records);requireCapture(pages>=1&&pages<=10000&&records<=1000000);
  return {worker_id:uuid(data.worker_id),lease_epoch:positive(data.lease_epoch),total_pages:pages,total_records:records};
}
export function completeCommand(input:unknown){return counters(object(input,['worker_id','lease_epoch','total_pages','total_records']));}
export function pageCommand(input:unknown){
  const data=object(input,['worker_id','lease_epoch','page_number','total_pages','total_records','records']),base=counters(data),number=counter(data.page_number);
  requireCapture(number>=1&&number<=base.total_pages&&Array.isArray(data.records)&&data.records.length<=500&&data.records.length<=base.total_records);
  const records=data.records.map(value=>{try{return bankRecord(value);}catch{throw new CaptureError('validation_error');}});
  requireCapture(base.total_records===0?base.total_pages===1&&number===1&&records.length===0:records.length>0);
  requireCapture(new Set(records.map(row=>row.external_id)).size===records.length);
  return {...base,page_number:number,records};
}
export function statusCommand(input:unknown){
  const data=object(input,['worker_id','lease_epoch','state','code']);requireCapture(data.state==='paused'||data.state==='failed');
  requireCapture(['bank_login_required','capture_context_changed','history_incomplete'].includes(data.code as string));
  return {worker_id:uuid(data.worker_id),lease_epoch:positive(data.lease_epoch),state:data.state,code:data.code as 'bank_login_required'|'capture_context_changed'|'history_incomplete'};
}
