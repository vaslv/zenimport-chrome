/** One bounded durable cycle. Every replay refreshes before considering a create. */
import type {DeliveryAuthorizationRepository} from '../storage/delivery-authorization-repository.js';
import type {DeliveryScheduleRepository} from '../storage/delivery-schedule-repository.js';
import type {OutboxRepository} from '../storage/outbox-repository.js';
import type {ReconciliationRepository} from '../storage/reconciliation-repository.js';
import type {CaptureRepository} from '../storage/capture-repository.js';
import type {LocalMirror} from '../zenmoney/mirror.js';
import type {DeliverySender} from './sender.js';
export class DeliveryWorker{
  constructor(private authorization:DeliveryAuthorizationRepository,private schedule:DeliveryScheduleRepository,
    private outbox:OutboxRepository,private mirror:LocalMirror,private reconciliation:ReconciliationRepository,
    private capture:CaptureRepository,private sender:DeliverySender,private clock:()=>number){}
  async next(){
    const pending=await this.authorization.pending();if(pending.length)return String(Math.floor(this.clock()));
    const status=await this.schedule.status(),outbox=await this.outbox.status();
    if(outbox&&outbox.phase!=='settled')return outbox.deadline;
    return status.work||status.refresh?status.schedule?.next_run_at??'0':null;
  }
  async run(){
    const now=()=>String(Math.floor(this.clock()));
    await this.authorization.drain(now());
    const lease=await this.schedule.claim(now());if(!lease)return {nextAt:await this.next(),sent:false};
    let sent=false;
    try{
      await this.outbox.recover(now());
      let state=await this.schedule.status();
      if(!state.work){const more=await this.schedule.refreshJobs(this.capture,now());await this.schedule.progress(lease.id,now(),'idle');return {...await this.schedule.finish(lease.id,now(),false,more),sent};}
      await this.schedule.progress(lease.id,now(),state.uncertain?'verifying':'reading');
      await this.mirror.refresh({force:true,transactions:state.uncertain});
      await this.schedule.renew(lease.id,now());
      const batch=await this.outbox.prepare(now());
      if(batch){
        await this.schedule.progress(lease.id,now(),'sending');
        const reply=await this.sender.send(batch.id);sent=true;
        // A successful exchange can omit some creates. Fetch the collection
        // explicitly; unknown absence is never permission to resend.
        await this.schedule.progress(lease.id,now(),'verifying',reply.error);
        await this.mirror.refresh({force:true,transactions:true});
      }
      await this.schedule.renew(lease.id,now());
      await this.reconciliation.run([],now());
      state=await this.schedule.status();
      const refresh=await this.schedule.refreshJobs(this.capture,now());
      await this.schedule.progress(lease.id,now(),state.uncertain?'paused':'idle',state.uncertain?'delivery_unknown':null);
      return {...await this.schedule.finish(lease.id,now(),state.uncertain||state.pending&&!sent,state.pending||refresh),sent};
    }catch(error){
      const code=(error as {code?:string}).code??'zenmoney_unavailable';
      // An old handler must never mutate a new mode/lease or clear its alarm.
      if(['stale_epoch','dataset_not_writable','recovery_required','storage_corrupt','quota_exceeded'].includes(code))throw error;
      await this.schedule.progress(lease.id,now(),'paused',code);
      const deferred=await this.schedule.finish(lease.id,now(),true,true);
      const pending=await this.outbox.status();
      return {...deferred,nextAt:pending&&pending.phase!=='settled'?pending.deadline:deferred.nextAt,sent};
    }
  }
}
