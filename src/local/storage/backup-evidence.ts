/** Strict durable facts proof for a downloaded snapshot of an inactive copy. */
import {runtimeControl} from '../../control/validation.js';
import {participantUuid,participantDigest,requireParticipant} from '../../control/participant-wire.js';
import {validateManifest} from '../portable/format.js';
import {int64} from './types.js';
export function inactiveBackupEvidence(value:Record<string,unknown>){
  const keys='acknowledgedAt,archiveId,bytes,chunks,createdAt,datasetId,generation,held,id,initialRoot,manifest,nonce,phase,sha256,version';
  requireParticipant(Object.keys(value).sort().join(',')===keys&&value.version==='1'&&value.held===false&&
    ['ready','cleaned'].includes(value.phase as string)&&value.nonce===null,'migration_invalid');
  for(const key of ['id','generation','datasetId','archiveId'])participantUuid(value[key]);
  participantDigest(value.sha256);const created=BigInt(int64(value.createdAt)),ack=BigInt(int64(value.acknowledgedAt));
  requireParticipant(created>=0n&&ack>=created&&ack<=253402300799n,'migration_invalid');
  const root=runtimeControl(value.initialRoot);requireParticipant(root.activeGeneration!==value.generation&&root.pendingSwitchId===null,'migration_invalid');
  requireParticipant(typeof value.bytes==='number'&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&value.bytes<=67108864&&
    typeof value.chunks==='number'&&Number.isSafeInteger(value.chunks)&&value.chunks===Math.ceil(value.bytes/262144),'migration_invalid');
  const manifest=validateManifest(value.manifest);
  requireParticipant(manifest.dataset_id===value.datasetId&&manifest.archive_id===value.archiveId&&manifest.export_session_id===value.id&&
    manifest.created_at===new Date(Number(created)*1000).toISOString(),'migration_invalid');
  return {generation:value.generation as string,datasetId:value.datasetId as string,backupId:value.id as string,
    archiveSha256:value.sha256 as string,datasetDigest:manifest.dataset_digest};
}
