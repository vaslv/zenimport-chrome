import type {Int64Text} from './types.js';
import {int64,requireStorage} from './types.js';
import {uuidValue,LIMITS} from '../portable/format.js';

/** Private loading journal, never portable financial activation authority. */
export interface StageRecord{
  readonly id:string;
  readonly writerId:string;
  readonly installationId:string;
  readonly routingEpoch:Int64Text;
  readonly state:'loading'|'format_valid'|'graph_valid'|'activated'|'failed'|'discarded';
  readonly manifest:string;
  readonly archiveSha256:string|null;
  readonly rowCount:Int64Text;
  readonly byteCount:Int64Text;
  readonly createdAt:Int64Text;
  readonly errorCode:string|null;
  readonly graphVersion:'1'|null;
  readonly graphDigest:string|null;
  readonly graphVerifiedAt:Int64Text|null;
}

export interface StageSummary{
  readonly id:string;
  readonly state:StageRecord['state'];
  readonly datasetId:string;
  readonly archiveId:string;
  readonly datasetDigest:string;
  readonly archiveSha256:string|null;
  readonly rowCount:Int64Text;
  readonly byteCount:Int64Text;
  readonly errorCode:string|null;
  readonly graphVersion:StageRecord['graphVersion'];
  readonly graphDigest:string|null;
  readonly graphVerifiedAt:Int64Text|null;
}

export function stageRecord(input:unknown):StageRecord{
  requireStorage(typeof input==='object'&&input!==null&&!Array.isArray(input),'storage_corrupt');
  const value=input as Record<string,unknown>;
  const keys=['id','writerId','installationId','routingEpoch','state','manifest','archiveSha256','rowCount','byteCount','createdAt','errorCode',
    'graphVersion','graphDigest','graphVerifiedAt'];
  requireStorage(Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)),'storage_corrupt');
  for(const key of ['id','writerId','installationId'])requireStorage(uuidValue(value[key]),'storage_corrupt');
  for(const key of ['routingEpoch','rowCount','byteCount','createdAt']){
    try{const number=int64(value[key]);requireStorage(BigInt(number)>=(key==='routingEpoch'?1n:0n),'storage_corrupt');}
    catch{requireStorage(false,'storage_corrupt');}
  }
  requireStorage(BigInt(value.rowCount as string)<=BigInt(LIMITS.uncompressed_bytes)&&
    BigInt(value.byteCount as string)<=BigInt(LIMITS.uncompressed_bytes),'storage_corrupt');
  requireStorage(typeof value.manifest==='string'&&new TextEncoder().encode(value.manifest).length<=LIMITS.manifest_bytes,'storage_corrupt');
  requireStorage(value.archiveSha256===null||typeof value.archiveSha256==='string'&&/^[0-9a-f]{64}$/.test(value.archiveSha256),'storage_corrupt');
  requireStorage(value.errorCode===null||typeof value.errorCode==='string'&&/^[a-z_]{1,64}$/.test(value.errorCode),'storage_corrupt');
  requireStorage(typeof value.state==='string'&&['loading','format_valid','graph_valid','activated','failed','discarded'].includes(value.state),'storage_corrupt');
  if(value.state==='loading')requireStorage(value.archiveSha256===null&&value.errorCode===null,'storage_corrupt');
  if(value.state==='format_valid')requireStorage(value.archiveSha256!==null&&value.errorCode===null,'storage_corrupt');
  if(value.state==='failed')requireStorage(value.errorCode!==null,'storage_corrupt');
  if(value.state==='graph_valid'||value.state==='activated'){
    requireStorage(value.archiveSha256!==null&&value.errorCode===null&&value.graphVersion==='1'&&
      typeof value.graphDigest==='string'&&/^[0-9a-f]{64}$/.test(value.graphDigest),'storage_corrupt');
    try{requireStorage(BigInt(int64(value.graphVerifiedAt))>=0n,'storage_corrupt');}catch{requireStorage(false,'storage_corrupt');}
  }else requireStorage(value.graphVersion===null&&value.graphDigest===null&&value.graphVerifiedAt===null,'storage_corrupt');
  return value as unknown as StageRecord;
}

/** Only the version-3 upgrade may synthesize the new nonportable proof fields. */
export function upgradeStageV3(input:unknown):StageRecord{
  requireStorage(input!==null&&typeof input==='object'&&!Array.isArray(input),'storage_corrupt');
  const value=input as Record<string,unknown>;
  requireStorage(Object.keys(value).length===11&&!['graphVersion','graphDigest','graphVerifiedAt'].some(key=>Object.hasOwn(value,key)),'storage_corrupt');
  requireStorage(value.state!=='graph_valid','storage_corrupt');
  return stageRecord({...value,graphVersion:null,graphDigest:null,graphVerifiedAt:null});
}
