/** Bounded authenticated participant DTOs; integrity is not authentication. */
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {canonicalParticipant,participantUuid,participantInteger,participantDigest,requireParticipant,checkPeerReceipt,RECEIPT_KEYS} from '../../control/participant-wire.js';
import type {ParticipantReceipt,PeerReceiptCommand} from '../../control/participant-wire.js';
const peers=['source_seal','destination_arm','source_handoff','source_cancel','destination_discard'];
export const object=(value:unknown):Record<string,unknown>=>{requireParticipant(value!==null&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;};
export function receipt(input:unknown):ParticipantReceipt{
  const value=object(input),command=value.command;
  if(peers.includes(command as string))return checkPeerReceipt(input,command as PeerReceiptCommand,participantUuid(value.peer_id));
  const states={source_start:['source','export_hold'],destination_start:['destination','import_hold'],source_resume:['source','resumed'],destination_activate:['destination','activated']} as const;
  requireParticipant(typeof command==='string'&&Object.hasOwn(states,command)&&Object.keys(value).sort().join(',')===[...RECEIPT_KEYS].sort().join(',')&&value.receipt_version==='1');
  const [role,state]=states[command as keyof typeof states];requireParticipant(value.role===role&&value.state===state);
  for(const field of ['request_id','switch_id','installation_id','peer_id','dataset_id'])participantUuid(value[field]);
  participantInteger(value.participant_epoch);if(value.peer_epoch!==null)participantInteger(value.peer_epoch);
  for(const field of ['dataset_digest','archive_sha256'])if(value[field]!==null)participantDigest(value[field]);
  if(value.archive_size!==null)participantInteger(value.archive_size,67108864n);
  const plain={...value};delete plain.receipt_sha256;
  requireParticipant(participantDigest(value.receipt_sha256)===bytesToHex(sha256(canonicalParticipant(plain))));
  return JSON.parse(new TextDecoder().decode(canonicalParticipant(value))) as ParticipantReceipt;
}
export interface PortableCapabilities{
  protocol_version:'2';archive_version:'2';financial_schema_version:'1';chunk_bytes:'262144';max_archive_bytes:'67108864';
  installation_id:string;participant_epoch:string;state:string;operation_id:string|null;awaiting_sync:boolean;legacy_hold:string|null;can_import:boolean;
}
export interface PortableIdentity extends PortableCapabilities{owner_ids:string[];checked_at:string}
export interface PortableStatus{
  installation_id:string;participant_epoch:string;state:string;operation_id:string|null;awaiting_sync:boolean;legacy_hold:string|null;
  operation:Record<string,unknown>&{state:string}|null;receipts:ParticipantReceipt[];work:Record<string,unknown>[];
}
function participant(value:Record<string,unknown>){
  participantUuid(value.installation_id);participantInteger(value.participant_epoch);
  requireParticipant(['active','export_hold','import_hold','armed','cancel_pending','handed_off'].includes(value.state as string)&&typeof value.awaiting_sync==='boolean'&&[null,'exported','imported'].includes(value.legacy_hold as null|string));
  if(value.operation_id!==null)participantUuid(value.operation_id);
  requireParticipant((value.state==='active')===(value.operation_id===null));
}
export function capabilities(input:unknown):PortableCapabilities{
  const value=object(input);participant(value);
  requireParticipant(value.protocol_version==='2'&&value.archive_version==='2'&&value.financial_schema_version==='1'&&value.chunk_bytes==='262144'&&value.max_archive_bytes==='67108864'&&typeof value.can_import==='boolean');
  return value as unknown as PortableCapabilities;
}
export function identity(input:unknown):PortableIdentity{
  const value=object(input);capabilities(value);participantInteger(value.checked_at,9223372036854775807n,0n);
  requireParticipant(Array.isArray(value.owner_ids)&&value.owner_ids.length>0&&value.owner_ids.length<=200&&value.owner_ids.every(id=>typeof id==='string'&&/^[1-9][0-9]*$/.test(id)&&id.length<=240)&&new Set(value.owner_ids).size===value.owner_ids.length);
  return value as unknown as PortableIdentity;
}
export interface PortableTask{id:string;switch_id:string;kind:'snapshot'|'validate'|'activate';state:'queued'|'running'|'blocked'|'complete';error_code:string|null}
export function task(input:unknown,expected:{id?:string;switchId?:string;kind?:string}={}):PortableTask{
  const value=object(input);requireParticipant(Object.keys(value).sort().join(',')==='error_code,id,kind,state,switch_id');
  participantUuid(value.id);participantUuid(value.switch_id);
  requireParticipant(['snapshot','validate','activate'].includes(value.kind as string)&&['queued','running','blocked','complete'].includes(value.state as string)&&
    (value.error_code===null||['migration_busy','migration_paused','migration_not_empty','migration_invalid','migration_wrong_account','migration_incomplete','zenmoney_unavailable','internal_error'].includes(value.error_code as string))&&
    (expected.id===undefined||value.id===expected.id)&&(expected.switchId===undefined||value.switch_id===expected.switchId)&&(expected.kind===undefined||value.kind===expected.kind));
  return {...value} as unknown as PortableTask;
}
export function status(input:unknown,switchId:string):PortableStatus{
  const value=object(input);participant(value);
  requireParticipant(Array.isArray(value.receipts)&&value.receipts.length<=64&&Array.isArray(value.work)&&value.work.length<=8);
  const receipts=value.receipts.map(receipt);requireParticipant(receipts.every(row=>row.switch_id===switchId&&row.installation_id===value.installation_id));
  if(value.operation!==null){const operation=object(value.operation);requireParticipant(operation.switch_id===switchId&&['export_hold','import_hold','armed','cancel_pending','handed_off','activated','discarded','resumed'].includes(operation.state as string));}
  const work=value.work.map(row=>task(row,{switchId}));
  return {...value,receipts,work} as unknown as PortableStatus;
}
