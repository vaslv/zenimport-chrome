import {assertSetup} from './setup-permit.js';
/** Resumable account settings under an exclusive, durable local dataset hold. */
import Dexie from 'dexie';
import type {ContextFence,SentinelPort} from '../../control/types.js';
import {runtimeControl,datasetControl} from '../../control/validation.js';
import {FinancialDatabase} from './database.js';
import type {RepositorySession} from './kernel.js';
import {RepositorySession as Session} from './kernel.js';
import {readAnchor,assertAnchor} from './anchor.js';
import {participantControl} from './participant-validation.js';
import {mirrorScope} from './mirror-scope.js';
import {int64,requireStorage,storageFailure} from './types.js';
import {unpackRow,encodeKey} from './cells.js';
import {CaptureError,requireCapture} from '../capture/errors.js';
import type {CaptureCode} from '../capture/errors.js';
import {settings} from '../capture/validation.js';
import type {LocalSettings} from '../capture/validation.js';
import {canonicalDto} from '../../domain/codec.js';
import {decodeJson} from 'zenmoney-typescript';
import type {JsonObject} from 'zenmoney-typescript';
import {jsonTruthy} from '../portable/json-values.js';
import {localDay} from '../../domain/dates.js';
import {shiftDays} from '../../domain/periods.js';
import {text,get,connectionCapabilities,ACTIVE,addError,refreshJob} from './capture-policy.js';
import {accountView} from './account-views.js';

