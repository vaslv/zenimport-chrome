import {finishAttempts} from './outbox-write.js';
import {DomainError} from '../../domain/errors.js';
/** Immutable attempts commit before any SDK dispatch; uncertainty never retries. */
import type {ContextFence,SentinelPort} from '../../control/types.js';
import {RepositoryOwner} from './repository-owner.js';
import {ReconciliationRepository} from './reconciliation-repository.js';
import {readSource} from '../reconciliation/source.js';
import {sourceFacts} from '../reconciliation/facts.js';
import {deliveryCandidates,intentPlan} from '../delivery/intents.js';
import {addError} from './capture-policy.js';
import {int64,requireStorage} from './types.js';
const text=(value:string)=>['text',value] as const;
export class OutboxRepository{
  private constructor(private name:string,private sentinel:SentinelPort,private owner:RepositoryOwner){}
  static async open(name:string,sentinel:SentinelPort,fence:ContextFence){return new OutboxRepository(name,sentinel,await RepositoryOwner.open(name,sentinel,fence));}
  async status(){return this.owner.outbox();}
  async observed(id:string){
    const control=await this.owner.outbox();
    return this.owner.read(async view=>{
      if(control?.id!==id||control.phase!=='settled')return false;
      for(const item of control.items)if(!await view.get('zen_entities',[text('transaction'),text(item.zen_id)])&&
        !await view.get('zen_tombstones',[text('transaction'),text(item.zen_id)]))return false;
      return true;
    });
  }
  async recover(now:string){
    int64(now);let recovered=0;
    await this.owner.recoverOutbox(now,async(view,control)=>{
      if(!control)return;
      for(const item of control.items){
        const row=await view.get('deliveries',[text(item.zen_id)]);requireStorage(row?.bank_id===item.bank_id&&row.ever_attempted==='1'&&row.payload===item.payload,'invariant_violation');
        if(row.state==='attempting'){await view.replace('deliveries',[text(item.zen_id)],{...row,state:'uncertain',updated_at:int64(now)});recovered++;}
        const processing=await view.get('bank_processing',[text(item.bank_id)]);requireStorage(processing,'invariant_violation');
        if(['pending','prepared'].includes(processing.state)||processing.state==='uncertain'&&processing.reason==='write_intent')await view.replace('bank_processing',[text(item.bank_id)],{...processing,state:'uncertain',reason:'write_outcome_unknown',updated_at:int64(now)});
      }
    });return {recovered};
  }
  async prepare(now:string){
    int64(now);await this.recover(now);let source=await readSource(this.owner),facts=sourceFacts(source);
    const eligible=deliveryCandidates(source,facts,now).candidates,selected=eligible.map(({authorization})=>({bank_id:authorization.bank_id,revision:authorization.revision,target_id:authorization.target_id}));
    const reconciliation=await ReconciliationRepository.open(this.name,this.sentinel,this.owner.fence);
    let matched;try{matched=await reconciliation.run(selected,now,source.stamp);}finally{reconciliation.close();}
    source=await readSource(this.owner);requireStorage(JSON.stringify(source.stamp)===JSON.stringify(matched.stamp),'stale_epoch');facts=sourceFacts(source);
    const plan=intentPlan(source,facts,now,new Set(matched.blocked));let stamp=source.stamp;
    const recognized=new Set(matched.recognized),scopes=new Set(eligible.filter(row=>recognized.has(row.bank.id)).map(row=>JSON.stringify([row.authorization.job_id,row.bank.account_id])));
    const resolved=source.rows.capture_errors.filter(row=>row.resolved==='0'&&(row.code==='existing_ownership_unknown'||['zenmoney_account_unavailable','settings_conflict','account_disabled'].includes(row.code)&&scopes.has(JSON.stringify([row.job_id,row.account_id]))));
    const errors=[...new Map(plan.errors.map(row=>[JSON.stringify([row.job_id,row.account_id,row.code]),row])).values()];
    for(let offset=0;offset<resolved.length;offset+=200)stamp=(await this.owner.apply(stamp,async view=>{
      for(const row of resolved.slice(offset,offset+200))await view.replace('capture_errors',[text(row.id)],{...row,resolved:int64('1')});
    })).stamp;
    for(let offset=0;offset<errors.length;offset+=200)stamp=(await this.owner.apply(stamp,async view=>{
      for(const row of errors.slice(offset,offset+200))await addError(view,row.job_id,row.account_id,row.code,now,row.code!=='existing_ownership_unknown');
    })).stamp;
    if(!plan.intents.length)return null;
    const items=plan.intents.map(({candidate,id,payload})=>({bank_id:candidate.bank.id,zen_id:id,payload}));
    const selectedScopes=new Set(plan.intents.map(({candidate})=>JSON.stringify([candidate.authorization.job_id,candidate.bank.account_id])));
    const intentErrors=source.rows.capture_errors.filter(row=>row.resolved==='0'&&['zenmoney_account_unavailable','settings_conflict','account_disabled'].includes(row.code)&&selectedScopes.has(JSON.stringify([row.job_id,row.account_id])));
    if(intentErrors.length>200)throw new DomainError('unsupported_scenario');
    return this.owner.prepareOutbox(stamp,items,now,async view=>{
      for(const row of intentErrors)await view.replace('capture_errors',[text(row.id)],{...row,resolved:int64('1')});
      for(const {candidate,id,payload}of plan.intents){
        const {bank,authorization,prior}=candidate,row={bank_id:bank.id,zen_id:id,payload,state:'attempting',ever_attempted:int64('1'),origin:prior?.origin??'sync',authorized_job_id:authorization.job_id,updated_at:int64(now),needs_rebuild:int64('0')};
        if(prior)await view.replace('deliveries',[text(id)],row);else await view.insert('deliveries',row);
        const processing=await view.get('bank_processing',[text(bank.id)]);requireStorage(processing,'invariant_violation');
        await view.replace('bank_processing',[text(bank.id)],{...processing,state:'uncertain',reason:'write_intent',updated_at:int64(now)});
        const target=await view.get('processing_targets',[text(bank.id),text(id)]);
        if(target)requireStorage(target.target_id===authorization.target_id,'invariant_violation');else await view.insert('processing_targets',{bank_id:bank.id,zen_id:id,target_id:authorization.target_id,origin:'delivery_intent',at:int64(now)});
        await view.insert('delivery_attempts',{id:crypto.randomUUID(),bank_id:bank.id,zen_id:id,at:int64(now),outcome:'intent',payload});
        await addError(view,authorization.job_id,null,'delivery_uncertain',now,true);
        const job=await view.get('capture_jobs',[text(authorization.job_id)]);requireStorage(job,'invariant_violation');await view.replace('capture_jobs',[text(job.id)],{...job,delivery_state:'running'});
      }
    });
  }
  async dispatch(id:string,now:string){return this.owner.dispatchOutbox(id,now);}
  async finish(id:string,outcome:'response_applied'|'response_superseded'|'write_outcome_unknown',now:string){
    int64(now);await this.owner.finishOutbox(id,async(view,control)=>{
      await finishAttempts(view,control,outcome,now);
    });
  }
  close(){this.owner.close();}
}
