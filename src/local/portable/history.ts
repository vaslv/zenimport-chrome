/** Permanent create-once evidence; read-only and independent of delivery readiness. */
import {ExactDecimal} from 'zenmoney-typescript';
import {pythonDecimalText} from '../../domain/python-decimal.js';
import type {GraphReader} from './relations.js';
import {financialJson} from './inspect.js';
import {requirePortable} from './format.js';

function payloadIdentity(raw:string,id:string):void{
  const data=financialJson(raw);
  requirePortable(data!==null&&typeof data==='object'&&!Array.isArray(data)&&!(data instanceof ExactDecimal),'invalid_attempt_identity');
  const value=(data as Record<string,unknown>).id;
  // Existing project journals use UUID strings. Preserve reference scalar text
  // when inspecting older audit; structured identifiers are never API identities.
  let expected:string;
  if(value===null||value===undefined)expected='None';
  else if(typeof value==='boolean')expected=value?'True':'False';
  else if(value instanceof ExactDecimal)expected=pythonDecimalText(value);
  else{requirePortable(typeof value==='string'||typeof value==='bigint'||typeof value==='number'&&Number.isSafeInteger(value),'invalid_attempt_identity');expected=String(value);}
  requirePortable(expected===id,'invalid_attempt_identity');
}

// Length-prefixed strings retain exact original payloads without delimiter
// ambiguity or relying on a hash as proof of payload equality.
const evidence=(...values:string[])=>values.map(value=>value.length+':'+value).join('');

export async function validateHistory(reader:GraphReader):Promise<void>{
  for await(const _ of reader.rows('source_capture_leases'))requirePortable(false,'capture_not_quiescent');
  const intervals=new Map<string,string>(),authorizations=new Map<string,string>(),terminal=new Set<string>(),attempted=new Set<string>();
  for await(const row of reader.rows('capture_intervals'))intervals.set(row.id,row.job_id);
  for await(const row of reader.rows('processing_receipts'))terminal.add(row.bank_id);
  for await(const row of reader.rows('link_bank_members'))terminal.add(row.bank_id);
  for await(const row of reader.rows('delivery_attempts')){
    payloadIdentity(row.payload,row.zen_id);attempted.add(evidence(row.bank_id,row.zen_id,row.payload));
  }
  for await(const row of reader.rows('delivery_authorizations')){
    requirePortable(intervals.get(row.interval_id)===row.job_id,'invalid_authorization_job');authorizations.set(row.bank_id,row.job_id);
  }
  for await(const row of reader.rows('deliveries')){
    requirePortable(row.state!=='attempting','delivery_not_quiescent');payloadIdentity(row.payload,row.zen_id);
    if(row.ever_attempted==='1'&&!row.origin.startsWith('legacy:')){
      requirePortable(attempted.has(evidence(row.bank_id,row.zen_id,row.payload)),'missing_attempt_evidence');
      requirePortable(authorizations.has(row.bank_id)&&authorizations.get(row.bank_id)===row.authorized_job_id,'missing_attempt_authorization');
    }
  }
  for await(const row of reader.rows('bank_processing')){
    if(['pending','prepared','uncertain'].includes(row.state))requirePortable(!terminal.has(row.bank_id),'terminal_history_conflict');
    if(row.state==='delivered')requirePortable(terminal.has(row.bank_id),'missing_terminal_proof');
  }
}
