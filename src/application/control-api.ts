/** Background-only control dispatch. UI messages never supply authority proofs. */
import type {ApplicationRuntime,ResolvedApplication} from './runtime.js';
import {requireParticipant,participantUuid,participantDigest} from '../control/participant-wire.js';
import {SyncError} from '../../extension/backend-client.js';

const bytes=(value:unknown)=>{
  requireParticipant(typeof value==='string'&&value.length>0&&value.length<=349528&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),'validation_error');
  const text=atob(value);requireParticipant(text.length>0&&text.length<=262144,'validation_error');
  const result=Uint8Array.from(text,c=>c.charCodeAt(0));requireParticipant(btoa(text)===value,'validation_error');return result;
};
const base64=(value:Uint8Array)=>{let text='';for(let offset=0;offset<value.length;offset+=32768)text+=String.fromCharCode(...value.subarray(offset,offset+32768));return btoa(text);};
const text=(value:unknown)=>{requireParticipant(typeof value==='string'&&value.length>0&&value.length<=4096,'validation_error');return value;};
const index=(value:unknown)=>{requireParticipant(Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<256,'validation_error');return value as number;};
const flag=(value:unknown)=>{requireParticipant(typeof value==='boolean','validation_error');return value;};
const number=(value:unknown)=>{requireParticipant(Number.isSafeInteger(value)&&Number(value)>0&&Number(value)<=67108864,'validation_error');return value as number;};
const importTarget=(value:unknown)=>{requireParticipant(value==='browser'||value==='server','validation_error');return value;};
const exportKind=(value:unknown)=>{requireParticipant(value==='local'||value==='remote','validation_error');return value;};
export async function controlStatus(runtime:ApplicationRuntime,app:ResolvedApplication){
  await app.assert(true);const controls=await runtime.controls(app).status(),archives=runtime.archives(app);
  const local=app.local&&app.root.pendingSwitchId===null?await app.local.readiness():null;
  const files=await archives.local.status(),recovery=await archives.recovery.current();
  const backup=app.root.pendingSwitchId===null?await archives.backup.current():null;
  await app.assert(true);
  return {mode:app.context.mode,awaitingSync:app.awaitingSync===true,local,controls,archives:{...files,recovery,backup}};
}
export async function controlCommand(data:Record<string,unknown>,runtime:ApplicationRuntime,app:ResolvedApplication){
  await app.assert(true);const type=data.type;
  if(type==='storage-status'||type==='archive-status')return {storage:await controlStatus(runtime,app)};
  if(type==='local-draft'){
    requireParticipant(app.local!==undefined&&app.context.mode==='local','stale_context');
    if(data.token===undefined)return {token:await app.local.draft()};
    requireParticipant(typeof data.token==='string'&&data.token.length<=4096,'validation_error');
    await app.assert();await app.local.saveDraft(data.token);return {};
  }
  if(type==='local-configure'){await runtime.configureLocal(text(data.token),app);return {configured:true};}
  if(type==='local-remove'){requireParticipant(app.local!==undefined,'stale_context');await app.assert();await app.local.remove();return {configured:false};}
  const controls=runtime.controls(app),archives=runtime.archives(app);
  if(type==='storage-repair'){
    requireParticipant(data.kind==='move'||data.kind==='recovery'||data.kind==='local'||data.kind==='restore','validation_error');
    if(data.kind==='restore')return {result:await archives.local.restoreRepair(participantUuid(data.id),text(data.token))};
    return {result:await (data.kind==='local'?controls.repairLocal(participantUuid(data.id),text(data.token)):data.kind==='move'?controls.repairServer(participantUuid(data.id),text(data.token)):archives.recovery.repairServer(app,participantUuid(data.id),text(data.token)))};
  }
  if(type==='storage-candidate')return {candidate:await controls.serverCandidate({url:text(data.url),token:text(data.token)})};
  if(type==='storage-server'){
    const result=await controls.toServer(participantUuid(data.ref),{migrate:flag(data.migrate),acceptMissingDedupEvidence:flag(data.acceptMissingDedupEvidence)},participantUuid(data.id));
    const value=result as {id?:string;plan?:{id:string};phase:string};return {id:value.plan?.id??value.id,phase:value.phase};
  }
  if(type==='storage-browser'){
    const result=await controls.toBrowser(text(data.token),{pauseSharedServer:flag(data.pauseSharedServer),replaceInactiveLocalCopy:flag(data.replaceInactiveLocalCopy)});
    return {id:result.plan.id,phase:result.phase};
  }
  if(type==='storage-retry')return {result:await controls.retry(participantUuid(data.id))};
  if(type==='storage-step')return {result:await controls.step(participantUuid(data.id))};
  if(type==='storage-cancel')return {result:await controls.cancel(participantUuid(data.id),participantUuid(data.requestId))};
  const id=participantUuid(data.id);
  switch(type){
    case 'archive-upload-begin':return {file:await archives.local.uploadBegin(id,number(data.bytes),participantDigest(data.sha256))};
    case 'archive-upload-status':return {file:await archives.local.uploadStatus(id)};
    case 'archive-upload-chunk':return {chunk:await archives.local.uploadChunk(id,participantUuid(data.nonce),index(data.number),bytes(data.base64))};
    case 'archive-upload-seal':return {file:await archives.local.uploadSeal(id)};
    case 'archive-upload-discard':return {result:await archives.local.discardUpload(id)};
    case 'archive-export-begin':return {result:exportKind(data.kind)==='local'?await archives.local.backupBegin(id,participantUuid(data.generation)):await archives.backup.begin(id)};
    case 'archive-export-step':return {result:exportKind(data.kind)==='local'?await archives.local.backupStep(id):await archives.backup.step(id)};
    case 'archive-export-retry':return {result:exportKind(data.kind)==='local'?await archives.local.backupStep(id):await archives.backup.retry(id)};
    case 'archive-export-chunk':return {base64:base64(exportKind(data.kind)==='local'?await archives.local.backupChunk(id,index(data.number)):await archives.backup.chunk(id,index(data.number)))};
    case 'archive-export-ack':return {result:exportKind(data.kind)==='local'?await archives.local.backupAcknowledge(id,participantDigest(data.sha256)):await archives.backup.acknowledge(id,participantDigest(data.sha256))};
    case 'archive-export-cancel':return {result:exportKind(data.kind)==='local'?await archives.local.backupCancel(id):await archives.backup.cancel(id)};
    case 'archive-export-clean':requireParticipant(exportKind(data.kind)==='local','validation_error');return {result:await archives.local.backupClean(id)};
    case 'archive-import-begin':{
      const consent={formerWritersRetired:flag(data.formerWritersRetired),acceptPostSnapshotEvidenceLoss:flag(data.acceptPostSnapshotEvidenceLoss),replaceInactiveLocalCopy:flag(data.replaceInactiveLocalCopy)};
      return {result:importTarget(data.target)==='server'?await archives.recovery.begin(app,id,consent):await archives.local.restoreBegin(id,data.token==null?null:text(data.token),consent)};
    }
    case 'archive-import-step':return {result:importTarget(data.target)==='server'?await archives.recovery.step(id):await archives.local.restoreStep(id)};
    case 'archive-import-accept':return {result:importTarget(data.target)==='server'?await archives.recovery.accept(id,participantUuid(data.previewId)):await archives.local.restoreAccept(id,participantUuid(data.previewId))};
    case 'archive-import-cancel':return {result:importTarget(data.target)==='server'?await archives.recovery.cancel(id):await archives.local.restoreCancel(id)};
    case 'archive-import-retry':return {result:importTarget(data.target)==='server'?await archives.recovery.retry(id,flag(data.refreshPreview)):await archives.local.restorePreview(id)};
    case 'archive-import-clean':requireParticipant(importTarget(data.target)==='browser','validation_error');return {result:await archives.local.restoreClean(id)};
    default:throw new SyncError('unsupported_command');
  }
}
