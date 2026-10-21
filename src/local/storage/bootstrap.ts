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
import {validateAudit} from '../portable/audit.js';
import {validateHistory} from '../portable/history.js';
import {LegacyFacts} from '../portable/legacy-facts.js';
import {validateMirror} from '../portable/mirror-proof.js';
import {validateRecords} from '../portable/record-proof.js';
import {validateFinancialGraph} from '../portable/graph.js';
import type {GraphSummary} from '../portable/graph.js';
import {validateStageGraph} from './graph-validation.js';
import {discardStage,acknowledgeStageBackup,collectDiscardedStage} from './stage-cleanup.js';
import {assertAnchor} from './anchor.js';
import {participantControl} from './participant-validation.js';
import {serializeOpen} from './bootstrap-lock.js';

/** L4 owns initialization only. Financial write repositories are added separately. */
export class LocalDatabase{
  #db:FinancialDatabase;
  #sentinel:SentinelPort;
  private constructor(db:FinancialDatabase,sentinel:SentinelPort){this.#db=db;this.#sentinel=sentinel;}

  static async open(name:string,sentinel:SentinelPort,now:string):Promise<LocalDatabase>{
    int64(now);requireStorage(BigInt(now)>=0n,'invalid_row');
    try{return await serializeOpen(name,async()=>{
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
        if(!creating)await db.transaction('r',db.runtime,db.datasets,()=>assertAnchor(db,marker!));
        requireStorage(runtime.activeMode==='local'&&runtime.activeGeneration!==null,'recovery_required');
        const dataset=datasetControl(await db.datasets.get(runtime.activeGeneration));
        requireStorage(dataset.lifecycle==='active','dataset_not_writable');
        const authority=participantControl(await db.participants.get(dataset.participantId));
        requireStorage(authority.generation===dataset.generation&&authority.state==='active','dataset_not_writable');
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

  async checkStageAudit(id:string,fence:ContextFence):Promise<void>{
    const reader=await StageGraphReader.open(this.#db,this.#sentinel,fence,id);
    await validateRelations(reader);await validateAudit(reader,reader.manifest);
  }

  async checkStageHistory(id:string,fence:ContextFence):Promise<void>{
    const reader=await StageGraphReader.open(this.#db,this.#sentinel,fence,id);
    await validateRelations(reader);await validateAudit(reader,reader.manifest);await validateHistory(reader);
  }

  async checkStageMirror(id:string,fence:ContextFence):Promise<void>{
    const reader=await StageGraphReader.open(this.#db,this.#sentinel,fence,id);
    await validateRelations(reader);await validateAudit(reader,reader.manifest);await validateHistory(reader);
    await validateMirror(reader,reader.manifest,await LegacyFacts.read(reader));
  }

  async checkStageRecords(id:string,fence:ContextFence):Promise<void>{
    const reader=await StageGraphReader.open(this.#db,this.#sentinel,fence,id);
    await validateRelations(reader);await validateAudit(reader,reader.manifest);
    await validateRecords(reader,await LegacyFacts.read(reader));
  }

  async checkStageGraph(id:string,fence:ContextFence,expectedOwners?:readonly string[]):Promise<GraphSummary>{
    const reader=await StageGraphReader.open(this.#db,this.#sentinel,fence,id);
    return validateFinancialGraph(reader,reader.manifest,expectedOwners);
  }

  async validateStageGraph(id:string,fence:ContextFence,now:string):Promise<StageSummary>{
    return validateStageGraph(this.#db,this.#sentinel,fence,id,now);
  }

  async discardStage(id:string,fence:ContextFence):Promise<void>{return discardStage(this.#db,this.#sentinel,fence,id);}
  async acknowledgeStageBackup(id:string,fence:ContextFence,now:string):Promise<void>{
    return acknowledgeStageBackup(this.#db,this.#sentinel,fence,id,now);
  }
  async collectDiscardedStage(id:string,fence:ContextFence,now:string):Promise<{removedRows:string;complete:boolean}>{
    return collectDiscardedStage(this.#db,this.#sentinel,fence,id,now);
  }

  /** Persist outside IDB before the first financial mutation/dispatch claim. */
  async markFinancialActivity(fence:ContextFence):Promise<void>{
    await this.#sentinel.markFinancialActivity(fence.installationId);
    const marker=await this.#sentinel.read();requireStorage(marker!==null,'recovery_required');
    await this.#db.transaction('rw',this.#db.runtime,this.#db.datasets,this.#db.participants,async()=>{
      const runtime=await assertAnchor(this.#db,marker);
      requireStorage(runtime.installationId===fence.installationId && runtime.activeGeneration===fence.generation &&
        runtime.epoch===fence.epoch && runtime.activeMode==='local' && runtime.pendingSwitchId===null,'stale_epoch');
      const dataset=datasetControl(await this.#db.datasets.get(fence.generation));
      requireStorage(dataset.lifecycle==='active' && dataset.holdId===null,'dataset_not_writable');
      const authority=participantControl(await this.#db.participants.get(dataset.participantId));
      requireStorage(authority.state==='active'&&!authority.awaitingSync&&authority.generation===dataset.generation,'dataset_not_writable');
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
    const participantId=crypto.randomUUID();
    await db.datasets.add({generation:marker.generation,datasetId:marker.datasetId,participantId,participantEpoch:int64('1'),
      logicalSchemaVersion:'1',lifecycle:'active',ownerIds:[],holdId:null,createdAt:int64(now),backupAcknowledgedAt:null});
    await db.participants.add({id:participantId,generation:marker.generation,epoch:'1',state:'active',operationId:null,everActivated:false,awaitingSync:false});
    async function add<K extends TableName>(table:K,fields:RowByTable[K]){
      const row=packRow(table,fields);await db.financial(table).add({generation:marker.generation,key:rowKey(table,row),row});
    }
    await add('dataset_metadata',{key:'instance_id',value:marker.datasetId});
    await add('zen_mirror_state',{id:int64('1'),source_hash:null,cursor:int64('0'),generation:int64('0'),needs_full:int64('1'),ready:int64('0'),refreshed_at:null,error_code:null});
    await add('delivery_schedule',{id:int64('1'),next_run_at:int64('0'),failures:int64('0')});
  });
}
