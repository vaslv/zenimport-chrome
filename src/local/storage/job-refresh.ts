/** Private status sweep, committed together with changes to delivery evidence. */
import type {FinancialDatabase} from './database.js';
import {requireStorage} from './types.js';
export interface JobRefresh{id:string;after:string|null}
export const jobRefreshScope=(generation:string)=>'delivery-job-refresh:'+generation;
export async function markJobRefresh(db:FinancialDatabase,generation:string){
  await db.applicationState.put({scope:jobRefreshScope(generation),value:{id:crypto.randomUUID(),after:null}});
}
export async function readJobRefresh(db:FinancialDatabase,generation:string):Promise<JobRefresh|null>{
  const value=(await db.applicationState.get(jobRefreshScope(generation)))?.value;
  if(value===undefined)return null;
  requireStorage(value!==null&&typeof value==='object'&&Object.keys(value).sort().join(',')==='after,id'&&typeof value.id==='string'&&/^[0-9a-f-]{36}$/.test(value.id)&&(value.after===null||typeof value.after==='string'),'storage_corrupt');
  return value as unknown as JobRefresh;
}
