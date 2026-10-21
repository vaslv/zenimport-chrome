import {readOutbox,outboxActive} from './outbox-control.js';
/** Named mirror repository; all Root, lease, cursor and projection commits are atomic. */
import Dexie from 'dexie';
import type {RuntimeControl,SentinelPort} from '../../control/types.js';
import {datasetControl,runtimeControl} from '../../control/validation.js';
import {FinancialDatabase} from './database.js';
import {readAnchor,assertAnchor} from './anchor.js';
import {RepositorySession,writeMirrorTransaction} from './kernel.js';
import {participantControl} from './participant-validation.js';
import {int64,requireStorage} from './types.js';
import type {Scalar} from './types.js';
import type {RowByTable,TableName} from './schema.generated.js';
import {prepareMirror} from '../zenmoney/projection.js';
import {prepareMirrorWrites,writeMirror} from './mirror-write.js';
import {mirrorScope,MIRROR_TABLES} from './mirror-scope.js';
import {stageMirror} from './mirror-stage.js';
import {envelope} from './envelope.js';
import {packRow,unpackRow,encodeKey} from './cells.js';
import {financialStamp} from './source-stamp.js';
import {categoriesReady} from './category-control.js';
import {LocalZenMoneyError} from '../zenmoney/errors.js';
import type {ZenMoneyCode} from '../zenmoney/errors.js';

