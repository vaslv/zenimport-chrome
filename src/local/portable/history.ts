/** Permanent create-once evidence; read-only and independent of delivery readiness. */
import type {GraphReader} from './relations.js';
import {requirePortable} from './format.js';
import {financialObject,scalarText,tupleText} from './json-values.js';

function payloadIdentity(raw:string,id:string):void{
  const data=financialObject(raw,'invalid_attempt_identity');
  requirePortable(scalarText(data.id,'invalid_attempt_identity')===id,'invalid_attempt_identity');
}

// Length-prefixed strings retain exact original payloads without delimiter
// ambiguity or relying on a hash as proof of payload equality.
const evidence=tupleText;

export async function validateHistory(reader:GraphReader):Promise<void>{
  for await(const _ of reader.rows('source_capture_leases'))requirePortable(false,'capture_not_quiescent');
  const jobs=new Set<string>(),authorizations=new Map<string,string>(),terminal=new Set<string>(),attempted=new Set<string>();
  for await(const row of reader.rows('capture_jobs'))jobs.add(row.id);
  for await(const row of reader.rows('processing_receipts'))terminal.add(row.bank_id);
  for await(const row of reader.rows('link_bank_members'))terminal.add(row.bank_id);
  for await(const row of reader.rows('delivery_attempts')){
    payloadIdentity(row.payload,row.zen_id);attempted.add(evidence(row.bank_id,row.zen_id,row.payload));
  }
  for await(const row of reader.rows('delivery_authorizations')){
    // A later click may authorize an earlier complete observation. Relations
    // already prove revision/account and the new job_accounts snapshot.
    requirePortable(jobs.has(row.job_id),'invalid_authorization_job');authorizations.set(row.bank_id,row.job_id);
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
