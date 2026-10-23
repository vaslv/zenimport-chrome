import {SourceChanges} from './source-cache.js';
import {sourcePublication} from './source-publication.js';
import {assertSetup} from './setup-permit.js';
import {markJobRefresh} from './job-refresh.js';
/** Internal repository transaction owner. Never import from application handlers. */
import Dexie from 'dexie';
import type {Transaction} from 'dexie';
import type {ContextFence,SentinelPort} from '../../control/types.js';
import {runtimeControl,datasetControl} from '../../control/validation.js';
import {SCHEMA} from './schema.generated.js';
import type {TableName,RowByTable} from './schema.generated.js';
import {envelope,field,textField,valuesKey} from './envelope.js';
import {packRow,unpackRow,encodeKey,rowKey,validateCells} from './cells.js';
import {requireStorage,storageFailure} from './types.js';
import type {Scalar,TaggedRow} from './types.js';
import type {FinancialDatabase,FinancialEnvelope} from './database.js';
import {readAnchor,assertAnchor} from './anchor.js';
import {participantControl} from './participant-validation.js';
import {advanceFinancialRevision,isDerivedCache} from './revisions.js';
import {mirrorScope,isMirrorTable} from './mirror-scope.js';

const immutableUpdate=new Set<TableName>(['bank_versions','capture_pages','captured_records','delivery_attempts',
  'job_accounts','job_context','job_requests','processing_receipts','processing_targets']);
const immutableDelete=new Set<TableName>(['bank_versions','capture_pages','captured_records','delivery_attempts',
  'job_accounts','job_context','job_requests','processing_receipts','processing_targets','zen_tombstones']);

const same=(a:readonly string[],b:readonly string[])=>a.length===b.length && a.every((value,i)=>value===b[i]);

