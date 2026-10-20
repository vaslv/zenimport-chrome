import Dexie from 'dexie';
import type {ContextFence,DatasetSentinel,RuntimeControl,SentinelPort} from '../../control/types.js';
import {validateSentinel} from '../../control/sentinel.js';
import {runtimeControl,datasetControl} from '../../control/validation.js';
import {FinancialDatabase} from './database.js';
import {packRow,rowKey} from './cells.js';
import {int64,requireStorage,storageFailure} from './types.js';
import type {TableName,RowByTable} from './schema.generated.js';
import {stageArchive,stageSummaries} from './staging.js';
import type {StageSummary} from './stage-types.js';
import {StageGraphReader} from './graph-reader.js';
import {validateRelations} from '../portable/relations.js';

const opening=new Map<string,Promise<void>>();

async function serial<T>(name:string,operation:()=>Promise<T>):Promise<T>{
  const previous=opening.get(name)??Promise.resolve();
  let release!:()=>void;
  const current=new Promise<void>(resolve=>{release=resolve;});
  opening.set(name,current);
  await previous;
  try{return await operation();}
  finally{release();if(opening.get(name)===current)opening.delete(name);}
}

/** L4 owns initialization only. Financial write repositories are added separately. */
export class LocalDatabase{
  #db:FinancialDatabase;
  #sentinel:SentinelPort;
  private constructor(db:FinancialDatabase,sentinel:SentinelPort){this.#db=db;this.#sentinel=sentinel;}

  static async open(name:string,sentinel:SentinelPort,now:string):Promise<LocalDatabase>{
    int64(now);requireStorage(BigInt(now)>=0n,'invalid_row');
    try{return await serial(name,async()=>{
      let marker=await sentinel.read();
      const exists=await Dexie.exists(name);
      const creating=marker===null && !exists;
      if(marker===null){
        requireStorage(!exists,'recovery_required');
        marker={version:'1',installationId:crypto.randomUUID(),datasetId:crypto.randomUUID(),generation:crypto.randomUUID(),state:'initializing',financialMayHaveStarted:false};
        await sentinel.create(marker);
      }else{
        validateSentinel(marker);
        requireStorage(exists && marker.state==='ready','recovery_required');
      }
      const db=new FinancialDatabase(name,creating);
      try{
        await db.open();
        if(creating)await initialize(db,marker,now);
        const runtime=runtimeControl(await db.runtime.get('runtime'));
        requireStorage(await db.runtime.count()===1 && runtime.installationId===marker.installationId,'storage_corrupt');
        requireStorage(runtime.activeMode==='local' && runtime.activeGeneration===marker.generation,'recovery_required');
        const dataset=datasetControl(await db.datasets.get(marker.generation));
        requireStorage(dataset.datasetId===marker.datasetId && dataset.lifecycle==='active','storage_corrupt');
        requireStorage(!runtime.financialMayHaveStarted || marker.financialMayHaveStarted,'recovery_required');
        if(creating)await sentinel.acknowledgeReady({...marker,state:'ready'});
        return new LocalDatabase(db,sentinel);
      }catch(error){
        db.close();
        throw storageFailure(error);
      }
    });}catch(error){throw storageFailure(error);}
  }

  async context():Promise<ContextFence>{
    const state=runtimeControl(await this.#db.runtime.get('runtime'));
    requireStorage(state.activeMode==='local' && state.activeGeneration!==null,'recovery_required');
    return {installationId:state.installationId,generation:state.activeGeneration,epoch:state.epoch};
  }

  async inspect():Promise<{runtime:RuntimeControl;tables:number;rows:Record<string,number>}>{
    const runtime=runtimeControl(await this.#db.runtime.get('runtime'));
    const rows:Record<string,number>={};
    for(const table of this.#db.tables)if(table.name.startsWith('f_'))rows[table.name.slice(2)]=runtime.activeGeneration===null?0:
      await table.where('generation').equals(runtime.activeGeneration).count();
    return {runtime,tables:Object.keys(rows).length,rows};
  }

  async stageArchive(blob:Blob,fence:ContextFence,now:string):Promise<StageSummary>{
    return stageArchive(this.#db,this.#sentinel,fence,blob,now);
  }

  async stages():Promise<StageSummary[]>{return stageSummaries(this.#db);}

  /** Partial read-only proof; no lifecycle change or installation authority. */
  async checkStageRelations(id:string,fence:ContextFence):Promise<Readonly<Record<TableName,string>>>{
    return validateRelations(await StageGraphReader.open(this.#db,this.#sentinel,fence,id));
  }

  /** Persist outside IDB before the first financial mutation/dispatch claim. */
  async markFinancialActivity(fence:ContextFence):Promise<void>{
    await this.#sentinel.markFinancialActivity(fence.installationId);
    await this.#db.transaction('rw',this.#db.runtime,this.#db.datasets,async()=>{
      const runtime=runtimeControl(await this.#db.runtime.get('runtime'));
      requireStorage(runtime.installationId===fence.installationId && runtime.activeGeneration===fence.generation &&
        runtime.epoch===fence.epoch && runtime.activeMode==='local' && runtime.pendingSwitchId===null,'stale_epoch');
      const dataset=datasetControl(await this.#db.datasets.get(fence.generation));
      requireStorage(dataset.lifecycle==='active' && dataset.holdId===null,'dataset_not_writable');
      await this.#db.runtime.put({...runtime,financialMayHaveStarted:true});
    });
  }

  close():void{this.#db.close();}
}

async function initialize(db:FinancialDatabase,marker:DatasetSentinel,now:string):Promise<void>{
  const tables=db.tables;
  await db.transaction('rw',tables,async()=>{
    requireStorage(await db.runtime.count()===0 && await db.datasets.count()===0,'storage_corrupt');
    await db.runtime.add({id:'runtime',installationId:marker.installationId,activeMode:'local',activeGeneration:marker.generation,
      epoch:int64('1'),pendingSwitchId:null,credentialRef:null,credentialEpoch:int64('1'),financialMayHaveStarted:false});
    await db.datasets.add({generation:marker.generation,datasetId:marker.datasetId,participantId:crypto.randomUUID(),participantEpoch:int64('1'),
      logicalSchemaVersion:'1',lifecycle:'active',ownerIds:[],holdId:null,createdAt:int64(now),backupAcknowledgedAt:null});
    async function add<K extends TableName>(table:K,fields:RowByTable[K]){
      const row=packRow(table,fields);await db.financial(table).add({generation:marker.generation,key:rowKey(table,row),row});
    }
    await add('dataset_metadata',{key:'instance_id',value:marker.datasetId});
    await add('zen_mirror_state',{id:int64('1'),source_hash:null,cursor:int64('0'),generation:int64('0'),needs_full:int64('1'),ready:int64('0'),refreshed_at:null,error_code:null});
    await add('delivery_schedule',{id:int64('1'),next_run_at:int64('0'),failures:int64('0')});
  });
}
