/** The only privileged local financial SDK gateway; it never retries a write. */
import {ZenMoneyClient,decodeJson} from 'zenmoney-typescript';
import type {JsonObject} from 'zenmoney-typescript';
import type {LocalCredentials} from '../zenmoney/credentials.js';
import type {MirrorRepository} from '../storage/mirror-repository.js';
import type {OutboxRepository} from '../storage/outbox-repository.js';
import {LocalZenMoneyError,zenmoneyFailure} from '../zenmoney/errors.js';
import {DeliveryError} from './errors.js';
import {requireStorage} from '../storage/types.js';
export interface SenderOptions{permission():Promise<boolean>;fetch?:typeof fetch;clock:()=>number;timeoutMs?:number;maxResponseBytes?:number}
export class DeliverySender{
  constructor(private outbox:OutboxRepository,private mirror:MirrorRepository,private credentials:LocalCredentials,private options:SenderOptions){}
  async send(id:string){
    const batch=await this.outbox.status();
    if(!batch||batch.id!==id||batch.phase!=='prepared')throw new DeliveryError('delivery_unknown');
    const credential=await this.credentials.current();
    requireStorage(credential.root.credentialEpoch===batch.source.credentialEpoch&&credential.root.credentialRef===batch.source.credentialRef,'stale_epoch');
    const permission=async()=>{try{return await this.options.permission()===true;}catch{return false;}};
    let fenceError:unknown,client:ZenMoneyClient|undefined,ownsDispatch=false;
    try{
      if(!await permission())throw new LocalZenMoneyError('zenmoney_permission');
      client=new ZenMoneyClient({token:credential.token,clock:()=>Math.floor(this.options.clock()),timeoutMs:this.options.timeoutMs??20000,maxResponseBytes:this.options.maxResponseBytes??32*1024*1024,
        fetch:async(input,options)=>{
          try{
            if(!await permission())throw new LocalZenMoneyError('zenmoney_permission');
            const granted=await this.outbox.dispatch(id,String(Math.floor(this.options.clock())));ownsDispatch=true;
            // No asynchronous work may separate this final native grant/check
            // from fetch. The SDK's abort can fire while the grant is pending.
            if(options?.signal?.aborted||BigInt(Math.floor(this.options.clock()))>=BigInt(granted.deadline))throw new DeliveryError('delivery_unknown');
            return (this.options.fetch??globalThis.fetch)(input,options);
          }catch(error){fenceError=error;throw error;}
        }});
      const response=await client.upsert('transaction',batch.items.map(item=>decodeJson(item.payload) as JsonObject),{serverTimestamp:BigInt(JSON.parse(batch.source.mirror).cursor)});
      if(!await permission())throw new LocalZenMoneyError('zenmoney_permission');
      await this.mirror.applyDelivery(credential.root,id,response.rawJson,String(Math.floor(this.options.clock())));
      return {outcome:'response_applied' as const,error:null};
    }catch(error){
      // A partial 400, timeout or lost reply never proves non-creation. Even a
      // failed pre-dispatch grant retains its immutable UUID for verification.
      const failure=fenceError??error;
      const current=await this.outbox.status();
      if(ownsDispatch&&current?.id===id&&current.phase!=='settled')await this.outbox.finish(id,'write_outcome_unknown',String(Math.floor(this.options.clock())));
      if(['stale_epoch','dataset_not_writable','quota_exceeded','recovery_required','storage_corrupt'].includes((failure as {code?:string})?.code??''))throw failure;
      return {outcome:'write_outcome_unknown' as const,error:zenmoneyFailure(failure).code};
    }finally{client?.close();}
  }
}
