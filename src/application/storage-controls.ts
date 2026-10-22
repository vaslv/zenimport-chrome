/** Explicit trusted storage decisions. A candidate never selects its own writer. */
import {ModeTransfers} from '../local/migration/controller.js';
import type {ResolvedApplication} from './runtime.js';
import type {LocalOptions} from './local-service.js';
import type {StorageArea} from './state.js';
import type {SentinelPort} from '../control/types.js';
import {mirrorReader} from '../local/zenmoney/reader.js';
import {SyncError} from '../../extension/backend-client.js';

export interface StorageControlOptions extends LocalOptions{
  name:string;sentinel:SentinelPort;persistent:StorageArea;serverPermission(url:string):Promise<boolean>;
  verifyServer(config:{url:string;token:string}):Promise<unknown>;
}
export class StorageControls{
  constructor(private options:StorageControlOptions,private app:ResolvedApplication){}
  async #unit<T>(work:(owner:ModeTransfers)=>Promise<T>){
    const owner=await ModeTransfers.open({...this.options,reader:mirrorReader(this.options),expectedRoot:this.app.root});
    try{return await work(owner);}finally{owner.close();}
  }
  async status(){
    await this.app.assert(true);
    const result=await this.#unit(async owner=>{
      const journal=await owner.current(),join=await owner.joinCurrent();
      return {mode:this.app.context.mode,pending:this.app.root.pendingSwitchId!==null||await owner.pending(),
        transfer:journal?{id:journal.plan.id,direction:journal.plan.direction,phase:journal.phase,error:journal.error,finishingRepair:await owner.pendingRepair(journal.plan.id),
          serverUrl:['complete','cancelled'].includes(journal.phase)?null:(await owner.serverCredentials.read(journal.plan.remoteCredentialRef)).url,canCancel:!['complete','cancelled'].includes(journal.phase)&&!journal.receipts.some(value=>value.command==='source_handoff')}:null,
        join:join?{id:join.id,phase:join.phase}:null};
    });
    await this.app.assert(true);return result;
  }
  async #verifyServer(config:{url:string;token:string}){
    const info=await this.options.verifyServer(config);
    if((info as {context_fencing?:number})?.context_fencing!==1)throw new SyncError('unsupported_api_version');
  }
  async serverCandidate(config:{url:string;token:string}){
    await this.app.assert();await this.#verifyServer(config);const candidate=await this.#unit(owner=>owner.serverCredentials.verify(config));
    await this.app.assert();return {ref:candidate.ref,identity:candidate.identity};
  }
  async toServer(ref:string,options:{migrate:boolean;acceptMissingDedupEvidence:boolean},requestId:string){
    await this.app.assert();
    if(this.app.context.mode!=='local')throw new SyncError('migration_required');
    return this.#unit<unknown>(async owner=>{
      await this.#verifyServer(await owner.serverCredentials.read(ref));await this.app.assert();
      return options.migrate?owner.toServer(ref):owner.joinServer(requestId,ref,{
        retainLocalCopy:true,withoutImport:true,acceptMissingDedupEvidence:options.acceptMissingDedupEvidence,
      });
    });
  }
  async toBrowser(token:string,consent:{pauseSharedServer:boolean;replaceInactiveLocalCopy:boolean}){
    await this.app.assert();
    if(this.app.context.mode!=='remote')throw new SyncError('migration_required');
    return this.#unit(async owner=>{
      const candidate=await owner.localCredentials.verifyToken(token);await this.app.assert();
      return owner.toBrowser(candidate.ref,consent);
    });
  }
  async repairLocal(id:string,token:string){await this.app.assert(true);return this.#unit(owner=>owner.repairLocal(id,token));}
  async repairServer(id:string,token:string){await this.app.assert(true);return this.#unit(owner=>owner.repairServer(id,token));}
  async retry(id:string){await this.app.assert(true);return this.#unit(owner=>owner.retry(id));}
  async step(id:string){await this.app.assert(true);return this.#unit(owner=>owner.run(id));}
  async cancel(id:string,requestId:string){
    await this.app.assert(true);return this.#unit(async owner=>{
      const join=await owner.joinCurrent();
      if(join?.id===id)return owner.cancelJoin(id);
      return owner.cancel(id,requestId);
    });
  }
}
