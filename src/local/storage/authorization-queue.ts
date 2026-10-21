/** Private work queue; portable capture/authorization rows remain financial proof. */
import type {FinancialDatabase} from './database.js';
import {int64,requireStorage} from './types.js';
export interface AuthorizationTask{id:string;jobId:string;at:string}
export const authorizationPrefix=(generation:string)=>'authorize-job:'+generation+':';
export function authorizationTask(input:unknown):AuthorizationTask{
  requireStorage(input!==null&&typeof input==='object'&&!Array.isArray(input),'storage_corrupt');const task=input as AuthorizationTask;
  const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
  requireStorage(Object.keys(task).sort().join(',')==='at,id,jobId'&&uuid(task.id)&&uuid(task.jobId)&&typeof task.at==='string','storage_corrupt');
  try{requireStorage(BigInt(int64(task.at))>=0n,'storage_corrupt');}catch{requireStorage(false,'storage_corrupt');}return task;
}
export async function queueAuthorization(db:FinancialDatabase,generation:string,jobId:string,now:string){
  const task=authorizationTask({id:crypto.randomUUID(),jobId,at:now});
  await db.applicationState.put({scope:authorizationPrefix(generation)+jobId,value:{...task}});
}
export async function pendingAuthorizations(db:FinancialDatabase,generation:string){
  const prefix=authorizationPrefix(generation),rows=await db.applicationState.where('scope').startsWith(prefix).limit(20).toArray();
  return rows.map(row=>{const task=authorizationTask(row.value);requireStorage(row.scope===prefix+task.jobId,'storage_corrupt');return task;});
}
export async function acknowledgeAuthorization(db:FinancialDatabase,generation:string,task:AuthorizationTask){
  const scope=authorizationPrefix(generation)+task.jobId,row=await db.applicationState.get(scope);
  if(!row)return false;const current=authorizationTask(row.value);
  if(current.id!==task.id)return false;requireStorage(current.jobId===task.jobId&&current.at===task.at,'storage_corrupt');await db.applicationState.delete(scope);return true;
}
