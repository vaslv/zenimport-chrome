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

const immutableUpdate=new Set<TableName>(['bank_versions','capture_pages','captured_records','delivery_attempts',
  'job_accounts','job_context','job_requests','processing_receipts','processing_targets']);
const immutableDelete=new Set<TableName>(['bank_versions','capture_pages','captured_records','delivery_attempts',
  'job_accounts','job_context','job_requests','processing_receipts','processing_targets','zen_tombstones']);

const same=(a:readonly string[],b:readonly string[])=>a.length===b.length && a.every((value,i)=>value===b[i]);

/** A view cannot outlive its native transaction or open an implicit writer. */
export class RepositorySession{
  #db:FinancialDatabase;
  #generation:string;
  #owner:Transaction;
  #live=true;
  constructor(db:FinancialDatabase,generation:string,owner:Transaction){this.#db=db;this.#generation=generation;this.#owner=owner;}

  close():void{this.#live=false;}
  #assert():void{requireStorage(this.#live && Dexie.currentTransaction===this.#owner,'stale_epoch');}

  async #guard<T>(operation:()=>Promise<T>):Promise<T>{
    this.#assert();
    try{return await operation();}
    catch(error){this.#owner.abort();throw storageFailure(error);}
  }

  #checked(table:TableName,value:FinancialEnvelope|undefined):TaggedRow|null{
    if(value===undefined)return null;
    requireStorage(value.generation===this.#generation && rowKey(table,value.row)===value.key,'storage_corrupt');
    return validateCells(table,value.row);
  }

  async get<K extends TableName>(table:K,primary:readonly Scalar[]):Promise<RowByTable[K]|null>{
    return this.#guard(async()=>{
      const row=this.#checked(table,await this.#db.financial(table).get([this.#generation,encodeKey(primary)]));
      return row===null?null:unpackRow(table,row);
    });
  }

  async #lookup(table:TableName,columns:readonly string[],values:readonly Scalar[]):Promise<TaggedRow|null>{
    this.#assert();
    const key=encodeKey(values),definition=SCHEMA[table];
    if(same(columns,definition.primary))return this.#checked(table,await this.#db.financial(table).get([this.#generation,key]));
    const index=definition.indexes.find(index=>index.unique && !index.partial && same(index.columns,columns));
    requireStorage(index!==undefined,'schema_unsupported');
    return this.#checked(table,await this.#db.financial(table).where('[generation+'+index.key+']').equals([this.#generation,key]).first());
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
      interval.job_id===textField(table,row,'job_id') && snapshot.settings_version===textField(table,row,'settings_version') &&
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
      const value=envelope(this.#generation,table,packRow(table,fields));
      await this.#foreignKeys(table,value.row);await this.#inserting(table,value.row);
      this.#assert();await this.#db.financial(table).add(value);
    });
  }

  async replace<K extends TableName>(table:K,primary:readonly Scalar[],fields:RowByTable[K]):Promise<void>{
    return this.#guard(async()=>{
      const value=envelope(this.#generation,table,packRow(table,fields));
      requireStorage(value.key===encodeKey(primary),'invariant_violation');
      const old=this.#checked(table,await this.#db.financial(table).get([this.#generation,value.key]));
      requireStorage(old!==null,'constraint_violation');
      await this.#changing(table,old,value.row);await this.#foreignKeys(table,value.row);
      this.#assert();await this.#db.financial(table).put(value);
    });
  }

  async remove(table:TableName,primary:readonly Scalar[]):Promise<void>{
    return this.#guard(async()=>{
      const key=encodeKey(primary),old=this.#checked(table,await this.#db.financial(table).get([this.#generation,key]));
      if(old===null)return;
      await this.#changing(table,old,null);
      for(const [name,definition]of Object.entries(SCHEMA)){
        const child=name as TableName;
        for(let i=0;i<definition.foreignKeys.length;i++){
          const foreign=definition.foreignKeys[i];if(foreign.table!==table)continue;
          const parentKey=valuesKey(table,old,foreign.target,true);if(parentKey===undefined)continue;
          const dependants=this.#db.financial(child).where('[generation+fk'+i+']').equals([this.#generation,parentKey]);
          if(foreign.onDelete==='CASCADE'){
            const rows=await dependants.toArray();
            for(const dependant of rows){
              const row=this.#checked(child,dependant)!;
              await this.remove(child,SCHEMA[child].primary.map(column=>field(child,row,column)));
            }
          }else requireStorage(await dependants.first()===undefined,'constraint_violation');
        }
      }
      this.#assert();await this.#db.financial(table).delete([this.#generation,key]);
    });
  }
}

/** Only typed storage repositories may call this callback-based internal API. */
export async function writeTransaction<T>(db:FinancialDatabase,sentinel:SentinelPort,fence:ContextFence,operation:(view:RepositorySession)=>Promise<T>):Promise<T>{
  const scope={...fence};
  try{
    await sentinel.markFinancialActivity(scope.installationId);
    const marker=await sentinel.read();
    requireStorage(marker!==null && marker.state==='ready' && marker.financialMayHaveStarted &&
      marker.installationId===scope.installationId && marker.generation===scope.generation,'recovery_required');
    return await db.transaction('rw',db.tables,async()=>{
      const runtime=runtimeControl(await db.runtime.get('runtime'));
      const dataset=datasetControl(await db.datasets.get(scope.generation));
      requireStorage(runtime.installationId===scope.installationId && runtime.activeMode==='local' && runtime.activeGeneration===scope.generation &&
        runtime.epoch===scope.epoch && runtime.pendingSwitchId===null,'stale_epoch');
      requireStorage(dataset.lifecycle==='active' && dataset.holdId===null,'dataset_not_writable');
      await db.runtime.put({...runtime,financialMayHaveStarted:true});
      const owner=Dexie.currentTransaction;requireStorage(owner!==undefined,'storage_corrupt');
      const view=new RepositorySession(db,scope.generation,owner);
      try{return await operation(view);}finally{view.close();}
    });
  }catch(error){throw storageFailure(error);}
}