const text=(value:string)=>['text',value] as const,one=[['integer',int64('1')]] as const;
const same=(a:RuntimeControl,b:RuntimeControl)=>Object.keys(a).every(key=>a[key as keyof RuntimeControl]===b[key as keyof RuntimeControl]);
export interface MirrorLease{id:string;deadline:string;cursor:string;generation:string;sourceHash:string;full:boolean}
interface MirrorControl{lease:MirrorLease|null;failures:string;nextAt:string;error:ZenMoneyCode|null;projectionGeneration:string|null;forceFull:boolean}
const initial=(projectionGeneration:string|null=null,forceFull=false):MirrorControl=>({lease:null,failures:'0',nextAt:'0',error:null,projectionGeneration,forceFull});
async function put<K extends TableName>(view:RepositorySession,table:K,key:readonly Scalar[],value:RowByTable[K]){
  if(await view.get(table,key))await view.replace(table,key,value);else await view.insert(table,value);
}
export class MirrorRepository{
  private constructor(private db:FinancialDatabase,private sentinel:SentinelPort,private clock:()=>number){}
  static async open(name:string,sentinel:SentinelPort,clock:()=>number=()=>Math.floor(Date.now()/1000)){
    const marker=await readAnchor(sentinel),db=new FinancialDatabase(name,false);
    try{await db.open();await db.transaction('r',db.runtime,db.datasets,()=>assertAnchor(db,marker));return new MirrorRepository(db,sentinel,clock);}
    catch(error){db.close();throw error;}
  }
  async #transaction<T>(expected:RuntimeControl|undefined,operation:(view:RepositorySession,root:RuntimeControl)=>Promise<T>){
    const marker=await readAnchor(this.sentinel);
    return this.db.transaction('rw',this.db.tables,async()=>{
      await assertAnchor(this.db,marker);const {root}=await this.#contextInTransaction(expected);
      const view=new RepositorySession(this.db,root.activeGeneration!,Dexie.currentTransaction!,await mirrorScope(this.db,root.activeGeneration!));
      try{return await operation(view,root);}finally{view.close();}
    });
  }
  // The independent marker is read before a native transaction, never awaited
  // through Chrome storage while IDB owns a transaction.
  async #contextInTransaction(expected?:RuntimeControl){
    const root=runtimeControl(await this.db.runtime.get('runtime'));
    requireStorage(!expected||same({...root,financialMayHaveStarted:expected.financialMayHaveStarted},expected),'stale_epoch');
    requireStorage(root.activeMode==='local'&&root.activeGeneration!==null&&root.pendingSwitchId===null,'dataset_not_writable');
    const dataset=datasetControl(await this.db.datasets.get(root.activeGeneration));
    const participant=participantControl(await this.db.participants.get(dataset.participantId));
    requireStorage(dataset.lifecycle==='active'&&dataset.holdId===null&&participant.state==='active'&&
      participant.generation===dataset.generation&&participant.epoch===dataset.participantEpoch,'dataset_not_writable');
    return {root,dataset,participant};
  }
  async context(){return this.#transaction(undefined,async(_,root)=>({root,owners:[...datasetControl(await this.db.datasets.get(root.activeGeneration!)).ownerIds]}));}
  async #control(root:RuntimeControl){
    const value=(await this.db.applicationState.get('mirror:'+root.activeGeneration))?.value as unknown as MirrorControl|undefined;
    // Portable financial readiness is not a local confirmation for this generation.
    if(value===undefined)return initial(null,true);
    requireStorage(value!==null&&typeof value==='object'&&Object.keys(value).sort().join(',')==='error,failures,forceFull,lease,nextAt,projectionGeneration'&&typeof value.forceFull==='boolean','storage_corrupt');
    requireStorage(value.projectionGeneration===null||typeof value.projectionGeneration==='string','storage_corrupt');
    requireStorage(BigInt(int64(value.failures))>=0n&&BigInt(int64(value.nextAt))>=0n,'storage_corrupt');
    requireStorage(value.error===null||['zenmoney_not_configured','zenmoney_auth','zenmoney_permission','zenmoney_rate_limited','zenmoney_unavailable','zenmoney_response','zenmoney_wrong_owner','mirror_busy','mirror_cooldown'].includes(value.error),'storage_corrupt');
    if(value.lease!==null){
      const lease=value.lease;requireStorage(typeof lease==='object'&&Object.keys(lease).sort().join(',')==='cursor,deadline,full,generation,id,sourceHash'&&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(lease.id)&&/^[0-9a-f]{64}$/.test(lease.sourceHash)&&typeof lease.full==='boolean','storage_corrupt');
      for(const field of ['cursor','deadline','generation'] as const)requireStorage(BigInt(int64(lease[field]))>=0n,'storage_corrupt');
    }
    return value;
  }
  async #saveControl(root:RuntimeControl,value:MirrorControl){await this.db.applicationState.put({scope:'mirror:'+root.activeGeneration,value:value as unknown as Record<string,unknown>});}
  async #finance<T>(root:RuntimeControl,operation:(view:RepositorySession)=>Promise<T>){
    let rejection:LocalZenMoneyError|undefined;
    try{return await writeMirrorTransaction(this.db,this.sentinel,{installationId:root.installationId,generation:root.activeGeneration!,epoch:root.epoch},async view=>{
      // financialMayHaveStarted is monotonic and may be set by the kernel itself.
      const current=runtimeControl(await this.db.runtime.get('runtime'));
      requireStorage(same({...current,financialMayHaveStarted:root.financialMayHaveStarted},root),'stale_epoch');
      try{return await operation(view);}catch(error){if(error instanceof LocalZenMoneyError)rejection=error;throw error;}
    });}catch(error){throw rejection??error;}
  }
  async adopt(expected:RuntimeControl,ref:string|null,owners:readonly string[]){
    return this.#transaction(expected,async(_,root)=>{
      const dataset=datasetControl(await this.db.datasets.get(root.activeGeneration!));
      if(dataset.ownerIds.length&&JSON.stringify(dataset.ownerIds)!==JSON.stringify(owners))throw new LocalZenMoneyError('zenmoney_wrong_owner');
      const next=runtimeControl({...root,credentialRef:ref,credentialEpoch:int64(String(BigInt(root.credentialEpoch)+1n))});
      await this.db.datasets.put({...dataset,ownerIds:[...owners]});await this.db.runtime.put(next);await this.#saveControl(next,initial((await this.#control(root)).projectionGeneration,true));return next;
    });
  }
  async removeCredential(expected:RuntimeControl){
    return this.#transaction(expected,async(_,root)=>{
      const next=runtimeControl({...root,credentialRef:null,credentialEpoch:int64(String(BigInt(root.credentialEpoch)+1n))});
      await this.db.runtime.put(next);await this.#saveControl(next,initial((await this.#control(root)).projectionGeneration,true));return next;
    });
  }
  async status(hash:string|null,now:string){
    int64(now);return this.#transaction(undefined,async(view,root)=>{
      const state=(await view.get('zen_mirror_state',one))!,control=await this.#control(root);
      return {root,state,control,ready:root.credentialRef!==null&&hash!==null&&!control.forceFull&&control.lease===null&&state.source_hash===hash&&state.ready==='1'&&state.needs_full==='0'&&
        state.refreshed_at!==null&&BigInt(now)>=BigInt(state.refreshed_at)&&BigInt(now)-BigInt(state.refreshed_at)<=300n};
    });
  }
  async claim(root:RuntimeControl,hash:string,now:string,force=false,transactions=false):Promise<MirrorLease|null>{
    int64(now);requireStorage(/^[0-9a-f]{64}$/.test(hash),'invalid_row');
    return this.#finance(root,async view=>{
      if(outboxActive(await readOutbox(this.db,root.activeGeneration!),now))throw new LocalZenMoneyError('mirror_busy');
      let state=(await view.get('zen_mirror_state',one))!;const control=await this.#control(root);
      if(control.lease&&BigInt(control.lease.deadline)>BigInt(now))throw new LocalZenMoneyError('mirror_busy');
      if(BigInt(control.nextAt)>BigInt(now))throw new LocalZenMoneyError('mirror_cooldown');
      if(state.source_hash!==hash||control.forceFull){
        state={...state,source_hash:hash,cursor:int64('0'),generation:int64(String(BigInt(state.generation)+1n)),needs_full:int64('1'),ready:int64('0'),error_code:null};
        await view.replace('zen_mirror_state',one,state);
        // ready/generation invalidate predictions atomically. Reclaim stale
        // derived rows separately, never scan the history in a refresh commit.
        await view.remove('dataset_metadata',[text('zenmoney_refreshed_at')]);
      }
      if(!force&&!transactions&&state.ready==='1'&&state.needs_full==='0'&&state.refreshed_at!==null&&
        BigInt(now)>=BigInt(state.refreshed_at)&&BigInt(now)-BigInt(state.refreshed_at)<=300n)return null;
      const lease:MirrorLease={id:crypto.randomUUID(),deadline:String(BigInt(now)+60n),cursor:state.needs_full==='1'?'0':state.cursor,
        generation:state.generation,sourceHash:hash,full:state.needs_full==='1'};
      await this.#saveControl(root,{...control,forceFull:false,lease});return lease;
    });
  }
  async apply(root:RuntimeControl,lease:MirrorLease,raw:string,now:string){
    int64(now);const batch=prepareMirror(raw,lease.cursor,lease.full,lease.id);
    const check=async(view:RepositorySession)=>{
      const control=await this.#control(root),state=(await view.get('zen_mirror_state',one))!;
      requireStorage(control.lease?.id===lease.id&&BigInt(control.lease.deadline)>=BigInt(Math.floor(this.clock()))&&state.generation===lease.generation&&state.source_hash===lease.sourceHash,'stale_epoch');
      const owners=datasetControl(await this.db.datasets.get(root.activeGeneration!)).ownerIds;
      if(batch.owners&&JSON.stringify(batch.owners)!==JSON.stringify(owners)||
        batch.entities.some(row=>row.kind==='user'&&(!owners.includes(row.id)||row.deleted==='1'))||
        batch.deletions.some(row=>row.kind==='user'&&owners.includes(row.entity_id)))throw new LocalZenMoneyError('zenmoney_wrong_owner');
      return {control,state};
    };
    const size=batch.entities.length+batch.movements.length+batch.tags.length+batch.tombstones.length+batch.deletions.length;
    const source=await this.#transaction(root,async view=>{
      const {control}=await check(view),scope=await mirrorScope(this.db,root.activeGeneration!);let size=0;
      for(const table of MIRROR_TABLES)size+=await this.db.financial(table).where('generation').equals(scope).count();
      let affectedTags=0;
      if(!batch.full&&batch.entities.length+batch.deletions.length<=2000){
        const identities=new Set([...batch.entities.map(row=>JSON.stringify([row.kind,row.id])),...batch.deletions.map(row=>JSON.stringify([row.kind,row.entity_id]))]);
        for(const identity of identities){const parts=JSON.parse(identity) as string[],prefix=encodeKey(parts.map(value=>text(value)))+'/';
          affectedTags+=await this.db.financial('zen_tags').where('[generation+key]').between([scope,prefix],[scope,prefix+'\uffff'],true,true).count();
          if(affectedTags>2000)break;
        }
      }
      return {scope,control,size,affectedTags};
    });
    const staged=size+source.affectedTags>2000||batch.full&&source.size+size>2000,scope=staged?crypto.randomUUID():source.scope,writes=prepareMirrorWrites(scope,batch);
    const run={id:lease.id,received_at:int64(now),requested_cursor:int64(lease.cursor),response_cursor:batch.cursor,origin:'read',payload:raw};
    if(staged){
      requireStorage(scope!==root.activeGeneration&&scope!==source.scope,'constraint_violation');
      await this.#finance(root,async view=>{await check(view);requireStorage(await this.db.datasets.get(scope)===undefined,'constraint_violation');
        await this.db.applicationState.add({scope:'mirror-view:'+scope,value:{generation:root.activeGeneration!,state:'loading',leaseId:lease.id,createdAt:now}});});
      const owned=async<T>(operation:()=>Promise<T>)=>this.#finance(root,async view=>{
        const {control}=await check(view),version=(await this.db.applicationState.get('mirror-view:'+scope))?.value;
        requireStorage(version?.state==='loading'&&version.leaseId===lease.id&&version.generation===root.activeGeneration,'stale_epoch');
        const result=await operation();await this.#saveControl(root,{...control,lease:{...control.lease!,deadline:String(Math.floor(this.clock())+60)}});return result;
      });
      await stageMirror(this.db,source.scope,scope,writes,envelope(scope,'zen_sync_runs',packRow('zen_sync_runs',run)),owned);
    }
    return this.#finance(root,async view=>{
      const {state}=await check(view);
      if(staged){
        const version=(await this.db.applicationState.get('mirror-view:'+scope))?.value;
        requireStorage(version?.state==='loading'&&version.leaseId===lease.id&&version.generation===root.activeGeneration,'stale_epoch');
        await this.db.applicationState.put({scope:'mirror-view:'+scope,value:{...version,state:'active'}});
        const previous=(await this.db.applicationState.get('mirror-view:'+source.scope))?.value??{generation:root.activeGeneration,createdAt:now};
        await this.db.applicationState.put({scope:'mirror-view:'+source.scope,value:{...previous,state:'retired',retiredAt:now}});
      }else{await view.insert('zen_sync_runs',run);await writeMirror(this.db,scope,writes);}
      await view.replace('zen_mirror_state',one,{...state,cursor:batch.cursor,generation:int64(String(BigInt(state.generation)+1n)),needs_full:int64('0'),ready:int64('1'),refreshed_at:int64(now),error_code:null});
      await put(view,'dataset_metadata',[text('zenmoney_refreshed_at')],{key:'zenmoney_refreshed_at',value:now});
      await this.#saveControl(root,initial(staged?scope:source.control.projectionGeneration));
    });
  }
  async failed(root:RuntimeControl,lease:MirrorLease,code:ZenMoneyCode,now:string){
    int64(now);return this.#finance(root,async view=>{
      const control=await this.#control(root);requireStorage(control.lease?.id===lease.id,'stale_epoch');
      const failures=BigInt(control.failures)+1n,delay=code==='zenmoney_rate_limited'?60n:code==='zenmoney_auth'||code==='zenmoney_permission'?30n:failures>6n?300n:5n*(1n<<failures);
      await this.#saveControl(root,{...control,lease:null,failures:String(failures),nextAt:String(BigInt(now)+delay),error:code});
      const state=(await view.get('zen_mirror_state',one))!;
      await view.replace('zen_mirror_state',one,{...state,ready:int64('0'),error_code:code});
      await view.remove('dataset_metadata',[text('zenmoney_refreshed_at')]);
    });
  }
  async catalog(root:RuntimeControl){
    return this.#transaction(root,async view=>{
      const rows=[];for(const kind of ['account','instrument','tag'])rows.push(...await view.rows('zen_entities',[text(kind)]));
      return rows.filter(row=>row.deleted==='0');
    });
  }
  async prediction(root:RuntimeControl,bankId:string,revision:string){
    return this.#transaction(root,async view=>{
      const state=(await view.get('zen_mirror_state',one))!,control=await this.#control(root);
      const now=BigInt(Math.floor(this.clock()));
      if(root.credentialRef===null||control.forceFull||control.lease!==null||state.ready!=='1'||state.needs_full!=='0'||
        state.refreshed_at===null||now<BigInt(state.refreshed_at)||now-BigInt(state.refreshed_at)>300n)return null;
      if(!await categoriesReady(this.db,await financialStamp(this.db,root,view)))return null;
      const row=await view.get('category_predictions',[text(bankId)]);
      return row?.mirror_generation===state.generation&&row.bank_revision===revision?row:null;
    });
  }
  async collect(now:string):Promise<{removed:number;complete:boolean}>{
    int64(now);const {root}=await this.context();
    return this.#finance(root,async view=>{
      const control=await this.#control(root);if(control.lease!==null)return {removed:0,complete:false};
      const state=(await view.get('zen_mirror_state',one))!,gcKey='prediction-gc:'+root.activeGeneration;
      // Stale predictions are portable derived facts, never usable evidence.
      // A persisted key cursor bounds collection even when current rows precede
      // stale ones. A newer mirror generation starts another sweep.
      if(state.ready==='1'&&!control.forceFull){
        const gc=(await this.db.applicationState.get(gcKey))?.value;
        if(gc?.generation!==state.generation||gc.done!==true){
          const after=gc?.generation===state.generation&&typeof gc.after==='string'?gc.after:null;
          const rows=await this.db.financial('category_predictions').where('[generation+key]').between(
            [root.activeGeneration!,after??Dexie.minKey],[root.activeGeneration!,Dexie.maxKey],after===null,true).limit(500).toArray();
          const stale=rows.filter(row=>unpackRow('category_predictions',row.row).mirror_generation!==state.generation);
          await this.db.financial('category_predictions').bulkDelete(stale.map(row=>[root.activeGeneration!,row.key]));
          await this.db.applicationState.put({scope:gcKey,value:{generation:state.generation,after:rows.at(-1)?.key??after,done:rows.length<500}});
          if(rows.length)return {removed:stale.length,complete:false};
        }
      }
      const active=await mirrorScope(this.db,root.activeGeneration!);
      const candidates=(await this.db.applicationState.toArray()).filter(row=>row.scope.startsWith('mirror-view:')&&row.value.generation===root.activeGeneration&&
        ['loading','retired','collecting'].includes(row.value.state as string));
      for(const candidate of candidates){
        const scope=candidate.scope.slice('mirror-view:'.length),stamp=candidate.value.retiredAt??candidate.value.createdAt;
        requireStorage(typeof scope==='string'&&/^[0-9a-f-]{36}$/.test(scope)&&scope!==active,'storage_corrupt');
        if(BigInt(now)-BigInt(int64(stamp))<86400n)continue;
        await this.db.applicationState.put({...candidate,value:{...candidate.value,state:'collecting'}});
        for(const table of ['zen_tags','zen_movements','zen_entities','zen_deletions','zen_tombstones','zen_sync_runs'] as const){
          const rows=await this.db.financial(table).where('generation').equals(scope).limit(table==='zen_sync_runs'?1:500).toArray();if(!rows.length)continue;
          if(['zen_deletions','zen_tombstones','zen_sync_runs'].includes(table)&&candidate.value.state!=='loading'&&candidate.value.discardedStage!==true){
            const retained=await this.db.financial(table).bulkGet(rows.map(row=>[active,row.key]));
            requireStorage(rows.every((row,index)=>retained[index]!==undefined&&JSON.stringify(row.row)===JSON.stringify(retained[index]!.row)),'storage_corrupt');
          }
          // A failed unpublished stage may contain a valid new read run absent
          // from the active mirror. It has no published financial authority.
          if(candidate.value.state==='loading')await this.db.applicationState.put({...candidate,value:{...candidate.value,state:'collecting',discardedStage:true}});
          await this.db.financial(table).bulkDelete(rows.map(row=>[scope,row.key]));return {removed:rows.length,complete:false};
        }
        await this.db.applicationState.delete(candidate.scope);return {removed:0,complete:false};
      }
      return {removed:0,complete:true};
    });
  }
  close(){this.db.close();}
}