/** A view cannot outlive its native transaction or open an implicit writer. */
export class RepositorySession{
  readonly sourceChanges=new SourceChanges();
  #db:FinancialDatabase;
  #generation:string;
  #owner:Transaction;
  #live=true;
  #mirrorGeneration:string;
  #mirrorOnly:boolean;
  #setupOnly:boolean;
  #revisionAdvanced=false;
  #jobsQueued=false;
  constructor(db:FinancialDatabase,generation:string,owner:Transaction,mirrorGeneration=generation,mirrorOnly=false,setupOnly=false){this.#setupOnly=setupOnly;this.#db=db;this.#generation=generation;this.#owner=owner;this.#mirrorGeneration=mirrorGeneration;this.#mirrorOnly=mirrorOnly;}
  #scope(table:TableName){return isMirrorTable(table)?this.#mirrorGeneration:this.#generation;}
  #writeScope(table:TableName,key?:readonly Scalar[]){
    if(this.#setupOnly)requireStorage(['connections','connection_labels','connection_accounts','connection_discovery','bank_accounts','account_bindings','capture_intervals','capture_jobs','capture_errors','source_capture_leases'].includes(table),'dataset_not_writable');
    if(!this.#mirrorOnly)return;
    requireStorage(isMirrorTable(table)||table==='zen_mirror_state'||table==='category_predictions'||
      table==='dataset_metadata'&&key?.[0]?.[0]==='text'&&key[0][1]==='zenmoney_refreshed_at','dataset_not_writable');
  }

  async #changed(table:TableName){
    if(!this.#jobsQueued&&['bank_processing','deliveries','delivery_authorizations','processing_receipts','link_bank_members','link_zen_members'].includes(table)){
      await markJobRefresh(this.#db,this.#generation);this.#jobsQueued=true;
    }
    if(this.#revisionAdvanced||isDerivedCache(table))return;
    await advanceFinancialRevision(this.#db,this.#generation);this.#revisionAdvanced=true;
  }

  close():void{this.#live=false;}
  #assert():void{requireStorage(this.#live && Dexie.currentTransaction===this.#owner,'stale_epoch');}

  async #guard<T>(operation:()=>Promise<T>):Promise<T>{
    this.#assert();
    try{return await operation();}
    catch(error){this.#owner.abort();throw storageFailure(error);}
  }

  #checked(table:TableName,value:FinancialEnvelope|undefined):TaggedRow|null{
    if(value===undefined)return null;
    requireStorage(value.generation===this.#scope(table) && rowKey(table,value.row)===value.key,'storage_corrupt');
    return validateCells(table,value.row);
  }

  async get<K extends TableName>(table:K,primary:readonly Scalar[]):Promise<RowByTable[K]|null>{
    return this.#guard(async()=>{
      const row=this.#checked(table,await this.#db.financial(table).get([this.#scope(table),encodeKey(primary)]));
      return row===null?null:unpackRow(table,row);
    });
  }
  async getMany<K extends TableName>(table:K,primary:readonly (readonly Scalar[])[]):Promise<(RowByTable[K]|null)[]>{
    return this.#guard(async()=>{requireStorage(primary.length<=500,'invariant_violation');
      const rows=await this.#db.financial(table).bulkGet(primary.map(key=>[this.#scope(table),encodeKey(key)]));
      return rows.map(value=>{const row=this.#checked(table,value);return row===null?null:unpackRow(table,row);});
    });
  }
  async findMany<K extends TableName>(table:K,columns:readonly string[],values:readonly (readonly Scalar[])[]):Promise<(RowByTable[K]|null)[]>{
    return this.#guard(async()=>{
      requireStorage(values.length<=500&&values.every(value=>value.length===columns.length),'schema_unsupported');
      const definition=SCHEMA[table];if(same(columns,definition.primary))return this.getMany(table,values);
      const index=definition.indexes.find(index=>index.unique&&!index.partial&&same(index.columns,columns));requireStorage(index!==undefined,'schema_unsupported');
      const rows=await this.#db.financial(table).where('[generation+'+index.key+']').anyOf(values.map(value=>[this.#scope(table),encodeKey(value)])).toArray();
      const found=new Map(rows.map(value=>{const row=this.#checked(table,value)!;return [valuesKey(table,row,columns),unpackRow(table,row)];}));
      return values.map(value=>found.get(encodeKey(value))??null);
    });
  }
  /** Fixed derived-context invalidation, with no attempted/terminal mutation. */
  async invalidatePrepared(bankIds:readonly string[]){
    return this.#guard(async()=>{
      // Account setup may invalidate an unattempted intent, never alter its UUID,
      // payload or attempt facts. This specialized path is narrower than replace.
      requireStorage(!this.#mirrorOnly&&bankIds.length<=500,'dataset_not_writable');
      const rows=await this.findMany('deliveries',['bank_id'],bankIds.map(id=>[['text',id]]));
      const values=rows.filter((row):row is RowByTable['deliveries']=>row!==null&&row.state==='prepared'&&row.ever_attempted==='0'&&(row.needs_rebuild!=='1'||row.authorized_job_id!==null))
        .map(row=>envelope(this.#generation,'deliveries',packRow('deliveries',{...row,needs_rebuild:'1' as RowByTable['deliveries']['needs_rebuild'],authorized_job_id:null})));
      if(values.length){await this.#changed('deliveries');await this.#db.financial('deliveries').bulkPut(values);for(const value of values)this.sourceChanges.upsert('deliveries',value.key,unpackRow('deliveries',value.row));}
    });
  }

  /** Storage-private snapshot enumeration, bounded by the caller's operation. */
  async rows<K extends TableName>(table:K,prefix:readonly Scalar[]=[]):Promise<RowByTable[K][]> {
    return this.#guard(async()=>{
      requireStorage(prefix.length<=SCHEMA[table].primary.length,'schema_unsupported');
      const key=prefix.length?encodeKey(prefix):null,whole=prefix.length===SCHEMA[table].primary.length;
      const values=key===null?await this.#db.financial(table).where('generation').equals(this.#scope(table)).toArray():
        await this.#db.financial(table).where('[generation+key]').between([this.#scope(table),key+(whole?'':'/')],[this.#scope(table),key+(whole?'':'/\uffff')],true,true).toArray();
      return values.map(value=>unpackRow(table,this.#checked(table,value)!));
    });
  }
  /** Bounded primary-key page for private optimistic snapshot readers. */
  async page<K extends TableName>(table:K,after:string|null=null,size=500){
    return this.#guard(async()=>{
      requireStorage(Number.isInteger(size)&&size>0&&size<=500,'invariant_violation');
      const scope=this.#scope(table),values=await this.#db.financial(table).where('[generation+key]')
        .between([scope,after??Dexie.minKey],[scope,Dexie.maxKey],after===null,true).limit(size).toArray();
      return {after:values.at(-1)?.key??null,rows:values.map(value=>unpackRow(table,this.#checked(table,value)!))};
    });
  }

  async count(table:TableName,prefix:readonly Scalar[]=[]):Promise<number>{
    return this.#guard(async()=>{
      requireStorage(prefix.length<=SCHEMA[table].primary.length,'schema_unsupported');const key=prefix.length?encodeKey(prefix):null,whole=prefix.length===SCHEMA[table].primary.length;
      return key===null?this.#db.financial(table).where('generation').equals(this.#scope(table)).count():
        this.#db.financial(table).where('[generation+key]').between([this.#scope(table),key+(whole?'':'/')],[this.#scope(table),key+(whole?'':'/\uffff')],true,true).count();
    });
  }
  /** Fixed planned intervals reference immutable snapshots proved once per account. */
  async insertCapturePlan(rows:readonly RowByTable['capture_intervals'][]){
    return this.#guard(async()=>{
      requireStorage(!this.#mirrorOnly&&!this.#setupOnly&&rows.length<=500,'dataset_not_writable');const checked=new Set<string>(),values:FinancialEnvelope[]=[];
      for(const row of rows){
        requireStorage(row.state==='planned'&&row.total_pages===null&&row.total_records===null,'invariant_violation');
        const key=JSON.stringify([row.job_id,row.account_id,row.settings_version]);
        if(!checked.has(key)){const snapshot=await this.get('job_accounts',[['text',row.job_id],['text',row.account_id]]);requireStorage(snapshot!==null&&snapshot.settings_version===row.settings_version,'invariant_violation');checked.add(key);}
        values.push(envelope(this.#generation,'capture_intervals',packRow('capture_intervals',row)));
      }
      if(values.length){await this.#changed('capture_intervals');await this.#db.financial('capture_intervals').bulkAdd(values);for(const value of values)this.sourceChanges.upsert('capture_intervals',value.key,unpackRow('capture_intervals',value.row));}
    });
  }

  async #lookup(table:TableName,columns:readonly string[],values:readonly Scalar[]):Promise<TaggedRow|null>{
    this.#assert();
    const key=encodeKey(values),definition=SCHEMA[table];
    if(same(columns,definition.primary))return this.#checked(table,await this.#db.financial(table).get([this.#scope(table),key]));
    const index=definition.indexes.find(index=>index.unique && !index.partial && same(index.columns,columns));
    requireStorage(index!==undefined,'schema_unsupported');
    return this.#checked(table,await this.#db.financial(table).where('[generation+'+index.key+']').equals([this.#scope(table),key]).first());
  }
  async find<K extends TableName>(table:K,columns:readonly string[],values:readonly Scalar[]):Promise<RowByTable[K]|null>{
    return this.#guard(async()=>{requireStorage(columns.length===values.length,'schema_unsupported');const row=await this.#lookup(table,columns,values);return row===null?null:unpackRow(table,row);});
  }
  async related<K extends TableName>(table:K,columns:readonly string[],values:readonly Scalar[]):Promise<RowByTable[K][]>{
    return this.#guard(async()=>{
      requireStorage(columns.length===values.length,'schema_unsupported');const definition=SCHEMA[table];
      const foreign=definition.foreignKeys.findIndex(key=>same(key.columns,columns));
      const index=definition.indexes.find(key=>!key.partial&&same(key.columns,columns));
      requireStorage(foreign>=0||index!==undefined,'schema_unsupported');
      const rows=await this.#db.financial(table).where('[generation+'+(foreign>=0?'fk'+foreign:index!.key)+']').equals([this.#scope(table),encodeKey(values)]).toArray();
      return rows.map(value=>unpackRow(table,this.#checked(table,value)!));
    });
  }

  async #foreignKeys(table:TableName,row:TaggedRow):Promise<void>{
    const definition=SCHEMA[table];
    for(const foreign of definition.foreignKeys){
      const values=foreign.columns.map(name=>field(table,row,name));
      if(values.some(value=>value[0]==='null'))continue;
      requireStorage(await this.#lookup(foreign.table,foreign.target,values)!==null,'constraint_violation');
    }
  }

  async #authorization(row:TaggedRow):Promise<void>{
    const table='delivery_authorizations';
    const bankId=field(table,row,'bank_id'),intervalId=field(table,row,'interval_id'),jobId=field(table,row,'job_id');
    const proof=await this.get('captured_records',[intervalId,bankId]);
    const interval=await this.get('capture_intervals',[intervalId]);
    const bank=await this.get('bank_transactions',[bankId]);
    requireStorage(proof!==null && interval!==null && bank!==null,'invariant_violation');
    const snapshot=await this.get('job_accounts',[jobId,['text',bank.account_id]]);
    requireStorage(snapshot!==null && proof.revision===textField(table,row,'revision') && interval.state==='complete' &&
      snapshot.settings_version===textField(table,row,'settings_version') &&
      snapshot.target_id===textField(table,row,'target_id'),'invariant_violation');
  }

  async #inserting(table:TableName,row:TaggedRow):Promise<void>{
    if(table==='capture_intervals'){
      const snapshot=await this.get('job_accounts',[field(table,row,'job_id'),field(table,row,'account_id')]);
      requireStorage(snapshot!==null && snapshot.settings_version===textField(table,row,'settings_version'),'invariant_violation');
    }else if(table==='captured_records'){
      const interval=await this.get('capture_intervals',[field(table,row,'interval_id')]);
      const bank=await this.get('bank_transactions',[field(table,row,'bank_id')]);
      requireStorage(interval!==null && bank!==null && interval.account_id===bank.account_id,'invariant_violation');
    }else if(table==='delivery_authorizations')await this.#authorization(row);
  }

  async #changing(table:TableName,old:TaggedRow,next:TaggedRow|null):Promise<void>{
    const value=(name:string)=>textField(table,old,name);
    const upcoming=(name:string)=>next===null?null:textField(table,next,name);
    if(next===null)requireStorage(!immutableDelete.has(table),'invariant_violation');
    else requireStorage(!immutableUpdate.has(table),'invariant_violation');
    if(table==='bank_processing'){
      const state=value('state');
      requireStorage(next===null?!['delivered','suppressed'].includes(state!):
        state==='suppressed'?upcoming('state')==='suppressed':state!=='delivered'||['delivered','suppressed'].includes(upcoming('state')!),'invariant_violation');
    }
    if(next!==null && table==='bank_transactions')for(const name of ['id','account_id','external_id'])requireStorage(value(name)===upcoming(name),'invariant_violation');
    if(next!==null && table==='capture_intervals'){
      for(const name of ['id','job_id','account_id','settings_version','start_date','end_date'])requireStorage(value(name)===upcoming(name),'invariant_violation');
      if(value('state')==='complete')for(const name of ['state','total_pages','total_records'])requireStorage(value(name)===upcoming(name),'invariant_violation');
    }
    if(table==='deliveries'){
      if(next===null)requireStorage(value('ever_attempted')!=='1' && !['delivered','suppressed'].includes(value('state')!),'invariant_violation');
      else{
        for(const name of ['bank_id','zen_id'])requireStorage(value(name)===upcoming(name),'invariant_violation');
        requireStorage(BigInt(upcoming('ever_attempted')!)>=BigInt(value('ever_attempted')!),'invariant_violation');
        if(value('ever_attempted')==='1')requireStorage(upcoming('payload')===value('payload'),'invariant_violation');
        if(value('state')==='suppressed')requireStorage(upcoming('state')==='suppressed','invariant_violation');
        if(value('state')==='delivered')requireStorage(['delivered','suppressed'].includes(upcoming('state')!),'invariant_violation');
      }
    }
    if(table==='delivery_authorizations'){
      const delivery=await this.#lookup('deliveries',['bank_id'],[field(table,old,'bank_id')]);
      requireStorage(delivery===null || textField('deliveries',delivery,'ever_attempted')!=='1','invariant_violation');
      if(next!==null)await this.#authorization(next);
    }
  }

  async insert<K extends TableName>(table:K,fields:RowByTable[K]):Promise<void>{
    return this.#guard(async()=>{
      this.#writeScope(table,table==='dataset_metadata'?[['text',(fields as RowByTable['dataset_metadata']).key]]:undefined);
      const value=envelope(this.#scope(table),table,packRow(table,fields));
      await this.#foreignKeys(table,value.row);await this.#inserting(table,value.row);
      await this.#changed(table);this.#assert();await this.#db.financial(table).add(value);this.sourceChanges.upsert(table,value.key,fields);
    });
  }

  async replace<K extends TableName>(table:K,primary:readonly Scalar[],fields:RowByTable[K]):Promise<void>{
    return this.#guard(async()=>{
      this.#writeScope(table,primary);
      const value=envelope(this.#scope(table),table,packRow(table,fields));
      requireStorage(value.key===encodeKey(primary),'invariant_violation');
      const old=this.#checked(table,await this.#db.financial(table).get([this.#scope(table),value.key]));
      requireStorage(old!==null,'constraint_violation');
      await this.#changing(table,old,value.row);await this.#foreignKeys(table,value.row);
      if(JSON.stringify(old)===JSON.stringify(value.row))return;
      await this.#changed(table);this.#assert();await this.#db.financial(table).put(value);this.sourceChanges.upsert(table,value.key,fields);
    });
  }

  async remove(table:TableName,primary:readonly Scalar[]):Promise<void>{
    return this.#guard(async()=>{
      this.#writeScope(table,primary);
      const key=encodeKey(primary),old=this.#checked(table,await this.#db.financial(table).get([this.#scope(table),key]));
      if(old===null)return;
      await this.#changing(table,old,null);
      for(const [name,definition]of Object.entries(SCHEMA)){
        const child=name as TableName;
        for(let i=0;i<definition.foreignKeys.length;i++){
          const foreign=definition.foreignKeys[i];if(foreign.table!==table)continue;
          const parentKey=valuesKey(table,old,foreign.target,true);if(parentKey===undefined)continue;
          const dependants=this.#db.financial(child).where('[generation+fk'+i+']').equals([this.#scope(child),parentKey]);
          if(foreign.onDelete==='CASCADE'){
            const rows=await dependants.toArray();
            for(const dependant of rows){
              const row=this.#checked(child,dependant)!;
              await this.remove(child,SCHEMA[child].primary.map(column=>field(child,row,column)));
            }
          }else requireStorage(await dependants.first()===undefined,'constraint_violation');
        }
      }
      await this.#changed(table);this.#assert();await this.#db.financial(table).delete([this.#scope(table),key]);this.sourceChanges.remove(table,key);
    });
  }
}

