/** Exact create-only plans. Only a fenced outbox may persist/dispatch these. */
import {transactions,decimal,encodeJson,ValidationError} from 'zenmoney-typescript';
import type {SourceSnapshot} from '../reconciliation/source.js';
import type {Facts,BankFact,FinancialObject} from '../reconciliation/facts.js';
import {instrumentText} from '../reconciliation/facts.js';
import {revisionKey} from '../../domain/reconciliation/ownership.js';
import {timestampProjection} from '../../domain/bank-record.js';
import {sourceFresh} from '../reconciliation/freshness.js';
import {jsonTruthy} from '../portable/json-values.js';
import type {RowByTable} from '../storage/schema.generated.js';
import {int64} from '../storage/types.js';
import {CaptureError,requireCapture} from '../capture/errors.js';
import {categoryModel} from '../reconciliation/categories.js';
import {predictCategory} from '../../domain/prediction/categories.js';
import type {CaptureCode} from '../capture/errors.js';
export const DELIVERY_BATCH_SIZE=20;
export interface DeliveryCandidate{authorization:RowByTable['delivery_authorizations'];bank:BankFact;account:FinancialObject;prior:RowByTable['deliveries']|null}
export interface DeliveryProblem{job_id:string;account_id:string;code:CaptureCode}
export function deliveryCandidates(source:SourceSnapshot,facts:Facts,now:string){
  if(!sourceFresh(source,now))throw new CaptureError('zenmoney_unavailable',true);
  const rows=source.rows,states=new Map(rows.bank_processing.map(row=>[row.bank_id,row.state])),deliveries=new Map(rows.deliveries.map(row=>[row.bank_id,row]));
  const blocked=new Set([...rows.delivery_attempts,...rows.processing_receipts,...rows.link_bank_members,...rows.bank_exclusions].map(row=>row.bank_id));
  const intervals=new Map(rows.capture_intervals.map(row=>[row.id,row])),proofs=new Map(rows.captured_records.map(row=>[JSON.stringify([row.interval_id,row.bank_id]),row]));
  const snapshots=new Map(rows.job_accounts.map(row=>[JSON.stringify([row.job_id,row.account_id]),row])),jobs=new Map(rows.capture_jobs.map(row=>[row.id,row]));
  const deleted=new Set(rows.zen_tombstones.filter(row=>row.kind==='transaction').map(row=>row.entity_id));
  const candidates:DeliveryCandidate[]=[],errors:DeliveryProblem[]=[];
  const ordered=[...rows.delivery_authorizations].sort((a,b)=>BigInt(a.authorized_at)<BigInt(b.authorized_at)?-1:BigInt(a.authorized_at)>BigInt(b.authorized_at)?1:a.bank_id<b.bank_id?-1:a.bank_id>b.bank_id?1:0);
  for(const authorization of ordered){
    const prior=deliveries.get(authorization.bank_id)??null;
    if(!['pending','prepared'].includes(states.get(authorization.bank_id)??'')||prior?.ever_attempted==='1'||prior&&['delivered','suppressed'].includes(prior.state)||blocked.has(authorization.bank_id)||deleted.has(prior?.zen_id??''))continue;
    const current=facts.banks.get(authorization.bank_id),physical=current&&facts.accounts.get(current.account_id);
    try{
      requireCapture(current&&physical,'history_incomplete');
      requireCapture(physical.selection==='enabled'&&physical.supported==='1','account_disabled');
      requireCapture(physical.settings_version===authorization.settings_version&&physical.zenmoney_account_id===authorization.target_id,'settings_conflict');
      requireCapture(authorization.source_hash!==null&&authorization.source_hash===rows.zen_mirror_state[0]?.source_hash,'zenmoney_unavailable');
      const bank=facts.revisions.get(revisionKey(authorization.bank_id,authorization.revision)),interval=intervals.get(authorization.interval_id),proof=proofs.get(JSON.stringify([authorization.interval_id,authorization.bank_id]));
      const snapshot=snapshots.get(JSON.stringify([authorization.job_id,current.account_id])),job=jobs.get(authorization.job_id);
      requireCapture(bank&&interval?.state==='complete'&&interval.account_id===bank.account_id&&proof?.revision===authorization.revision&&snapshot&&job,'history_incomplete');
      requireCapture(snapshot.settings_version===authorization.settings_version&&snapshot.target_id===authorization.target_id,'settings_conflict');
      requireCapture(bank.local_date>=snapshot.authorized_start&&bank.local_date<=job.end_date,'history_incomplete');
      const account=facts.entities.get('account')?.get(authorization.target_id),instrument=account&&instrumentText(account.instrument),user=account&&instrumentText(account.user);
      requireCapture(account&&typeof account.id==='string'&&account.id===authorization.target_id&&!jsonTruthy(account.archive)&&['cash','ccard','checking','deposit','emoney'].includes(account.type as string)&&instrument!==null&&instrument!==undefined&&facts.instruments.get(instrument)===bank.currency&&user!==null&&user!==undefined,'zenmoney_account_unavailable');
      candidates.push({authorization,bank,account,prior});
    }catch(error){if(!(error instanceof CaptureError))throw error;requireCapture(current,'history_incomplete');errors.push({job_id:authorization.job_id,account_id:current.account_id,code:error.code});}
  }
  return {candidates,errors};
}
export function createPayload(candidate:DeliveryCandidate,category:string|null,id:string,now:string){
  const {bank,account,authorization}=candidate,created=bank.occurred_at==null?BigInt(int64(now)):timestampProjection(bank.occurred_at).micros/1000000n;
  const builder=bank.direction==='income'?transactions.income:transactions.expense;
  const payload=builder({id,now:created,user:BigInt(instrumentText(account.user)!),date:bank.local_date,account:authorization.target_id,instrument:BigInt(instrumentText(account.instrument)!),amount:decimal(bank.amount),
    categories:category?[category]:null,payee:bank.beneficiary_name,comment:bank.description,viewed:false});
  payload.changed=BigInt(int64(now));return encodeJson(payload);
}

