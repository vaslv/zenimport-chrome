/** Private coordinator facts. Credential references are UUIDs, never tokens. */
import type {RuntimeControl} from '../../control/types.js';
import {runtimeControl} from '../../control/validation.js';
import {participantUuid,participantInteger,participantDigest,requireParticipant,canonicalParticipant} from '../../control/participant-wire.js';
import type {ParticipantReceipt} from '../../control/participant-wire.js';
import type {ParticipantCommand} from '../storage/participant-model.js';
import {participantRequest} from '../storage/participant-transition.js';
import {receipt} from './wire.js';

export const PHASES=['requested','destination_checked','source_quiescing','source_paused','export_ready','importing',
  'destination_verified','source_handed_off','active_pointer_committed','destination_activated','complete'] as const;
export type SwitchPhase=typeof PHASES[number];
export type Side='source'|'destination';
export interface SwitchPlan{
  id:string;direction:'local-to-remote'|'remote-to-local';sourceId:string;destinationId:string|null;
  remoteCredentialRef:string;localCredentialRef:string;ownerIds:string[];
}
export interface JournalCommand{side:Side;command:Exclude<ParticipantCommand,'source_seal'>|'finalize';request:Record<string,unknown>}
export interface SwitchJournal{
  version:1;plan:SwitchPlan;initialRoot:RuntimeControl;phase:SwitchPhase;revision:string;
  lease:{id:string;deadline:string}|null;destinationGeneration:string|null;
  commands:JournalCommand[];receipts:ParticipantReceipt[];chunks:string[];error:string|null;
}
export const sameJournal=(a:unknown,b:unknown)=>new TextDecoder().decode(canonicalParticipant(a))===new TextDecoder().decode(canonicalParticipant(b));
const keys=(value:object,list:string)=>Object.keys(value).sort().join(',')===list;
const required:Partial<Record<SwitchPhase,ParticipantCommand>>={source_paused:'source_start',export_ready:'source_seal',importing:'destination_start',destination_verified:'destination_arm',source_handed_off:'source_handoff',destination_activated:'destination_activate'};
export function switchPlan(input:unknown):SwitchPlan{
  requireParticipant(input!==null&&typeof input==='object'&&!Array.isArray(input));const value=input as SwitchPlan;
  requireParticipant(keys(value,'destinationId,direction,id,localCredentialRef,ownerIds,remoteCredentialRef,sourceId'));
  for(const id of [value.id,value.sourceId,value.remoteCredentialRef,value.localCredentialRef])participantUuid(id);
  requireParticipant(['local-to-remote','remote-to-local'].includes(value.direction));
  if(value.destinationId!==null)participantUuid(value.destinationId);
  requireParticipant(value.direction==='remote-to-local'||value.destinationId!==null);
  requireParticipant(value.destinationId!==value.sourceId&&Array.isArray(value.ownerIds)&&value.ownerIds.length>0&&value.ownerIds.length<=200&&
    value.ownerIds.every(id=>typeof id==='string'&&/^[1-9][0-9]{0,239}$/.test(id))&&new Set(value.ownerIds).size===value.ownerIds.length);
  return structuredClone(value);
}
export function commandRequest(side:Side,command:JournalCommand['command'],request:unknown){
  requireParticipant((side==='source'?['source_start','source_cancel','source_resume','source_handoff']:['destination_start','destination_arm','destination_discard','destination_activate','finalize']).includes(command));
  if(command!=='finalize'){
    const checked=participantRequest(command,request).request;
    if(command==='source_start')participantUuid(checked.peer_id);
    else if(Object.hasOwn(checked,'peer_receipt')){
      const proof=receipt(checked.peer_receipt),expected={destination_start:'source_seal',source_handoff:'destination_arm',destination_discard:'source_cancel',source_resume:'destination_discard',destination_activate:'source_handoff'};
      requireParticipant(proof.command===expected[command as keyof typeof expected]&&proof.switch_id===checked.switch_id);
    }
    return checked;
  }
  requireParticipant(request!==null&&typeof request==='object'&&!Array.isArray(request));const value=request as Record<string,unknown>;
  requireParticipant(keys(value,'expected_epoch,request_id,switch_id'));participantUuid(value.request_id);participantUuid(value.switch_id);participantInteger(value.expected_epoch);return structuredClone(value);
}
export function switchJournal(input:unknown):SwitchJournal{
  requireParticipant(input!==null&&typeof input==='object'&&!Array.isArray(input));const value=input as SwitchJournal;
  requireParticipant(keys(value,'chunks,commands,destinationGeneration,error,initialRoot,lease,phase,plan,receipts,revision,version')&&value.version===1&&PHASES.includes(value.phase));
  const plan=switchPlan(value.plan),root=runtimeControl(value.initialRoot);participantInteger(value.revision);
  requireParticipant(root.activeMode===(plan.direction==='local-to-remote'?'local':'remote')&&root.pendingSwitchId===null);
  if(value.destinationGeneration!==null){participantUuid(value.destinationGeneration);requireParticipant(plan.direction==='remote-to-local'&&plan.destinationId!==null);}
  if(plan.direction==='remote-to-local')requireParticipant((plan.destinationId===null)===(value.destinationGeneration===null));
  if(value.lease!==null){requireParticipant(typeof value.lease==='object'&&keys(value.lease,'deadline,id'));participantUuid(value.lease.id);participantInteger(value.lease.deadline,9223372036854775807n,0n);}
  requireParticipant(value.error===null||['migration_busy','migration_paused','migration_not_empty','migration_invalid','migration_wrong_account','migration_incomplete','zenmoney_unavailable','backend_unavailable','unauthorized','permission_required','quota_exceeded','recovery_required'].includes(value.error));
  requireParticipant(Array.isArray(value.commands)&&value.commands.length<=10&&Array.isArray(value.receipts)&&value.receipts.length<=10&&Array.isArray(value.chunks)&&value.chunks.length<=256);
  const commands=new Set<string>();
  for(const entry of value.commands){requireParticipant(entry!==null&&typeof entry==='object'&&keys(entry,'command,request,side'));
    const checked=commandRequest(entry.side,entry.command,entry.request),key=entry.side+':'+entry.command;
    requireParticipant(!commands.has(key)&&checked.switch_id===plan.id);commands.add(key);
  }
  const proofs=new Set<string>();
  for(const entry of value.receipts){const proof=receipt(entry);requireParticipant(proof.switch_id===plan.id);
    const side=proof.role==='source'?'source':'destination',id=side==='source'?plan.sourceId:plan.destinationId,peer=side==='source'?plan.destinationId:plan.sourceId;
    requireParticipant(proof.installation_id===id&&proof.peer_id===peer&&!proofs.has(proof.command));proofs.add(proof.command);
    if(proof.command!=='source_seal'){
      const command=value.commands.find(row=>row.side===side&&row.command===proof.command);
      requireParticipant(command!==undefined&&command.request.request_id===proof.request_id&&BigInt(command.request.expected_epoch as string)+1n===BigInt(proof.participant_epoch));
    }
  }
  for(const [phase,command] of Object.entries(required))if(PHASES.indexOf(value.phase)>=PHASES.indexOf(phase as SwitchPhase))requireParticipant(value.receipts.some(row=>row.command===command));
  if(PHASES.indexOf(value.phase)>=PHASES.indexOf('source_quiescing'))requireParticipant(plan.destinationId!==null);
  value.chunks.forEach(participantDigest);
  const seal=value.receipts.find(row=>row.command==='source_seal');
  if(seal){
    const started=value.receipts.find(row=>row.command==='source_start');
    requireParticipant(started!==undefined&&started.dataset_id===seal.dataset_id&&BigInt(seal.participant_epoch)===BigInt(started.participant_epoch)+1n&&seal.dataset_digest!==null&&seal.archive_sha256!==null&&seal.archive_size!==null);
    requireParticipant(value.chunks.length<=Math.ceil(Number(seal.archive_size)/262144));
    if(PHASES.indexOf(value.phase)>=PHASES.indexOf('destination_verified'))requireParticipant(value.chunks.length===Math.ceil(Number(seal.archive_size)/262144));
    for(const proof of value.receipts)if(!['source_start','source_seal'].includes(proof.command))requireParticipant(proof.dataset_id===seal.dataset_id&&proof.dataset_digest===seal.dataset_digest&&proof.archive_sha256===seal.archive_sha256&&proof.archive_size===seal.archive_size);
  }else requireParticipant(value.chunks.length===0);
  return structuredClone(value);
}
export function advancePhase(journal:SwitchJournal,next:SwitchPhase):SwitchJournal{
  requireParticipant(PHASES.indexOf(next)===PHASES.indexOf(journal.phase)+1);
  requireParticipant(required[next]===undefined||journal.receipts.some(row=>row.command===required[next]));
  if(next==='source_quiescing')requireParticipant(journal.plan.destinationId!==null);
  return switchJournal({...journal,phase:next,error:null});
}
