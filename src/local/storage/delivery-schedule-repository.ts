/** Durable backoff and short cycle ownership, independent of popup lifetime. */
import type {ContextFence,SentinelPort} from '../../control/types.js';
import {RepositoryOwner} from './repository-owner.js';
import {int64} from './types.js';
const one=[['integer',int64('1')]] as const;
export class DeliveryScheduleRepository{
  private constructor(private owner:RepositoryOwner){}
  static async open(name:string,sentinel:SentinelPort,fence:ContextFence){return new DeliveryScheduleRepository(await RepositoryOwner.open(name,sentinel,fence));}
  async status(){
    const {uncertain,pending}=await this.owner.deliveryWork(),refresh=await this.owner.pendingJobRefresh();
    const schedule=await this.owner.read(view=>view.get('delivery_schedule',one));
    return {work:uncertain||pending,uncertain,pending,refresh:refresh!==null,schedule};
  }
  async refreshJobs(capture:{get(id:string,now:string):Promise<unknown>},now:string){
    const page=await this.owner.jobRefreshPage();if(!page)return false;
    for(const id of page.ids)await capture.get(id,now);
    await this.owner.acknowledgeJobRefresh(page.control,page.after,page.done);
    return (await this.owner.pendingJobRefresh())!==null;
  }
  async progress(id:string,now:string,phase:'reading'|'sending'|'verifying'|'idle'|'paused',error:string|null=null){return this.owner.deliveryProgress(id,now,phase,error);}
  async display(){return this.owner.deliveryStatus();}
  async claim(now:string){return this.owner.claimDeliveryCycle(now);}
  async renew(id:string,now:string){return this.owner.deliveryCycle(id,now,async()=>{});}
  async finish(id:string,now:string,retry:boolean,more:boolean){
    return this.owner.deliveryCycle(id,now,async view=>{
      const previous=await view.get('delivery_schedule',one),failures=BigInt(previous?.failures??'0');
      const delay=retry?(15n<< (failures>5n?5n:failures)):0n,next=BigInt(now)+(delay>300n?300n:delay);
      const row={id:int64('1'),next_run_at:int64(String(next)),failures:int64(retry?String(failures>=5n?5n:failures+1n):'0')};
      if(previous)await view.replace('delivery_schedule',one,row);else await view.insert('delivery_schedule',row);
      return {nextAt:retry||more?row.next_run_at:null,failures:row.failures};
    },true);
  }
  close(){this.owner.close();}
}