/** Only typed storage repositories may call this callback-based internal API. */
export async function writeTransaction<T>(db:FinancialDatabase,sentinel:SentinelPort,fence:ContextFence,operation:(view:RepositorySession)=>Promise<T>):Promise<T>{
  return transact(db,sentinel,fence,operation,false,false);
}

/** Read-mirror initialization is allowed while awaiting explicit sending consent.
 * The session cannot mutate bank/delivery facts or release the participant fence.
 */
export async function writeMirrorTransaction<T>(db:FinancialDatabase,sentinel:SentinelPort,fence:ContextFence,operation:(view:RepositorySession)=>Promise<T>):Promise<T>{
  return transact(db,sentinel,fence,operation,true,false);
}

/** Only named account repositories may enter imported setup, after fresh identity. */
export async function writeSetupTransaction<T>(db:FinancialDatabase,sentinel:SentinelPort,fence:ContextFence,operation:(view:RepositorySession)=>Promise<T>):Promise<T>{
  return transact(db,sentinel,fence,operation,false,true);
}

/** Only the named capture owner may accept an explicit imported Sync. */
export async function writeExplicitSyncTransaction<T>(db:FinancialDatabase,sentinel:SentinelPort,fence:ContextFence,requestId:string,clock:()=>number,operation:(view:RepositorySession,releasing:boolean)=>Promise<T>){
  return transact(db,sentinel,fence,operation,false,false,{requestId,clock});
}

