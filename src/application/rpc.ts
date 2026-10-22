/** Scoped UI requests and stale response rejection; contains no credentials. */
import {adoptsControlContext} from './control-messages.js';
import {SyncError} from '../../extension/backend-client.js';
import type {ApplicationContext} from './service.js';
export function createRpc(send:(data:Record<string,unknown>)=>Promise<Record<string,unknown>|undefined>){
  let selected:Omit<ApplicationContext,'operation_id'>|undefined,revision=0;
  const scope=(value:ApplicationContext)=>({dataset_id:value.dataset_id,generation:value.generation,mode:value.mode,
    mode_epoch:value.mode_epoch,credential_epoch:value.credential_epoch});
  return async(data:Record<string,unknown>)=>{
    const operation_id=crypto.randomUUID(),snapshot=selected,started=revision;
    const response=await send({...data,operation_id,...(data.type!=='status'&&snapshot?{context:snapshot}:{})});
    if(started!==revision)throw new SyncError('stale_context');
    if(!response?.ok)throw new SyncError(typeof response?.error==='string'?response.error:'backend_unavailable');
    const context=response.context as ApplicationContext|undefined;
    if(context){
      if(context.operation_id!==operation_id)throw new SyncError('stale_context');
      const next=scope(context);
      if(!adoptsControlContext.has(data.type as string)&&snapshot&&JSON.stringify(next)!==JSON.stringify(snapshot))throw new SyncError('stale_context');
      if(JSON.stringify(next)!==JSON.stringify(selected)){selected=next;revision++;}
    }else if(data.type==='status'&&selected!==undefined){selected=undefined;revision++;}
    return response;
  };
}
