import {readJobRefresh,jobRefreshScope,markJobRefresh} from './job-refresh.js';
import type {JobRefresh} from './job-refresh.js';
import {readCycle,cycleScope} from './delivery-cycle.js';
import {readOutbox,outboxActive,outboxControl,outboxValue} from './outbox-control.js';
import type {OutboxItem,OutboxControl} from './outbox-control.js';
import {DeliveryError} from '../delivery/errors.js';
import {mirrorFresh} from '../reconciliation/freshness.js';
import {queueAuthorization,pendingAuthorizations,acknowledgeAuthorization} from './authorization-queue.js';
import type {AuthorizationTask} from './authorization-queue.js';
/** Internal transaction owner for named local repositories, never a UI service. */
import Dexie from 'dexie';
import type {ContextFence,DatasetSentinel,SentinelPort} from '../../control/types.js';
import {runtimeControl,datasetControl} from '../../control/validation.js';
import {FinancialDatabase} from './database.js';
import {readAnchor,assertAnchor} from './anchor.js';
import {participantControl} from './participant-validation.js';
import {RepositorySession,writeTransaction,writeSetupTransaction,writeExplicitSyncTransaction} from './kernel.js';
import {mirrorScope} from './mirror-scope.js';
import {requireStorage} from './types.js';
import {isDerivedCache} from './revisions.js';
import {financialStamp} from './source-stamp.js';
import type {FinancialSnapshot} from './source-stamp.js';
export type {FinancialSnapshot} from './source-stamp.js';
import {categoryControl,categoryScope,CATEGORY_TABLES,categoriesReady} from './category-control.js';
import type {CategoryCounts} from './category-control.js';
import {int64} from './types.js';
import type {TableName,RowByTable} from './schema.generated.js';
import {CaptureError} from '../capture/errors.js';