async function transact<T>(db:FinancialDatabase,sentinel:SentinelPort,fence:ContextFence,operation:(view:RepositorySession,releasing:boolean)=>Promise<T>,mirrorOnly:boolean,setup:boolean,explicit?:{requestId:string;clock:()=>number}):Promise<T>{
  const scope={...fence};let publish:(()=>void)|undefined;
  try{
    await sentinel.markFinancialActivity(scope.installationId);
    const marker=await readAnchor(sentinel,scope.installationId,true);
    const result=await db.transaction('rw',db.tables,async()=>{
      const runtime=await assertAnchor(db,marker);
      const dataset=datasetControl(await db.datasets.get(scope.generation));
      requireStorage(runtime.installationId===scope.installationId && runtime.activeMode==='local' && runtime.activeGeneration===scope.generation &&
        runtime.epoch===scope.epoch && (scope.credentialEpoch===undefined||runtime.credentialEpoch===scope.credentialEpoch) && runtime.pendingSwitchId===null,'stale_epoch');
      requireStorage(dataset.lifecycle==='active' && dataset.holdId===null,'dataset_not_writable');
      const authority=participantControl(await db.participants.get(dataset.participantId));
      requireStorage(authority.generation===scope.generation&&authority.epoch===dataset.participantEpoch&&
        authority.state==='active'&&(mirrorOnly||setup||explicit!==undefined||!authority.awaitingSync),'dataset_not_writable');
      const releasing=explicit!==undefined&&authority.awaitingSync;let checkedAt:string|null=null;
      const trustedNow=()=>{const at=Math.floor(explicit!.clock());requireStorage(Number.isSafeInteger(at)&&at>=0&&at<=253402300799,'invalid_row');return at;};
      const fresh=()=>{const at=trustedNow();requireStorage(checkedAt!==null&&BigInt(at)>=BigInt(checkedAt)&&BigInt(at)-BigInt(checkedAt)<=300n,'dataset_not_writable');return at;};
      if(releasing){
        requireStorage(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(explicit.requestId),'invalid_row');
        checkedAt=await assertSetup(db,runtime,false,trustedNow());fresh();
        await db.participants.put({...authority,awaitingSync:false});
      }
      if(setup&&authority.awaitingSync)await assertSetup(db,runtime);
      await db.runtime.put({...runtime,financialMayHaveStarted:true});
      const owner=Dexie.currentTransaction;requireStorage(owner!==undefined,'storage_corrupt');
      const view=new RepositorySession(db,scope.generation,owner,await mirrorScope(db,scope.generation),mirrorOnly,setup&&authority.awaitingSync);
      try{
        const publication=await sourcePublication(db,runtime,view);
        const result=await operation(view,releasing);
        if(releasing){
          const at=String(fresh());await db.applicationState.put({scope:'local-first-sync:'+scope.generation,value:{requestId:explicit!.requestId,at,epoch:runtime.epoch,credentialEpoch:runtime.credentialEpoch}});
          fresh();
        }
        if(publication)publish=await publication();
        return result;
      }finally{view.close();}
    });
    publish?.();return result;
  }catch(error){throw storageFailure(error);}
}
