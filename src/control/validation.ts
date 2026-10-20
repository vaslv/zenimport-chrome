import type {DatasetControl,RuntimeControl} from './types.js';
import {int64,requireStorage} from '../local/storage/types.js';

function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
  requireStorage(typeof value==='object' && value!==null && !Array.isArray(value),'storage_corrupt');
  requireStorage(Object.keys(value).sort().join(',')===[...keys].sort().join(','),'storage_corrupt');
  return value as Record<string,unknown>;
}

function uuid(value:unknown):boolean{
  return typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

function counter(value:unknown,minimum=0n):void{
  requireStorage(typeof value==='string','storage_corrupt');
  int64(value);requireStorage(BigInt(value)>=minimum,'storage_corrupt');
}

export function runtimeControl(value:unknown):RuntimeControl{
  const row=object(value,['id','installationId','activeMode','activeGeneration','epoch','pendingSwitchId','credentialRef','credentialEpoch','financialMayHaveStarted']);
  requireStorage(row.id==='runtime' && uuid(row.installationId),'storage_corrupt');
  requireStorage((row.activeMode==='local' && uuid(row.activeGeneration)) || (row.activeMode==='remote' && row.activeGeneration===null),'storage_corrupt');
  for(const field of ['pendingSwitchId','credentialRef'])requireStorage(row[field]===null || uuid(row[field]),'storage_corrupt');
  counter(row.epoch,1n);counter(row.credentialEpoch,1n);
  requireStorage(typeof row.financialMayHaveStarted==='boolean','storage_corrupt');
  return row as unknown as RuntimeControl;
}

export function datasetControl(value:unknown):DatasetControl{
  const row=object(value,['generation','datasetId','participantId','participantEpoch','logicalSchemaVersion','lifecycle','ownerIds','holdId','createdAt','backupAcknowledgedAt']);
  for(const key of ['generation','datasetId','participantId'])requireStorage(uuid(row[key]),'storage_corrupt');
  requireStorage(row.logicalSchemaVersion==='1','schema_unsupported');
  requireStorage(typeof row.lifecycle==='string' && ['active','staging','validated','held','armed','retired','discarded'].includes(row.lifecycle),'storage_corrupt');
  requireStorage(row.holdId===null || uuid(row.holdId),'storage_corrupt');
  counter(row.participantEpoch,1n);counter(row.createdAt);
  if(row.backupAcknowledgedAt!==null)counter(row.backupAcknowledgedAt);
  requireStorage(Array.isArray(row.ownerIds) && row.ownerIds.every(id=>typeof id==='string' && id.length>0 && id.length<=240) &&
    new Set(row.ownerIds).size===row.ownerIds.length,'storage_corrupt');
  return row as unknown as DatasetControl;
}
