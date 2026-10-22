/** Privileged message metadata; bank data continues through connector validation. */
import {controlCommands,controlFields} from './control-messages.js';
import {SyncError} from '../../extension/backend-client.js';
import type {ApplicationContext} from './service.js';
const popup=new Set([...controlCommands,'status','configure','inspect','select-bank-connection','create-bank-connection','rename-bank-connection','unlink-bank-account',
  'catalog','settings','reimport','start','stop','open-discrepancies','migration-status','migration-prepare-export','migration-imported','migration-resume']);
const capture=new Set(['capture-check','capture-page','capture-complete','capture-next','capture-error']);
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export function message(value:unknown,kind:'popup'|'report'|'capture'):Record<string,unknown>{
  const fail=()=>{throw new SyncError('validation_error');};
  if(value===null||typeof value!=='object'||Array.isArray(value))fail();
  const data=value as Record<string,unknown>;
  if(typeof data.type!=='string')fail();
  if(!(kind==='popup'?popup:kind==='capture'?capture:new Set(['discrepancies'])).has(data.type as string))throw new SyncError('unauthorized');
  if(data.operation_id!==undefined&&!uuid(data.operation_id))fail();
  if(data.context!==undefined){
    if(data.context===null||typeof data.context!=='object'||Array.isArray(data.context))fail();
    const context=data.context as Record<string,unknown>;
    const keys=['dataset_id','generation','mode','mode_epoch','credential_epoch'];
    if(Object.keys(context).length!==keys.length||!keys.every(key=>Object.hasOwn(context,key))||!uuid(context.dataset_id)||!uuid(context.generation)||
      !['local','remote'].includes(context.mode as string)||!['mode_epoch','credential_epoch'].every(key=>typeof context[key]==='string'&&/^[1-9][0-9]{0,18}$/.test(context[key] as string)))fail();
  }
  if(controlCommands.has(data.type as string)){
    const allowed=new Set(['type','operation_id','context',...controlFields[data.type as string]]);
    if(Object.keys(data).some(key=>!allowed.has(key)))fail();
    if(!uuid(data.operation_id))fail();
    if(!['storage-status','archive-status'].includes(data.type as string)&&data.context===undefined)throw new SyncError('stale_context');
    for(const field of ['id','ref','generation','nonce','previewId','requestId'])if(data[field]!==undefined&&!uuid(data[field]))fail();
    if(data.token!==undefined&&data.token!==null&&(typeof data.token!=='string'||data.token.length>4096))fail();
    if(data.url!==undefined&&(typeof data.url!=='string'||data.url.length>4096))fail();
    for(const field of ['migrate','acceptMissingDedupEvidence','pauseSharedServer','replaceInactiveLocalCopy','formerWritersRetired','acceptPostSnapshotEvidenceLoss','refreshPreview'])if(data[field]!==undefined&&typeof data[field]!=='boolean')fail();
    if(data.base64!==undefined&&(typeof data.base64!=='string'||data.base64.length>349528))fail();
    if(data.number!==undefined&&(!Number.isSafeInteger(data.number)||Number(data.number)<0||Number(data.number)>255))fail();
    if(data.bytes!==undefined&&(!Number.isSafeInteger(data.bytes)||Number(data.bytes)<1||Number(data.bytes)>67108864))fail();
  }
  if(data.type==='configure'&&(typeof data.url!=='string'||typeof data.token!=='string'))fail();
  for(const field of ['connectionId','accountId','profileKey','label','date','from_date','to_date','account_id','runId','account','code','stage'])
    if(data[field]!==undefined&&(typeof data[field]!=='string'||(data[field] as string).length>4096))fail();
  if(data.refresh!==undefined&&typeof data.refresh!=='boolean')fail();
  if(data.type==='settings'&&(data.settings===null||typeof data.settings!=='object'||Array.isArray(data.settings)))fail();
  return data;
}
export function assertMessageContext(expected:unknown,current:ApplicationContext|null){
  if(expected===undefined)return;
  if(current===null||!Object.entries(expected as Record<string,unknown>).every(([key,value])=>current[key as keyof ApplicationContext]===value))throw new SyncError('stale_context');
}