type Phase='check'|'invalidate'|'intervals'|'jobs'|'coverage'|'finish'|'complete'|'failed';
interface Setup{
  kind:'account-settings';id:string;generation:string;accountId:string;request:string;desired:LocalSettings;
  oldTarget:string|null;nextVersion:string;createdAt:string;phase:Phase;after:string|null;jobs:string[];nextJob:number;
  frontier:string|null;error:CaptureCode|null;result:ReturnType<typeof accountView>|null;
}
const scope=(id:string)=>'account-settings:'+id;
function operation(value:unknown,id:string,generation:string):Setup{
  requireStorage(value!==null&&typeof value==='object'&&!Array.isArray(value),'storage_corrupt');const row=value as Setup;
  requireStorage(row.kind==='account-settings'&&row.id===id&&row.generation===generation&&typeof row.accountId==='string'&&
    typeof row.request==='string'&&['check','invalidate','intervals','jobs','coverage','finish','complete','failed'].includes(row.phase)&&
    (row.after===null||typeof row.after==='string')&&Array.isArray(row.jobs)&&row.jobs.every(id=>typeof id==='string')&&
    Number.isSafeInteger(row.nextJob)&&row.nextJob>=0&&row.nextJob<=row.jobs.length,'storage_corrupt');
  requireStorage(row.request===canonicalDto({account_id:row.accountId,...settings(row.desired)})&&int64(row.nextVersion)===String(BigInt(row.desired.expected_version)+1n),'storage_corrupt');int64(row.createdAt);return row;
}
export class AccountSettingsOwner{
  private constructor(private db:FinancialDatabase,private sentinel:SentinelPort,private fence:ContextFence){}
  static async open(name:string,sentinel:SentinelPort,fence:ContextFence){
    const db=new FinancialDatabase(name,false);try{await db.open();return new AccountSettingsOwner(db,sentinel,{...fence});}catch(error){db.close();throw error;}
  }
  async #unit<T>(expected:string|null|'existing',work:(view:RepositorySession,dataset:ReturnType<typeof datasetControl>)=>Promise<T>){
    const marker=await readAnchor(this.sentinel,this.fence.installationId,true);
    try{return await this.db.transaction('rw',this.db.tables,async()=>{
      const root=runtimeControl(await assertAnchor(this.db,marker)),fence=this.fence;
      requireStorage(root.activeMode==='local'&&root.activeGeneration===fence.generation&&root.epoch===fence.epoch&&root.pendingSwitchId===null,'stale_epoch');
      const dataset=datasetControl(await this.db.datasets.get(fence.generation)),participant=participantControl(await this.db.participants.get(dataset.participantId));
      requireStorage(dataset.lifecycle==='active'&&participant.state==='active'&&participant.generation===dataset.generation&&participant.epoch===dataset.participantEpoch,'dataset_not_writable');
      if(participant.awaitingSync)await assertSetup(this.db,root,dataset.holdId!==null);
      if(expected==='existing'&&dataset.holdId!==null)operation((await this.db.applicationState.get(scope(dataset.holdId)))?.value,dataset.holdId,fence.generation);
      else requireStorage(expected==='existing'||dataset.holdId===expected,'dataset_not_writable');
      await this.db.runtime.put({...root,financialMayHaveStarted:true});
      const view=new Session(this.db,fence.generation,Dexie.currentTransaction!,await mirrorScope(this.db,fence.generation),false,participant.awaitingSync);
      try{return await work(view,dataset);}finally{view.close();}
    });}catch(error){if(error instanceof CaptureError)throw error;throw storageFailure(error);}
  }
  async #save(op:Setup){await this.db.applicationState.put({scope:scope(op.id),value:op as unknown as Record<string,unknown>});return op;}
  async #validate(view:RepositorySession,id:string,data:LocalSettings,now:string){
    const account=await get(view,'bank_accounts',id);
    if(data.selection!=='enabled')return {account,oldTarget:null};
    requireCapture(account.supported==='1','unsupported_currency');const observed=[];
    for(const member of await view.related('connection_accounts',['account_id'],[text(id)])){
      const found=await view.get('connection_discovery',[text(member.connection_id),text(id)]);if(found?.present==='1'&&found.supported==='1')observed.push(found);
    }
    const found=observed.sort((a,b)=>a.connection_id<b.connection_id?-1:a.connection_id>b.connection_id?1:0)[0];requireCapture(found,'account_disabled');
    const caps=connectionCapabilities(await get(view,'connections',found.connection_id));
    const today=localDay(new Date(Number(now)*1000).toISOString(),caps.timezone),start=data.import_start!;
    requireCapture(start<=today&&(caps.earliest_date==null||start>=caps.earliest_date));
    const root=runtimeControl(await this.db.runtime.get('runtime')),control=(await this.db.applicationState.get('mirror:'+this.fence.generation))?.value;
    const state=await view.get('zen_mirror_state',[['integer',int64('1')]]);
    requireCapture(root.credentialRef!==null&&control!==undefined&&control.forceFull!==true&&control?.lease==null&&state?.ready==='1'&&state.needs_full==='0'&&state.refreshed_at!==null&&
      BigInt(now)>=BigInt(state.refreshed_at)&&BigInt(now)-BigInt(state.refreshed_at)<=300n,'zenmoney_unavailable');
    const entity=await view.get('zen_entities',[text('account'),text(data.zenmoney_account_id!)]),target=entity?decodeJson(entity.data) as JsonObject:null,instrumentId=target?.instrument;
    const instrument=instrumentId==null?null:await view.get('zen_entities',[text('instrument'),text(String(instrumentId))]),currency=instrument?decodeJson(instrument.data) as JsonObject:null;
    requireCapture(entity?.deleted==='0'&&target&&!jsonTruthy(target.deleted)&&!jsonTruthy(target.archive)&&['cash','ccard','checking','deposit','emoney'].includes(target.type as string)&&
      (typeof instrumentId==='bigint'||typeof instrumentId==='number'&&Number.isSafeInteger(instrumentId))&&instrumentId>0&&instrument?.deleted==='0'&&currency&&!jsonTruthy(currency.deleted)&&currency.shortTitle===account.currency,'zenmoney_account_unavailable');
    const bindings=(await view.related('account_bindings',['account_id'],[text(id)])).sort((a,b)=>BigInt(a.created_at)!==BigInt(b.created_at)?BigInt(a.created_at)>BigInt(b.created_at)?-1:1:BigInt(a.settings_version??'-1')>BigInt(b.settings_version??'-1')?-1:BigInt(a.settings_version??'-1')<BigInt(b.settings_version??'-1')?1:0);
    return {account,oldTarget:account.zenmoney_account_id??bindings[0]?.zenmoney_account_id??null};
  }
  async run(id:string,input:unknown,now:string){
    const data=settings(input),stamp=int64(now),request=canonicalDto({account_id:id,...data});requireCapture(BigInt(stamp)>=0n);
    await this.sentinel.markFinancialActivity(this.fence.installationId);
    let op=await this.#unit('existing',async(view,dataset)=>{
      if(dataset.holdId!==null){const existing=operation((await this.db.applicationState.get(scope(dataset.holdId)))?.value,dataset.holdId,this.fence.generation);
        requireCapture(existing.request===request,'account_busy');return existing;
      }
      const account=await get(view,'bank_accounts',id),desired=[data.selection,data.zenmoney_account_id??null,data.import_start??null],current=[account.selection,account.zenmoney_account_id,account.import_start];
      if(JSON.stringify(desired)===JSON.stringify(current)&&BigInt(data.expected_version)<=BigInt(account.settings_version))return accountView(account);
      requireCapture(data.expected_version===account.settings_version&&BigInt(account.settings_version)<9223372036854775807n,'settings_conflict');
      const nextVersion=int64(String(BigInt(account.settings_version)+1n)),validated=await this.#validate(view,id,data,stamp);
      const op:Setup={kind:'account-settings',id:crypto.randomUUID(),generation:this.fence.generation,accountId:id,request,desired:data,oldTarget:validated.oldTarget,nextVersion,createdAt:stamp,
        phase:'coverage',after:null,jobs:[],nextJob:0,frontier:data.import_start??null,error:null,result:null};
      requireStorage(await this.db.applicationState.get(scope(op.id))===undefined,'constraint_violation');
      await this.db.datasets.put({...dataset,holdId:op.id});return this.#save(op);
    });
    if(!('kind'in op))return op;
    while(!['complete','failed'].includes(op.phase))op=await this.#step(op.id);
    if(op.phase==='failed')throw new CaptureError(op.error!);return op.result!;
  }
  async recover(){
    await this.sentinel.markFinancialActivity(this.fence.installationId);
    const held=await this.#unit('existing',async(_,dataset)=>dataset.holdId===null?null:operation((await this.db.applicationState.get(scope(dataset.holdId)))?.value,dataset.holdId,this.fence.generation));
    return held===null?null:this.run(held.accountId,held.desired,held.createdAt);
  }
  async #step(id:string):Promise<Setup>{
    try{return await this.#unit(id,async(view,dataset)=>{
      const op=operation((await this.db.applicationState.get(scope(id)))?.value,id,this.fence.generation),generation=this.fence.generation;
      if(op.phase==='check'||op.phase==='invalidate'){
        const rows=await this.db.financial('bank_transactions').where('[generation+key]').between([generation,op.after??Dexie.minKey],[generation,Dexie.maxKey],op.after===null,true).limit(500).toArray();
        const banks=rows.map(row=>unpackRow('bank_transactions',row.row)).filter(row=>row.account_id===op.accountId),keys=banks.map(row=>[text(row.id)]);
        if(op.phase==='check'){
          const processing=await view.getMany('bank_processing',keys),deliveries=await view.findMany('deliveries',['bank_id'],keys);
          if(processing.some(row=>row?.state==='uncertain')||deliveries.some(row=>row!==null&&(['attempting','uncertain'].includes(row.state)||row.state==='prepared'&&row.ever_attempted==='1'))){
            await this.db.datasets.put({...dataset,holdId:null});return this.#save({...op,phase:'failed',error:'delivery_uncertain'});
          }
        }else await view.invalidatePrepared(banks.map(row=>row.id));
        return this.#save({...op,after:rows.at(-1)?.key??null,...(!rows.length?{phase:op.phase==='check'?'invalidate':'intervals',after:null}:{})});
      }
      if(op.phase==='intervals'){
        const rows=await this.db.financial('capture_intervals').where('[generation+key]').between([generation,op.after??Dexie.minKey],[generation,Dexie.maxKey],op.after===null,true).limit(500).toArray(),jobs=new Set(op.jobs);
        for(const value of rows){const row=unpackRow('capture_intervals',value.row);if(row.account_id!==op.accountId||!ACTIVE.includes(row.state))continue;
          await view.replace('capture_intervals',[text(row.id)],{...row,state:'cancelled'});await addError(view,row.job_id,op.accountId,'settings_conflict',op.createdAt);jobs.add(row.job_id);
        }
        return this.#save({...op,jobs:[...jobs],after:rows.at(-1)?.key??null,...(!rows.length?{phase:'jobs',after:null}:{})});
      }
      if(op.phase==='jobs'){
        const job=op.jobs[op.nextJob];if(job)await refreshJob(view,job);
        return this.#save({...op,nextJob:op.nextJob+(job?1:0),...(!job?{phase:'finish'}:{})});
      }
      if(op.phase==='coverage'){
        const phase=op.desired.selection==='enabled'&&op.oldTarget!==null&&op.oldTarget!==op.desired.zenmoney_account_id?'check':'invalidate';
        if(op.frontier===null)return this.#save({...op,phase,after:null});
        const prefix=encodeKey([text(op.accountId)])+'/',rows=await this.db.financial('coverage').where('[generation+key]').between([generation,op.after??prefix],[generation,prefix+'\uffff'],op.after===null,true).limit(500).toArray();
        let frontier=op.frontier;
        for(const value of rows){const row=unpackRow('coverage',value.row);if(row.start_date>frontier)return this.#save({...op,phase,after:null,frontier});
          if(row.end_date>=frontier){
            // Prove representability before invalidating any derived fact.
            if(row.end_date==='9999-12-31'){await this.db.datasets.put({...dataset,holdId:null});return this.#save({...op,phase:'failed',error:'validation_error'});}
            frontier=shiftDays(row.end_date,1);
          }
        }
        return this.#save({...op,frontier,after:rows.at(-1)?.key??null,...(!rows.length?{phase,after:null}:{})});
      }
      requireStorage(op.phase==='finish','storage_corrupt');const account=await get(view,'bank_accounts',op.accountId);requireCapture(account.settings_version===op.desired.expected_version,'settings_conflict');
      const version=int64(op.nextVersion),start=op.desired.import_start??null,last=op.frontier!==null&&start!==null&&op.frontier>start?shiftDays(op.frontier,-1):null;
      const next={...account,selection:op.desired.selection,zenmoney_account_id:op.desired.zenmoney_account_id??null,import_start:start,settings_version:version,last_complete_end:last};
      await view.replace('bank_accounts',[text(account.id)],next);
      if(op.desired.selection==='enabled')await view.insert('account_bindings',{id:crypto.randomUUID(),account_id:account.id,zenmoney_account_id:op.desired.zenmoney_account_id!,settings_version:version,origin:'settings',created_at:int64(op.createdAt)});
      await this.db.datasets.put({...dataset,holdId:null});return this.#save({...op,phase:'complete',result:accountView(next)});
    });}catch(error){
      // Another executor (or a lost native commit reply) may already have
      // completed this exact operation. Its receipt is immutable local evidence.
      const completed=await this.#terminal(id);if(completed)return completed;throw error;
    }
  }
  async #terminal(id:string):Promise<Setup|null>{
    const marker=await readAnchor(this.sentinel,this.fence.installationId);
    return this.db.transaction('r',this.db.tables,async()=>{
      const root=runtimeControl(await assertAnchor(this.db,marker)),fence=this.fence;
      requireStorage(root.activeMode==='local'&&root.activeGeneration===fence.generation&&root.epoch===fence.epoch&&root.pendingSwitchId===null,'stale_epoch');
      const op=operation((await this.db.applicationState.get(scope(id)))?.value,id,fence.generation);
      return ['complete','failed'].includes(op.phase)?op:null;
    });
  }
  close(){this.db.close();}
}
