/** Durable authorization can be reconstructed after a committed capture/restart. */
import type {ContextFence,SentinelPort} from '../../control/types.js';
import {RepositoryOwner} from './repository-owner.js';
import {readSource} from '../reconciliation/source.js';
import {authorizeJob} from '../delivery/authorization.js';
import {int64} from './types.js';
import {uuid} from '../capture/commands.js';
const text=(value:string)=>['text',value] as const;
export class DeliveryAuthorizationRepository{
  private constructor(private owner:RepositoryOwner){}
  static async open(name:string,sentinel:SentinelPort,fence:ContextFence){return new DeliveryAuthorizationRepository(await RepositoryOwner.open(name,sentinel,fence));}
  async authorize(jobId:string,now:string){
    jobId=uuid(jobId);int64(now);const source=await readSource(this.owner),rows=authorizeJob(source,jobId,now);let stamp=source.stamp;
    for(let offset=0;offset<rows.length;offset+=200)stamp=(await this.owner.apply(stamp,async view=>{
      for(const row of rows.slice(offset,offset+200)){
        const key=[text(row.bank_id)],previous=await view.get('delivery_authorizations',key);
        if(previous)await view.replace('delivery_authorizations',key,row);else await view.insert('delivery_authorizations',row);
      }
    })).stamp;
    await this.owner.apply(stamp,async view=>{
      const key=[['integer',int64('1')]] as const,schedule={id:int64('1'),next_run_at:int64(now),failures:int64('0')};
      if(await view.get('delivery_schedule',key))await view.replace('delivery_schedule',key,schedule);else await view.insert('delivery_schedule',schedule);
    });
    return {authorized:rows.length};
  }
  close(){this.owner.close();}
}
