/** Inactive imports only. No method here changes the active generation pointer. */
import Dexie from 'dexie';
import type {ContextFence,SentinelPort,RuntimeControl,DatasetSentinel} from '../../control/types.js';
import {runtimeControl,datasetControl} from '../../control/validation.js';
import {readArchive} from '../portable/zip.js';
import {canonical,parseJson,validateManifest,TableScanner} from '../portable/format.js';
import type {PortableManifest} from '../portable/format.js';
import type {TableName} from './schema.generated.js';
import {rowBytes,portableFailure} from '../portable/format.js';
import {envelope} from './envelope.js';
import {int64,requireStorage,storageFailure} from './types.js';
import type {StageRecord,StageSummary} from './stage-types.js';
import {stageRecord} from './stage-types.js';
import type {FinancialDatabase,FinancialEnvelope} from './database.js';
import {readAnchor} from './anchor.js';
import {assertImportScope,scopeTables} from './import-scope.js';
import type {ImportPermit} from './import-scope.js';

async function routing(db:FinancialDatabase,fence:ContextFence,marker:DatasetSentinel,permit?:ImportPermit):Promise<RuntimeControl>{
  return assertImportScope(db,fence,marker,permit);
}

async function stageOwner(db:FinancialDatabase,fence:ContextFence,id:string,writerId:string,marker:DatasetSentinel,permit?:ImportPermit):Promise<StageRecord>{
  await routing(db,fence,marker,permit);
  const stage=stageRecord(await db.stages.get(id)),dataset=datasetControl(await db.datasets.get(id));
  requireStorage((permit?stage.id===fence.generation:stage.id!==fence.generation)&&stage.writerId===writerId&&
    stage.installationId===fence.installationId&&stage.routingEpoch===fence.epoch&&stage.state==='loading'&&
    dataset.lifecycle==='staging'&&dataset.holdId===(permit?.switchId??null),'dataset_not_writable');
  return stage;
}

export function stageSummary(stage:StageRecord):StageSummary{
  stageRecord(stage);
  const manifest=validateManifest(parseJson(new TextEncoder().encode(stage.manifest)));
  if(stage.state==='graph_valid'||stage.state==='activated')requireStorage(stage.graphDigest===manifest.dataset_digest,'storage_corrupt');
  return {id:stage.id,state:stage.state,datasetId:manifest.dataset_id,archiveId:manifest.archive_id,
    datasetDigest:manifest.dataset_digest,archiveSha256:stage.archiveSha256,rowCount:stage.rowCount,byteCount:stage.byteCount,errorCode:stage.errorCode,
    graphVersion:stage.graphVersion,graphDigest:stage.graphDigest,graphVerifiedAt:stage.graphVerifiedAt};
}

