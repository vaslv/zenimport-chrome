/** Trusted capture bookkeeping shared by account setup and the capture owner. */
import type {RepositorySession} from './kernel.js';
import {int64} from './types.js';
import {CaptureError} from '../capture/errors.js';
import {capabilities} from '../capture/validation.js';
import type {RowByTable} from './schema.generated.js';
export function connectionCapabilities(row:RowByTable['connections']){
  try{const value=capabilities(JSON.parse(row.capabilities_json));if(!['bidv','vietinbank'].includes(row.bank)||value.details==='unavailable')throw new Error();return value;}
  catch{throw new CaptureError('capture_context_changed');}
}
export const text=(value:string)=>['text',value] as const;
export const ACTIVE=['planned','collecting','paused'];
export function aggregate(states:readonly string[]){for(const state of [...ACTIVE,'failed','cancelled'])if(states.includes(state))return state;return 'complete';}
export async function get<K extends 'bank_accounts'|'connections'|'capture_jobs'|'capture_intervals'|'bank_transactions'>(view:RepositorySession,table:K,id:string){
  const row=await view.get(table,[text(id)]);if(!row)throw new CaptureError('not_found');return row;
}
export async function addError(view:RepositorySession,jobId:string,accountId:string|null,code:string,now:string,retryable=false){
  if((await view.related('capture_errors',['job_id'],[text(jobId)])).some(row=>row.account_id===accountId&&row.code===code&&row.resolved==='0'))return;
  await view.insert('capture_errors',{id:crypto.randomUUID(),job_id:jobId,account_id:accountId,code,retryable:int64(retryable?'1':'0'),resolved:int64('0'),created_at:int64(now)});
}
export async function refreshJob(view:RepositorySession,jobId:string){
  const job=await get(view,'capture_jobs',jobId),intervals=await view.related('capture_intervals',['job_id'],[text(jobId)]);
  let state=aggregate(intervals.map(row=>row.state));if(state==='planned'&&job.worker_id!==null)state='collecting';
  await view.replace('capture_jobs',[text(jobId)],{...job,capture_state:state,...(!ACTIVE.includes(state)?{worker_id:null,lease_expires_at:null}:{})});
  for(const lock of await view.related('source_capture_leases',['job_id'],[text(jobId)]))if(!intervals.some(row=>row.account_id===lock.account_id&&ACTIVE.includes(row.state)))await view.remove('source_capture_leases',[text(lock.account_id)]);
}
export async function invalidateAccounts(view:RepositorySession,ids:ReadonlySet<string>,code:string,now:string,connectionId?:string){
  const changed=new Set<string>();
  for(const accountId of ids)for(const interval of await view.related('capture_intervals',['account_id'],[text(accountId)])){
    if(!ACTIVE.includes(interval.state)||connectionId!==undefined&&(await get(view,'capture_jobs',interval.job_id)).connection_id!==connectionId)continue;
    await view.replace('capture_intervals',[text(interval.id)],{...interval,state:code==='settings_conflict'?'cancelled':'failed'});
    await addError(view,interval.job_id,interval.account_id,code,now);changed.add(interval.job_id);
  }
  for(const id of changed)await refreshJob(view,id);
}
export async function canonicalSupport(view:RepositorySession){
  const discovered=await view.rows('connection_discovery'),supported=new Set(discovered.filter(row=>row.present==='1'&&row.supported==='1').map(row=>row.account_id));
  for(const account of await view.rows('bank_accounts')){
    const flag=int64(supported.has(account.id)?'1':'0');if(account.supported!==flag)await view.replace('bank_accounts',[text(account.id)],{...account,supported:flag});
  }
}
