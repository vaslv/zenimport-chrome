/** Fixed bounded journal transition shared by response publication and recovery. */
import type {RepositorySession} from './kernel.js';
import type {OutboxControl} from './outbox-control.js';
import {int64,requireStorage} from './types.js';
export type AttemptOutcome='response_applied'|'response_superseded'|'write_outcome_unknown';
export async function finishAttempts(view:RepositorySession,control:OutboxControl,outcome:AttemptOutcome,now:string){
  const at=int64(now);
  for(const item of control.items){
    const key=[['text',item.zen_id]] as const,row=await view.get('deliveries',key);
    requireStorage(row?.bank_id===item.bank_id&&row.ever_attempted==='1'&&row.payload===item.payload,'invariant_violation');
    await view.insert('delivery_attempts',{id:crypto.randomUUID(),bank_id:item.bank_id,zen_id:item.zen_id,at,outcome,payload:item.payload});
    if(row.state==='attempting')await view.replace('deliveries',key,{...row,state:'uncertain',updated_at:at});
  }
}
