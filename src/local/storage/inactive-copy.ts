/** Copy immutable inactive facts. The archive carries no source handoff authority. */
import type {ContextFence,SentinelPort} from '../../control/types.js';
import type {FinancialDatabase} from './database.js';
import {StageGraphReader} from './graph-reader.js';
import {validateFinancialGraph} from '../portable/graph.js';
import {createArchive} from '../portable/zip.js';
import {packRow} from './cells.js';

export async function copyInactiveStage(db:FinancialDatabase,port:SentinelPort,fence:ContextFence,id:string,
  createdAt:string,sink:{write(part:Uint8Array):Promise<void>}){
  const reader=await StageGraphReader.open(db,port,{...fence},id),manifest=reader.manifest;
  await validateFinancialGraph(reader,manifest);
  return createArchive({datasetId:manifest.dataset_id,ownerIds:[...manifest.zenmoney_identity.owner_ids],
    archiveId:crypto.randomUUID(),sessionId:crypto.randomUUID(),createdAt,version:'L4-inactive-copy'},async function*(name){
      for await(const row of reader.rows(name))yield packRow(name,row);
    },sink);
}
