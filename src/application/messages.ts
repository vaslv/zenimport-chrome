/** Privileged message metadata; bank data continues through connector validation. */
import {SyncError} from '../../extension/backend-client.js';
import type {ApplicationContext} from './service.js';
const popup=new Set(['status','configure','inspect','select-bank-connection','create-bank-connection','rename-bank-connection','unlink-bank-account',
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
