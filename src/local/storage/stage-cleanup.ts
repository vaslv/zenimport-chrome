/** Explicit abandonment only: active or handed-off histories are never collected. */
import type {ContextFence,SentinelPort,DatasetControl} from '../../control/types.js';
import {runtimeControl,datasetControl} from '../../control/validation.js';
import type {FinancialDatabase} from './database.js';
import {stageRecord} from './stage-types.js';
import {stageSummary} from './staging.js';
import {TABLES} from '../portable/format.js';
import {int64,requireStorage} from './types.js';

const RETENTION_SECONDS=86400n;

async function marker(port:SentinelPort,fence:ContextFence){
  const value=await port.read();
  requireStorage(value!==null&&value.state==='ready'&&value.installationId===fence.installationId&&value.financialMayHaveStarted,'recovery_required');
  requireStorage(value.generation===fence.generation,'stale_epoch');
}

async function owned(db:FinancialDatabase,fence:ContextFence,id:string){
  const root=runtimeControl(await db.runtime.get('runtime'));
  requireStorage(root.installationId===fence.installationId&&root.activeMode==='local'&&root.activeGeneration===fence.generation&&
    root.epoch===fence.epoch&&root.pendingSwitchId===null,'stale_epoch');
  const active=datasetControl(await db.datasets.get(fence.generation));
  requireStorage(active.lifecycle==='active'&&active.holdId===null,'dataset_not_writable');
  requireStorage(id!==root.activeGeneration,'dataset_not_writable');
  const stage=stageRecord(await db.stages.get(id)),dataset=datasetControl(await db.datasets.get(id));
  requireStorage(stage.installationId===root.installationId&&stageSummary(stage).datasetId===dataset.datasetId&&
    dataset.createdAt===stage.createdAt,'storage_corrupt');
  requireStorage(dataset.holdId===null&&['staging','validated','discarded'].includes(dataset.lifecycle),'dataset_not_writable');
  requireStorage(stage.state==='discarded'?dataset.lifecycle==='discarded':
    stage.state==='graph_valid'?dataset.lifecycle==='validated':dataset.lifecycle==='staging','storage_corrupt');
  return {stage,dataset};
}

export async function discardStage(db:FinancialDatabase,port:SentinelPort,context:ContextFence,id:string):Promise<void>{
  const fence={...context};await marker(port,fence);
  await db.transaction('rw',db.runtime,db.datasets,db.stages,async()=>{
    const {stage,dataset}=await owned(db,fence,id);
    requireStorage(['loading','format_valid','graph_valid','failed','discarded'].includes(stage.state),'dataset_not_writable');
    await db.stages.put(stageRecord({...stage,state:'discarded',graphVersion:null,graphDigest:null,graphVerifiedAt:null}));
    await db.datasets.put({...dataset,lifecycle:'discarded'});
  });
}

/** A trusted user acknowledgment, not a claim that a download implies a backup. */
export async function acknowledgeStageBackup(db:FinancialDatabase,port:SentinelPort,context:ContextFence,id:string,now:string):Promise<void>{
  const fence={...context},stamp=int64(now);requireStorage(BigInt(stamp)>=0n);await marker(port,fence);
  await db.transaction('rw',db.runtime,db.datasets,db.stages,async()=>{
    const {stage,dataset}=await owned(db,fence,id);
    requireStorage(stage.state==='discarded'&&dataset.lifecycle==='discarded'&&BigInt(stamp)>=BigInt(dataset.createdAt),'dataset_not_writable');
    if(dataset.backupAcknowledgedAt===null)await db.datasets.put({...dataset,backupAcknowledgedAt:stamp});
  });
}

function retained(dataset:DatasetControl,now:bigint):boolean{
  return dataset.backupAcknowledgedAt===null||now<BigInt(dataset.createdAt)+RETENTION_SECONDS||
    now<BigInt(dataset.backupAcknowledgedAt)+RETENTION_SECONDS;
}

/** One bounded resumable batch. Retirement/participant receipt GC is out of scope. */
export async function collectDiscardedStage(db:FinancialDatabase,port:SentinelPort,context:ContextFence,id:string,now:string):Promise<{removedRows:string;complete:boolean}>{
  const fence={...context},stamp=BigInt(int64(now));requireStorage(stamp>=0n);await marker(port,fence);
  return db.transaction('rw',[db.runtime,db.datasets,db.stages,...TABLES.map(name=>db.financial(name))],async()=>{
    const {stage,dataset}=await owned(db,fence,id);
    requireStorage(stage.state==='discarded'&&dataset.lifecycle==='discarded'&&!retained(dataset,stamp),'dataset_not_writable');
    let removed=0;
    for(const name of TABLES){
      const table=db.financial(name),keys=await table.where('generation').equals(id).limit(500-removed).primaryKeys();
      await table.bulkDelete(keys);removed+=keys.length;
      if(removed===500)return {removedRows:String(removed),complete:false};
    }
    // Financial rows and their stage/control journal disappear in the same commit.
    await db.stages.delete(id);await db.datasets.delete(id);
    return {removedRows:String(removed),complete:true};
  });
}
