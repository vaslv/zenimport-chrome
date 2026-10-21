/** Imported setup is bounded to identity-confirmed metadata, never delivery. */
import type {FinancialDatabase} from './database.js';
import type {RuntimeControl} from '../../control/types.js';
import {int64,requireStorage} from './types.js';
import {unpackRow} from './cells.js';
export const setupScope=(generation:string)=>'local-import-setup:'+generation;
export async function assertSetup(db:FinancialDatabase,root:RuntimeControl,allowExpired=false,now=Math.floor(Date.now()/1000)){
  const generation=root.activeGeneration!,permit=(await db.applicationState.get(setupScope(generation)))?.value;
  requireStorage(permit!==undefined&&permit.generation===generation&&permit.epoch===root.epoch&&permit.credentialEpoch===root.credentialEpoch&&permit.credentialRef===root.credentialRef&&root.credentialRef!==null,'dataset_not_writable');
  const control=(await db.applicationState.get('mirror:'+generation))?.value;
  requireStorage(control!==undefined&&control.forceFull===false&&control.lease===null&&typeof permit.mirror==='string','dataset_not_writable');
  const envelope=await db.financial('zen_mirror_state').where('generation').equals(generation).first();
  requireStorage(envelope!==undefined,'storage_corrupt');
  // Decode through the same strict generated row codec as ordinary repositories.
  const state=unpackRow('zen_mirror_state',envelope.row);
  requireStorage(JSON.stringify(state)===permit.mirror&&state.ready==='1'&&state.needs_full==='0'&&state.refreshed_at!==null&&
    (allowExpired||BigInt(int64(String(now)))>=BigInt(state.refreshed_at)&&BigInt(now)-BigInt(state.refreshed_at)<=300n),'dataset_not_writable');
}
