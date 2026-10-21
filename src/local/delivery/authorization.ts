/** A click may authorize previously completed physical-account capture revisions. */
import type {SourceSnapshot} from '../reconciliation/source.js';
import {sourceFacts} from '../reconciliation/facts.js';
import type {RowByTable} from '../storage/schema.generated.js';
import {int64} from '../storage/types.js';
import {requireCapture} from '../capture/errors.js';
export function authorizeJob(source:SourceSnapshot,jobId:string,now:string):RowByTable['delivery_authorizations'][] {
  const rows=source.rows,job=rows.capture_jobs.find(row=>row.id===jobId);requireCapture(job,'not_found');
  const facts=sourceFacts(source),accounts=new Map(rows.bank_accounts.map(row=>[row.id,row])),snapshots=new Map(rows.job_accounts.filter(row=>row.job_id===jobId).map(row=>[row.account_id,row]));
  const intervals=new Map(rows.capture_intervals.filter(row=>row.state==='complete').map(row=>[row.id,row]));
  const states=new Map(rows.bank_processing.map(row=>[row.bank_id,row.state])),attempted=new Set(rows.deliveries.filter(row=>row.ever_attempted==='1').map(row=>row.bank_id));
  const ordered=rows.captured_records.filter(row=>intervals.has(row.interval_id)).slice().sort((a,b)=>a.bank_id<b.bank_id?-1:a.bank_id>b.bank_id?1:BigInt(a.revision)>BigInt(b.revision)?-1:BigInt(a.revision)<BigInt(b.revision)?1:a.interval_id<b.interval_id?-1:a.interval_id>b.interval_id?1:0);
  const result:RowByTable['delivery_authorizations'][]=[],seen=new Set<string>();
  for(const captured of ordered){
    if(seen.has(captured.bank_id)||attempted.has(captured.bank_id)||!['pending','prepared'].includes(states.get(captured.bank_id)??''))continue;
    const current=facts.banks.get(captured.bank_id),account=current&&accounts.get(current.account_id),snapshot=account&&snapshots.get(account.id),interval=intervals.get(captured.interval_id)!;
    if(!account||!snapshot||account.selection!=='enabled'||account.settings_version!==snapshot.settings_version||account.zenmoney_account_id!==snapshot.target_id||interval.account_id!==account.id)continue;
    const bank=facts.revisions.get(JSON.stringify([captured.bank_id,captured.revision]));requireCapture(bank,'history_incomplete');
    if(bank.local_date<snapshot.authorized_start||bank.local_date>job.end_date)continue;
    seen.add(bank.id);result.push({bank_id:bank.id,revision:int64(captured.revision),job_id:jobId,interval_id:captured.interval_id,settings_version:snapshot.settings_version,target_id:snapshot.target_id,
      source_hash:rows.zen_mirror_state[0]?.source_hash??null,authorized_at:int64(now)});
  }
  return result;
}
