/** Persist facts-only validation atomically, never an activation or owner grant. */
import type {ContextFence,SentinelPort,DatasetSentinel} from '../../control/types.js';
import {runtimeControl,datasetControl} from '../../control/validation.js';
import {validateFinancialGraph} from '../portable/graph.js';
import {PortableError,portableFailure} from '../portable/format.js';
import {StageGraphReader} from './graph-reader.js';
import type {FinancialDatabase} from './database.js';
import {stageRecord} from './stage-types.js';
import type {StageRecord,StageSummary} from './stage-types.js';
import {stageSummary} from './staging.js';
import {int64,requireStorage} from './types.js';
import {readAnchor} from './anchor.js';
import {assertImportScope,scopeTables} from './import-scope.js';
import type {ImportPermit} from './import-scope.js';

async function owned(db:FinancialDatabase,fence:ContextFence,original:StageRecord,marker:DatasetSentinel,permit?:ImportPermit){
  await assertImportScope(db,fence,marker,permit);
  const stage=stageRecord(await db.stages.get(original.id)),dataset=datasetControl(await db.datasets.get(original.id));
  requireStorage((permit?stage.id===fence.generation:stage.id!==fence.generation)&&stage.writerId===original.writerId&&stage.installationId===fence.installationId&&stage.routingEpoch===fence.epoch&&
    stage.manifest===original.manifest&&stage.archiveSha256===original.archiveSha256&&stage.rowCount===original.rowCount&&stage.byteCount===original.byteCount&&
    ((stage.state==='format_valid'&&dataset.lifecycle==='staging')||(stage.state==='graph_valid'&&(dataset.lifecycle==='validated'||!!permit&&dataset.lifecycle==='armed')))&&dataset.holdId===(permit?.switchId??null),'dataset_not_writable');
  const summary=stageSummary(stage);requireStorage(summary.datasetId===dataset.datasetId,'storage_corrupt');
  return {stage,dataset};
}

export async function validateStageGraph(db:FinancialDatabase,sentinel:SentinelPort,inputFence:ContextFence,id:string,now:string,permit?:ImportPermit):Promise<StageSummary>{
  const fence={...inputFence},stamp=int64(now);requireStorage(BigInt(stamp)>=0n);
  const original=stageRecord(await db.stages.get(id));
  try{
    const reader=await StageGraphReader.open(db,sentinel,fence,id,permit),result=await validateFinancialGraph(reader,reader.manifest);
    const marker=await readAnchor(sentinel,fence.installationId,true);
    return await db.transaction('rw',[...scopeTables(db),db.stages],async()=>{
      const {stage,dataset}=await owned(db,fence,original,marker,permit);
      requireStorage(result.datasetId===dataset.datasetId&&result.datasetDigest===stageSummary(stage).datasetDigest,'storage_corrupt');
      if(stage.state==='graph_valid')return stageSummary(stage); // Original verified-at is stable on retry.
      const next=stageRecord({...stage,state:'graph_valid',graphVersion:'1',graphDigest:result.datasetDigest,graphVerifiedAt:stamp});
      await db.stages.put(next);await db.datasets.put({...dataset,lifecycle:'validated'});return stageSummary(next);
    });
  }catch(error){
    // A revoked context, closed DB or unavailable marker is not bad financial
    // data. Only a semantic/integrity failure can revoke an inactive fact proof.
    if(error instanceof PortableError)try{
      const marker=await readAnchor(sentinel,fence.installationId,true);
      await db.transaction('rw',[...scopeTables(db),db.stages],async()=>{
        const {stage,dataset}=await owned(db,fence,original,marker,permit);
        await db.stages.put(stageRecord({...stage,state:'failed',errorCode:error.code,graphVersion:null,graphDigest:null,graphVerifiedAt:null}));
        await db.datasets.put({...dataset,lifecycle:'staging'});
      });
    }catch{/* A stale owner/full disk leaves the generation inactive and unpromoted. */}
    throw portableFailure(error,'invalid_financial_graph');
  }
}
