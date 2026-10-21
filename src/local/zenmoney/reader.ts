/** Privileged read-only SDK gateway. No write-capable client escapes this module. */
import {ZenMoneyClient,FORCE_FETCH} from 'zenmoney-typescript';
import type {Diff} from 'zenmoney-typescript';
import {LocalZenMoneyError,zenmoneyFailure} from './errors.js';
export const ZENMONEY_ORIGIN='https://api.zenmoney.ru/*';
export interface ReaderOptions{fetch?:typeof fetch;permission():Promise<boolean>;clock?:()=>number;timeoutMs?:number;maxResponseBytes?:number}
export interface MirrorReader{permission():Promise<boolean>;read(token:string,cursor:string,full:boolean,transactions?:boolean):Promise<Diff>}
export function mirrorReader(options:ReaderOptions):MirrorReader{
  const permission=async()=>{try{return await options.permission()===true;}catch{return false;}};
  return {permission,async read(token,cursor,full,transactions=false){
    if(!await permission())throw new LocalZenMoneyError('zenmoney_permission');
    let client:ZenMoneyClient|undefined;
    try{
      client=new ZenMoneyClient({token,...(options.fetch?{fetch:options.fetch}:{}),clock:options.clock,
        timeoutMs:options.timeoutMs??20000,maxResponseBytes:options.maxResponseBytes??32*1024*1024});
      const diff=await client.readDiff({serverTimestamp:BigInt(cursor),...(full?{forceFetch:FORCE_FETCH}:transactions?{forceFetch:['transaction'] as const}:{})});
      if(!await permission())throw new LocalZenMoneyError('zenmoney_permission');
      return diff;
    }catch(error){if(!await permission())throw new LocalZenMoneyError('zenmoney_permission');throw zenmoneyFailure(error);}finally{client?.close();}
  }};
}