export async function stageArchive(db:FinancialDatabase,sentinel:SentinelPort,fence:ContextFence,blob:Blob,now:string,permit?:ImportPermit):Promise<StageSummary>{
  const scope={...fence},id=permit?fence.generation:crypto.randomUUID(),writerId=permit?.nonce??crypto.randomUUID();let createdAt=int64(now);
  requireStorage(BigInt(createdAt)>=0n);let prepared=false;
  let buffer:FinancialEnvelope[]=[],bufferTable:TableName|null=null,bufferBytes=0;
  let marker:DatasetSentinel;
  async function markerFence(){marker=await readAnchor(sentinel,scope.installationId,true);}
  async function flush(){
    if(!buffer.length)return;
    const table=bufferTable!,values=buffer,bytes=bufferBytes;
    await markerFence();
    await db.transaction('rw',[...scopeTables(db),db.stages,db.financial(table)],async()=>{
      const stage=await stageOwner(db,scope,id,writerId,marker,permit);
      await db.financial(table).bulkAdd(values);
      await db.stages.put({...stage,rowCount:int64((BigInt(stage.rowCount)+BigInt(values.length)).toString()),
        byteCount:int64((BigInt(stage.byteCount)+BigInt(bytes)).toString())});
    });
    buffer=[];bufferBytes=0;
  }
  try{
    const result=await readArchive(blob,{
      async manifest(manifest){
        await sentinel.markFinancialActivity(scope.installationId);
        await markerFence();
        await db.transaction('rw',[...scopeTables(db),db.stages],async()=>{
          const runtime=await routing(db,scope,marker,permit);
          if(permit){
            const op=(await db.migrationOperations.get([permit.participantId,permit.switchId]))!;
            requireStorage(op.datasetDigest===manifest.dataset_digest&&op.datasetId===manifest.dataset_id&&manifest.export_session_id===permit.switchId,'storage_corrupt');
            const dataset=datasetControl(await db.datasets.get(id));createdAt=dataset.createdAt;
            await db.datasets.put({...dataset,datasetId:manifest.dataset_id,ownerIds:[...manifest.zenmoney_identity.owner_ids]});
          }else{
          const participantId=crypto.randomUUID();
          await db.datasets.add({generation:id,datasetId:manifest.dataset_id,participantId,participantEpoch:int64('1'),
            logicalSchemaVersion:'1',lifecycle:'staging',ownerIds:[...manifest.zenmoney_identity.owner_ids],holdId:null,
            createdAt,backupAcknowledgedAt:null});
          await db.participants.add({id:participantId,generation:id,epoch:'1',state:'active',operationId:null,everActivated:false,awaitingSync:false});
          }
          await db.stages.add({id,writerId,installationId:scope.installationId,routingEpoch:scope.epoch,state:'loading',
            manifest:new TextDecoder().decode(canonical(manifest)),archiveSha256:null,rowCount:int64('0'),byteCount:int64('0'),createdAt,errorCode:null,
            graphVersion:null,graphDigest:null,graphVerifiedAt:null});
          await db.runtime.put({...runtime,financialMayHaveStarted:true});
        });prepared=true;
      },
      async row(table,row,bytes){
        if(bufferTable!==table)await flush();bufferTable=table;
        buffer.push(envelope(id,table,row));bufferBytes+=bytes;
        if(buffer.length>=500||bufferBytes>=1048576)await flush();
      },
    });
    await flush();
    // Re-read committed IDB rows, not just callback input, before sealing format.
    await verifyStoredFormat(db,scope,id,writerId,result.manifest,markerFence,()=>marker,permit);
    await markerFence();
    return await db.transaction('rw',[...scopeTables(db),db.stages],async()=>{
      const stage=await stageOwner(db,scope,id,writerId,marker,permit);
      if(permit)requireStorage((await db.migrationOperations.get([permit.participantId,permit.switchId]))?.archiveSha256===result.archiveSha256,'storage_corrupt');
      const sealed:StageRecord={...stage,state:'format_valid',archiveSha256:result.archiveSha256};
      await db.stages.put(sealed);return stageSummary(sealed);
    });
  }catch(error){
    buffer=[];
    if(prepared)try{
      await db.transaction('rw',[...scopeTables(db),db.stages],async()=>{
        const stage=await stageOwner(db,scope,id,writerId,marker,permit);
        await db.stages.put({...stage,state:'failed',errorCode:portableFailure(error,'invalid_archive').code});
      });
    }catch{/* A revoked context or full disk leaves an inactive loading journal. */}
    throw portableFailure(error,'invalid_archive');
  }
}

async function verifyStoredFormat(db:FinancialDatabase,fence:ContextFence,id:string,writerId:string,manifest:PortableManifest,markerFence:()=>Promise<void>,anchor:()=>DatasetSentinel,permit?:ImportPermit):Promise<void>{
  for(const entry of manifest.tables){
    let after:string|null=null;const scanner=new TableScanner(entry.name,async()=>{});
    while(true){
      await markerFence();
      const values=await db.transaction('r',[...scopeTables(db),db.stages,db.financial(entry.name)],async()=>{
        await stageOwner(db,fence,id,writerId,anchor(),permit);
        return db.financial(entry.name).where('[generation+key]').between([id,after??Dexie.minKey],[id,Dexie.maxKey],after===null,true).limit(500).toArray();
      });
      if(!values.length)break;
      for(const value of values){
        requireStorage(value.generation===id,'storage_corrupt');const row=rowBytes(entry.name,value.row);
        requireStorage(row.key===value.key,'storage_corrupt');await scanner.push(row.bytes);
      }
      after=values[values.length-1].key;
    }
    scanner.finish(entry);
  }
}

export async function stageSummaries(db:FinancialDatabase):Promise<StageSummary[]>{
  try{return await db.transaction('r',db.runtime,db.datasets,db.stages,async()=>{
    const runtime=runtimeControl(await db.runtime.get('runtime')),result:StageSummary[]=[];
    for(const value of await db.stages.toArray()){
      const stage=stageRecord(value),dataset=datasetControl(await db.datasets.get(stage.id)),item=stageSummary(stage);
      requireStorage(stage.installationId===runtime.installationId&&(stage.id!==runtime.activeGeneration||stage.state==='activated')&&
        dataset.datasetId===item.datasetId&&['active','staging','validated','held','armed','retired','discarded'].includes(dataset.lifecycle),'storage_corrupt');
      result.push(item);
    }
    return result;
  });}catch(error){throw storageFailure(error);}
}
