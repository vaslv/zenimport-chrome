import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
/** Archive controls carry snapshot facts, never live peer/handoff authority. */
import {participantUuid,participantInteger,participantDigest,requireParticipant,canonicalParticipant} from '../../control/participant-wire.js';
import {object} from './wire.js';
export interface ArchiveStatus{
  id:string;kind:'backup'|'recovery';phase:'building'|'ready'|'uploading'|'validating'|'preview'|'activated'|'blocked'|'cancelled'|'cleaned';
  installation_id:string;initial_epoch:string;dataset_id:string;created_at:string;
  archive_sha256:string|null;archive_size:string|null;chunks:string|null;dataset_digest:string|null;acknowledged_at:string|null;error_code:string|null;
}
export interface ArchiveBackupRequest{id:string;installation_id:string;expected_epoch:string}
export interface ArchiveRecoveryRequest{
  id:string;installation_id:string;expected_epoch:string;dataset_id:string;archive_sha256:string;archive_size:string;owner_ids:string[];
  former_writers_retired:true;accept_post_snapshot_evidence_loss:true;
}
export interface ArchivePreview{
  id:string;archive_sha256:string;sdk_sha256:string;source_hash:string;checked_at:string;cursor:string;
  bank_transactions:string;zen_transactions:string;missing_bank:number;extra_zen:number;unchecked_accounts:number;
}
const keys=(value:object,names:string)=>requireParticipant(Object.keys(value).sort().join(',')===names);
export function archiveStatus(input:unknown,id:string):ArchiveStatus{
  participantUuid(id);const v=object(input) as unknown as ArchiveStatus;
  keys(v,'acknowledged_at,archive_sha256,archive_size,chunks,created_at,dataset_digest,dataset_id,error_code,id,initial_epoch,installation_id,kind,phase');
  for(const id of [v.id,v.installation_id,v.dataset_id])participantUuid(id);requireParticipant(v.id===id);
  participantInteger(v.initial_epoch,(1n<<63n)-3n);participantInteger(v.created_at,253402300799n,0n);
  const phases=v.kind==='backup'?['building','ready','blocked','cancelled','cleaned']:v.kind==='recovery'?['uploading','validating','preview','activated','blocked','cancelled','cleaned']:[];
  requireParticipant(phases.includes(v.phase));
  if(v.archive_sha256===null)requireParticipant(v.kind==='backup'&&['building','blocked','cancelled','cleaned'].includes(v.phase)&&v.archive_size===null&&v.chunks===null&&v.dataset_digest===null);
  else{participantDigest(v.archive_sha256);const size=participantInteger(v.archive_size,67108864n);requireParticipant(v.chunks===String((size+262143n)/262144n));}
  if(v.dataset_digest!==null)participantDigest(v.dataset_digest);
  if(['ready','preview','activated'].includes(v.phase))requireParticipant(v.dataset_digest!==null&&v.archive_sha256!==null);
  if(v.acknowledged_at!==null)requireParticipant(v.archive_sha256!==null&&participantInteger(v.acknowledged_at,253402300799n,0n)>=BigInt(v.created_at));
  requireParticipant(v.error_code===null||['migration_busy','migration_paused','migration_not_empty','migration_invalid','migration_wrong_account','migration_incomplete','zenmoney_unavailable','validation_error'].includes(v.error_code));
  requireParticipant(v.phase!=='blocked'||v.error_code!==null);return structuredClone(v);
}
export function backupRequest(input:unknown):ArchiveBackupRequest{
  const v=object(input) as unknown as ArchiveBackupRequest;keys(v,'expected_epoch,id,installation_id');
  participantUuid(v.id);participantUuid(v.installation_id);participantInteger(v.expected_epoch,(1n<<63n)-3n);return structuredClone(v);
}
export function recoveryRequest(input:unknown):ArchiveRecoveryRequest{
  const v=object(input) as unknown as ArchiveRecoveryRequest;
  keys(v,'accept_post_snapshot_evidence_loss,archive_sha256,archive_size,dataset_id,expected_epoch,former_writers_retired,id,installation_id,owner_ids');
  for(const id of [v.id,v.installation_id,v.dataset_id])participantUuid(id);participantInteger(v.expected_epoch,(1n<<63n)-3n);
  participantDigest(v.archive_sha256);participantInteger(v.archive_size,67108864n);
  requireParticipant(v.former_writers_retired===true&&v.accept_post_snapshot_evidence_loss===true&&Array.isArray(v.owner_ids)&&v.owner_ids.length>0&&v.owner_ids.length<=1000&&
    v.owner_ids.every(id=>typeof id==='string'&&id.length>0&&id.length<=240)&&JSON.stringify(v.owner_ids)===JSON.stringify([...new Set(v.owner_ids)].sort())&&new TextEncoder().encode(JSON.stringify(v)).length<=16384);
  return structuredClone(v);
}
export function archivePreview(input:unknown,checksum:string):ArchivePreview{
  participantDigest(checksum);const v=object(input) as unknown as ArchivePreview;
  keys(v,'archive_sha256,bank_transactions,checked_at,cursor,extra_zen,id,missing_bank,sdk_sha256,source_hash,unchecked_accounts,zen_transactions');
  participantUuid(v.id);for(const hash of [v.archive_sha256,v.sdk_sha256,v.source_hash])participantDigest(hash);
  requireParticipant(v.archive_sha256===checksum);participantInteger(v.checked_at,253402300799n,0n);
  for(const n of [v.cursor,v.bank_transactions,v.zen_transactions])participantInteger(n,(1n<<63n)-1n,0n);
  for(const n of [v.missing_bank,v.extra_zen,v.unchecked_accounts])requireParticipant(Number.isSafeInteger(n)&&n>=0);
  return structuredClone(v);
}


export interface RecoveryWithdrawal{
  withdrawal_version:'1';decision:'withdrawn';id:string;request_sha256:string;
  installation_id:string;dataset_id:string;participant_epoch:string;
}
export function recoveryWithdrawal(input:unknown,request:ArchiveRecoveryRequest):RecoveryWithdrawal{
  const v=object(input) as unknown as RecoveryWithdrawal;
  keys(v,'dataset_id,decision,id,installation_id,participant_epoch,request_sha256,withdrawal_version');
  requireParticipant(v.withdrawal_version==='1'&&v.decision==='withdrawn'&&v.id===request.id&&v.installation_id===request.installation_id);
  for(const id of [v.id,v.installation_id,v.dataset_id])participantUuid(id);
  participantDigest(v.request_sha256);participantInteger(v.participant_epoch);
  requireParticipant(v.request_sha256===bytesToHex(sha256(canonicalParticipant(recoveryRequest(request)))));
  return structuredClone(v);
}

export function backupWithdrawal(input:unknown,request:ArchiveBackupRequest):RecoveryWithdrawal{
  const v=object(input) as unknown as RecoveryWithdrawal;
  keys(v,'dataset_id,decision,id,installation_id,participant_epoch,request_sha256,withdrawal_version');
  requireParticipant(v.withdrawal_version==='1'&&v.decision==='withdrawn'&&v.id===request.id&&v.installation_id===request.installation_id);
  for(const id of [v.id,v.installation_id,v.dataset_id])participantUuid(id);
  participantDigest(v.request_sha256);participantInteger(v.participant_epoch);
  requireParticipant(v.request_sha256===bytesToHex(sha256(canonicalParticipant(backupRequest(request)))));return structuredClone(v);
}
