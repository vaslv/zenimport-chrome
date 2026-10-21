/** Scoped UI requests and stale response rejection; contains no credentials. */
import {SyncError} from '../../extension/backend-client.js';
import type {ApplicationContext} from './service.js';
export function createRpc(send:(data:Record<string,unknown>)=>Promise<Record<string,unknown>|undefined>){
  let selected:Omit<ApplicationContext,'operation_id'>|undefined;
  const scope=(value:ApplicationContext)=>({dataset_id:value.dataset_id,generation:value.generation,mode:value.mode,
    mode_epoch:value.mode_epoch,credential_epoch:value.credential_epoch});
  return async(data:Record<string,unknown>)=>{
    const operation_id=crypto.randomUUID(),snapshot=selected;
    const response=await send({...data,operation_id,...(data.type!=='status'&&snapshot?{context:snapshot}:{})});
    if(!response?.ok)throw new SyncError(typeof response?.error==='string'?response.error:'backend_unavailable');
    const context=response.context as ApplicationContext|undefined;
    if(context){
      if(context.operation_id!==operation_id)throw new SyncError('stale_context');
      const next=scope(context);
      if(data.type!=='configure'&&snapshot&&JSON.stringify(next)!==JSON.stringify(snapshot))throw new SyncError('stale_context');
      if(selected&&snapshot&&JSON.stringify(selected)!==JSON.stringify(snapshot))throw new SyncError('stale_context');
      selected=next;
    }else if(data.type==='status')selected=undefined;
    return response;
  };
}