export function retainedTransactionIds(source:SourceSnapshot){
  return new Set([...source.rows.zen_entities.filter(row=>row.kind==='transaction').map(row=>row.id),...source.rows.zen_tombstones.filter(row=>row.kind==='transaction').map(row=>row.entity_id),
    ...source.rows.delivery_attempts.map(row=>row.zen_id),...source.rows.processing_receipts.map(row=>row.zen_id),...source.rows.processing_targets.map(row=>row.zen_id),...source.rows.link_zen_members.map(row=>row.zen_id),...source.rows.zen_exclusions.map(row=>row.zen_id)]);
}
export function intentPlan(source:SourceSnapshot,facts:Facts,now:string,blocked:ReadonlySet<string>,uuid:()=>string=()=>crypto.randomUUID()){
  const {candidates,errors}=deliveryCandidates(source,facts,now),model=categoryModel(source,facts),reserved=new Map(source.rows.deliveries.map(row=>[row.zen_id,row.bank_id])),remote=retainedTransactionIds(source);
  const intents:{candidate:DeliveryCandidate;id:string;payload:string}[]=[];
  for(const candidate of candidates){
    const {bank,authorization,prior}=candidate;
    if(blocked.has(bank.id)){errors.push({job_id:authorization.job_id,account_id:bank.account_id,code:'existing_ownership_unknown'});continue;}
    if(intents.length>=DELIVERY_BATCH_SIZE)continue;
    try{
      const id=prior?.zen_id??uuid();requireCapture(!remote.has(id)&&(!reserved.has(id)||reserved.get(id)===bank.id),'delivery_uncertain');
      const category=predictCategory(bank,model.context,true).category_id,payload=createPayload(candidate,category,id,now);
      reserved.set(id,bank.id);intents.push({candidate,id,payload});
    }catch(error){if(!(error instanceof CaptureError)&&!(error instanceof ValidationError))throw error;errors.push({job_id:authorization.job_id,account_id:bank.account_id,code:error instanceof CaptureError?error.code:'zenmoney_account_unavailable'});}
  }
  return {intents,errors};
}