export class RepositoryOwner{
  private constructor(private db:FinancialDatabase,private sentinel:SentinelPort,readonly fence:ContextFence){}
  static async open(name:string,sentinel:SentinelPort,fence:ContextFence,allowSettings=false){
    const db=new FinancialDatabase(name,false);try{await db.open();const owner=new RepositoryOwner(db,sentinel,{...fence}),marker=await readAnchor(sentinel,fence.installationId);await db.transaction('r',db.tables,()=>owner.#context(marker,allowSettings));return owner;}
    catch(error){db.close();throw error;}
  }
  async #context(marker:DatasetSentinel,allowSettings=false){
      const root=runtimeControl(await assertAnchor(this.db,marker)),fence=this.fence;
      requireStorage(root.activeMode==='local'&&root.activeGeneration===fence.generation&&root.epoch===fence.epoch&&(fence.credentialEpoch===undefined||root.credentialEpoch===fence.credentialEpoch)&&root.pendingSwitchId===null,'stale_epoch');
      const dataset=datasetControl(await this.db.datasets.get(fence.generation)),participant=participantControl(await this.db.participants.get(dataset.participantId));
      requireStorage(dataset.lifecycle==='active'&&participant.state==='active'&&participant.generation===dataset.generation&&participant.epoch===dataset.participantEpoch,'dataset_not_writable');
      if(dataset.holdId!==null){
        const op=(await this.db.applicationState.get('account-settings:'+dataset.holdId))?.value;
        requireStorage(allowSettings&&op?.kind==='account-settings'&&op.id===dataset.holdId&&op.generation===fence.generation&&['check','invalidate','intervals','jobs','coverage','finish'].includes(op.phase as string),'dataset_not_writable');
      }
  }
  async read<T>(operation:(view:RepositorySession)=>Promise<T>){
    const marker=await readAnchor(this.sentinel,this.fence.installationId);
    return this.db.transaction('r',this.db.tables,async()=>{
      await this.#context(marker);const fence=this.fence;
      const view=new RepositorySession(this.db,fence.generation,Dexie.currentTransaction!,await mirrorScope(this.db,fence.generation));
      try{return await operation(view);}finally{view.close();}
    });
  }
  async #stamp(view:RepositorySession):Promise<FinancialSnapshot>{
    return financialStamp(this.db,runtimeControl(await this.db.runtime.get('runtime')),view);
  }
  async #unchanged(view:RepositorySession,expected:FinancialSnapshot){
    requireStorage(JSON.stringify(await this.#stamp(view))===JSON.stringify(expected),'stale_epoch');
  }
  async snapshot(){return this.read(view=>this.#stamp(view));}
  async scan<K extends TableName>(table:K,stamp:FinancialSnapshot,after:string|null=null){
    requireStorage(!isDerivedCache(table),'schema_unsupported');
    return this.read(async view=>{await this.#unchanged(view,stamp);return view.page(table,after);});
  }
  async check(stamp:FinancialSnapshot){return this.read(view=>this.#unchanged(view,stamp));}
  async apply<T>(stamp:FinancialSnapshot,operation:(view:RepositorySession)=>Promise<T>){
    return this.write(async view=>{await this.#unchanged(view,stamp);const result=await operation(view);return {result,stamp:await this.#stamp(view)};});
  }

  async claimDeliveryCycle(now:string){
    int64(now);return this.write(async view=>{
      const current=await readCycle(this.db,this.fence.generation),schedule=await view.get('delivery_schedule',[['integer',int64('1')]]);
      if(current&&BigInt(current.deadline)>BigInt(now)||schedule&&BigInt(schedule.next_run_at)>BigInt(now))return null;
      const lease={id:crypto.randomUUID(),deadline:String(BigInt(now)+180n)};
      await this.db.applicationState.put({scope:cycleScope(this.fence.generation),value:lease});return lease;
    });
  }
  async deliveryCycle<T>(id:string,now:string,work:(view:RepositorySession)=>Promise<T>,release=false){
    int64(now);return this.write(async view=>{
      const current=await readCycle(this.db,this.fence.generation);
      requireStorage(current?.id===id&&BigInt(current.deadline)>BigInt(now),'stale_epoch');
      const result=await work(view);
      if(release)await this.db.applicationState.delete(cycleScope(this.fence.generation));
      else await this.db.applicationState.put({scope:cycleScope(this.fence.generation),value:{id,deadline:String(BigInt(now)+180n)}});
      return result;
    });
  }

  async deliveryProgress(id:string,now:string,phase:'reading'|'sending'|'verifying'|'idle'|'paused',error:string|null=null){
    return this.deliveryCycle(id,now,async()=>{
      await this.db.applicationState.put({scope:'delivery-status:'+this.fence.generation,value:{phase,at:now,error}});
    });
  }
  async deliveryStatus(){return this.read(async()=> (await this.db.applicationState.get('delivery-status:'+this.fence.generation))?.value??null);}

  async pendingJobRefresh(){return this.read(()=>readJobRefresh(this.db,this.fence.generation));}
  async jobRefreshPage(){return this.read(async view=>{
    const control=await readJobRefresh(this.db,this.fence.generation);if(!control)return null;
    const page=await view.page('capture_jobs',control.after,20);return {control,ids:page.rows.map(row=>row.id),after:page.after,done:page.rows.length<20};
  });}
  async acknowledgeJobRefresh(control:JobRefresh,after:string|null,done:boolean){return this.write(async()=>{
    const current=await readJobRefresh(this.db,this.fence.generation);
    if(JSON.stringify(current)!==JSON.stringify(control))return false;
    if(done)await this.db.applicationState.delete(jobRefreshScope(this.fence.generation));
    else await this.db.applicationState.put({scope:jobRefreshScope(this.fence.generation),value:{...control,after}});
    return true;
  });}
  async deliveryWork(){
    const stamp=await this.snapshot(),cached=await this.read(async()=> (await this.db.applicationState.get('delivery-work:'+this.fence.generation))?.value);
    if(cached?.revision===stamp.revision&&typeof cached.pending==='boolean'&&typeof cached.uncertain==='boolean')return {pending:cached.pending,uncertain:cached.uncertain};
    let pending=false,uncertain=false,after:string|null=null;
    for(;;){
      const page:{rows:RowByTable['bank_processing'][];after:string|null}=await this.scan('bank_processing',stamp,after);
      uncertain=uncertain||page.rows.some(row=>row.state==='uncertain');
      const candidates=page.rows.filter(row=>['pending','prepared'].includes(row.state));
      if(!pending&&candidates.length)pending=await this.read(async view=>{await this.#unchanged(view,stamp);return (await view.getMany('delivery_authorizations',candidates.map(row=>[['text',row.bank_id]]))).some(row=>row!==null);});
      if(pending&&uncertain||page.rows.length<500)break;after=page.after;
    }
    await this.apply(stamp,async()=>{await this.db.applicationState.put({scope:'delivery-work:'+this.fence.generation,value:{revision:stamp.revision,pending,uncertain}});});
    return {pending,uncertain};
  }

  async outbox(){return this.read(()=>readOutbox(this.db,this.fence.generation));}
  async recoverOutbox(now:string,work:(view:RepositorySession,control:OutboxControl|null)=>Promise<void>){
    return this.write(async view=>{
      const control=await readOutbox(this.db,this.fence.generation);if(outboxActive(control,now))throw new DeliveryError('delivery_busy');
      await work(view,control);if(control&&control.phase!=='settled')await this.db.applicationState.put(outboxValue({...control,phase:'settled'}));
    });
  }
  async prepareOutbox(stamp:FinancialSnapshot,items:OutboxItem[],now:string,work:(view:RepositorySession)=>Promise<void>){
    const proposed=outboxControl({id:crypto.randomUUID(),deadline:int64(String(BigInt(int64(now))+60n)),source:stamp,items,phase:'prepared'});
    return this.write(async view=>{
      await this.#unchanged(view,stamp);const old=await readOutbox(this.db,this.fence.generation);
      if(outboxActive(old,now))throw new DeliveryError('delivery_busy');
      if(old)for(const item of old.items)requireStorage((await view.get('deliveries',[['text',item.zen_id]]))?.state!=='attempting','invariant_violation');
      await work(view);const control={...proposed,source:await this.#stamp(view)};await this.db.applicationState.put(outboxValue(control));return control;
    });
  }
  async dispatchOutbox(id:string,now:string){
    return this.write(async view=>{
      const control=await readOutbox(this.db,this.fence.generation);
      if(!control||control.id!==id||control.phase!=='prepared'||!outboxActive(control,now))throw new DeliveryError('delivery_unknown');
      // Progress/capture writes may advance the financial revision after intent.
      // The exact mirror/credential/authority and this immutable authorization
      // must still match; unrelated progress cannot strand a never-sent intent.
      const current=await this.#stamp(view);requireStorage(JSON.stringify({...control.source,revision:current.revision})===JSON.stringify(current),'stale_epoch');
      requireStorage(mirrorFresh(await view.get('zen_mirror_state',[['integer',int64('1')]])??undefined,control.source,now),'stale_epoch');
      for(const item of control.items){
        const row=await view.get('deliveries',[['text',item.zen_id]]);requireStorage(row?.bank_id===item.bank_id&&row.ever_attempted==='1'&&row.state==='attempting'&&row.payload===item.payload,'invariant_violation');
        const bank=await view.get('bank_transactions',[['text',item.bank_id]]),authorization=await view.get('delivery_authorizations',[['text',item.bank_id]]),processing=await view.get('bank_processing',[['text',item.bank_id]]);
        requireStorage(bank&&authorization&&processing?.state==='uncertain'&&row.authorized_job_id===authorization.job_id,'stale_epoch');
        const account=await view.get('bank_accounts',[['text',bank.account_id]]),proof=await view.get('captured_records',[['text',authorization.interval_id],['text',item.bank_id]]),interval=await view.get('capture_intervals',[['text',authorization.interval_id]]),snapshot=await view.get('job_accounts',[['text',authorization.job_id],['text',bank.account_id]]);
        requireStorage(account?.selection==='enabled'&&account.supported==='1'&&account.settings_version===authorization.settings_version&&account.zenmoney_account_id===authorization.target_id&&proof?.revision===authorization.revision&&interval?.state==='complete'&&interval.account_id===bank.account_id&&snapshot?.settings_version===authorization.settings_version&&snapshot.target_id===authorization.target_id,'stale_epoch');
        requireStorage(await view.count('processing_receipts',[['text',item.bank_id]])===0&&await view.find('link_bank_members',['bank_id'],[['text',item.bank_id]])===null&&await view.get('bank_exclusions',[['text',item.bank_id]])===null&&await view.get('zen_exclusions',[['text',item.zen_id]])===null,'stale_epoch');
      }
      const next={...control,phase:'dispatching' as const,deadline:int64(String(BigInt(int64(now))+60n))};await this.db.applicationState.put(outboxValue(next));return next;
    });
  }
  async finishOutbox(id:string,work:(view:RepositorySession,control:OutboxControl)=>Promise<void>){
    return this.write(async view=>{
      const control=await readOutbox(this.db,this.fence.generation);
      if(!control||control.id!==id||control.phase==='settled')throw new DeliveryError('delivery_unknown');
      await work(view,control);
      // A failed delivery response may have started a shadow mirror publication.
      // Its unpublished stage stays collectible; only its own read lease clears.
      const key='mirror:'+this.fence.generation,mirror=(await this.db.applicationState.get(key))?.value;
      if(mirror&&typeof mirror.lease==='object'&&mirror.lease!==null&&(mirror.lease as {id?:unknown}).id===id)
        await this.db.applicationState.put({scope:key,value:{...mirror,lease:null}});
      await this.db.applicationState.put(outboxValue({...control,phase:'settled'}));
    });
  }

  /** Called within the same command transaction that accepts a click/page end. */
  async queueAuthorization(view:RepositorySession,jobId:string,now:string){
    requireStorage(await view.get('capture_jobs',[['text',jobId]])!==null,'invariant_violation');
    await queueAuthorization(this.db,this.fence.generation,jobId,now);
    await markJobRefresh(this.db,this.fence.generation);
  }
  async pendingAuthorizations(){return this.read(()=>pendingAuthorizations(this.db,this.fence.generation));}
  async acknowledgeAuthorization(task:AuthorizationTask){return this.write(()=>acknowledgeAuthorization(this.db,this.fence.generation,task));}

  async categoriesReady(stamp:FinancialSnapshot){
    return this.read(async view=>{await this.#unchanged(view,stamp);return categoriesReady(this.db,stamp);});
  }
  async beginCategories(stamp:FinancialSnapshot,id:string,counts:CategoryCounts){
    const control=categoryControl({id,state:'building',source:stamp,counts});
    return this.write(async view=>{await this.#unchanged(view,stamp);await this.db.applicationState.put({scope:categoryScope(stamp.generation),value:control as unknown as Record<string,unknown>});});
  }
  async categoryUnit<T>(stamp:FinancialSnapshot,id:string,work:(view:RepositorySession)=>Promise<T>){
    return this.write(async view=>{
      await this.#unchanged(view,stamp);const scope=categoryScope(stamp.generation),control=categoryControl((await this.db.applicationState.get(scope))?.value);
      requireStorage(control.id===id&&control.state==='building'&&JSON.stringify(control.source)===JSON.stringify(stamp),'stale_epoch');
      const result=await work(view),next=await this.#stamp(view);await this.db.applicationState.put({scope,value:{...control,source:next}});return {result,stamp:next};
    });
  }
  async completeCategories(stamp:FinancialSnapshot,id:string){
    return this.write(async view=>{
      await this.#unchanged(view,stamp);const scope=categoryScope(stamp.generation),control=categoryControl((await this.db.applicationState.get(scope))?.value);
      requireStorage(control.id===id&&control.state==='building'&&JSON.stringify(control.source)===JSON.stringify(stamp),'stale_epoch');
      for(const table of CATEGORY_TABLES)requireStorage(await this.db.financial(table).where('generation').equals(stamp.generation).count()===control.counts[table],'invariant_violation');
      await this.db.applicationState.put({scope,value:{...control,state:'ready'}});
    });
  }

  async knownMirrorCurrent(stamp:FinancialSnapshot){
    return this.read(async view=>{
      await this.#unchanged(view,stamp);const value=(await this.db.applicationState.get('known-mirror:'+stamp.generation))?.value;
      if(value===undefined)return false;
      requireStorage(value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='mirror,projection,revision'&&typeof value.mirror==='string'&&typeof value.projection==='string'&&typeof value.revision==='string'&&BigInt(int64(value.revision))>=0n,'storage_corrupt');
      return value.projection===stamp.projection&&value.mirror===stamp.mirror&&value.revision===stamp.revision;
    });
  }
  async confirmKnownMirror(stamp:FinancialSnapshot){
    return this.write(async view=>{await this.#unchanged(view,stamp);await this.db.applicationState.put({scope:'known-mirror:'+stamp.generation,value:{projection:stamp.projection,mirror:stamp.mirror,revision:stamp.revision}});});
  }

  async setup<T>(operation:(view:RepositorySession)=>Promise<T>){
    let rejection:CaptureError|undefined;
    try{return await writeSetupTransaction(this.db,this.sentinel,this.fence,async view=>{
      try{return await operation(view);}catch(error){if(error instanceof CaptureError)rejection=error;throw error;}
    });}catch(error){throw rejection??error;}
  }
  async write<T>(operation:(view:RepositorySession)=>Promise<T>){
    let rejection:CaptureError|DeliveryError|undefined;
    try{return await writeTransaction(this.db,this.sentinel,this.fence,async view=>{
      try{return await operation(view);}catch(error){if(error instanceof CaptureError||error instanceof DeliveryError)rejection=error;throw error;}
    });}catch(error){throw rejection??error;}
  }
  /** Failed imported starts roll back the job and its sending-barrier release. */
  async explicitSync<T>(requestId:string,operation:(view:RepositorySession)=>Promise<T>,clock:()=>number):Promise<T>{
    let rejection:CaptureError|undefined;
    try{
      const result=await writeExplicitSyncTransaction(this.db,this.sentinel,this.fence,requestId,clock,async(view,releasing)=>{
        try{return {ok:true as const,value:await operation(view)};}
        catch(error){
          if(error instanceof CaptureError){rejection=error;if(!releasing&&error.persist)return {ok:false as const,error};}
          throw error;
        }
      });
      if(!result.ok)throw result.error;return result.value;
    }catch(error){throw rejection??error;}
  }
  /** A business failure may intentionally commit its paused/failed evidence. */
  async command<T>(operation:(view:RepositorySession)=>Promise<T>):Promise<T>{
    const result=await this.write(async view=>{
      try{return {ok:true as const,value:await operation(view)};}
      catch(error){if(error instanceof CaptureError&&error.persist)return {ok:false as const,error};throw error;}
    });
    if(!result.ok)throw result.error;return result.value;
  }
  close(){this.db.close();}
}
