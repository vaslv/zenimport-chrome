/** Internal transaction owner for named local repositories, never a UI service. */
import Dexie from 'dexie';
import type {ContextFence,DatasetSentinel,SentinelPort} from '../../control/types.js';
import {runtimeControl,datasetControl} from '../../control/validation.js';
import {FinancialDatabase} from './database.js';
import {readAnchor,assertAnchor} from './anchor.js';
import {participantControl} from './participant-validation.js';
import {RepositorySession,writeTransaction} from './kernel.js';
import {mirrorScope} from './mirror-scope.js';
import {requireStorage} from './types.js';
import {CaptureError} from '../capture/errors.js';

export class RepositoryOwner{
  private constructor(private db:FinancialDatabase,private sentinel:SentinelPort,readonly fence:ContextFence){}
  static async open(name:string,sentinel:SentinelPort,fence:ContextFence,allowSettings=false){
    const db=new FinancialDatabase(name,false);try{await db.open();const owner=new RepositoryOwner(db,sentinel,{...fence}),marker=await readAnchor(sentinel,fence.installationId);await db.transaction('r',db.tables,()=>owner.#context(marker,allowSettings));return owner;}
    catch(error){db.close();throw error;}
  }
  async #context(marker:DatasetSentinel,allowSettings=false){
      const root=runtimeControl(await assertAnchor(this.db,marker)),fence=this.fence;
      requireStorage(root.activeMode==='local'&&root.activeGeneration===fence.generation&&root.epoch===fence.epoch&&root.pendingSwitchId===null,'stale_epoch');
      const dataset=datasetControl(await this.db.datasets.get(fence.generation)),participant=participantControl(await this.db.participants.get(dataset.participantId));
      requireStorage(dataset.lifecycle==='active'&&participant.state==='active'&&participant.generation===dataset.generation&&participant.epoch===dataset.participantEpoch,'dataset_not_writable');
      if(dataset.holdId!==null){
        const op=(await this.db.applicationState.get('account-settings:'+dataset.holdId))?.value;
        requireStorage(allowSettings&&op?.kind==='account-settings'&&op.id===dataset.holdId&&op.generation===fence.generation&&['check','invalidate','intervals','jobs','coverage','finish'].includes(op.phase as string),'dataset_not_writable');
      }
  }
  async read<T>(operation:(view:RepositorySession)=>Promise<T>){
    const marker=await readAnchor(this.sentinel,this.fence.installationId);
    return this.db.transaction('r',this.db.tables,async()=>{
      await this.#context(marker);const fence=this.fence;
      const view=new RepositorySession(this.db,fence.generation,Dexie.currentTransaction!,await mirrorScope(this.db,fence.generation));
      try{return await operation(view);}finally{view.close();}
    });
  }
  async write<T>(operation:(view:RepositorySession)=>Promise<T>){
    let rejection:CaptureError|undefined;
    try{return await writeTransaction(this.db,this.sentinel,this.fence,async view=>{
      try{return await operation(view);}catch(error){if(error instanceof CaptureError)rejection=error;throw error;}
    });}catch(error){throw rejection??error;}
  }
  /** A business failure may intentionally commit its paused/failed evidence. */
  async command<T>(operation:(view:RepositorySession)=>Promise<T>):Promise<T>{
    const result=await this.write(async view=>{
      try{return {ok:true as const,value:await operation(view)};}
      catch(error){if(error instanceof CaptureError&&error.persist)return {ok:false as const,error};throw error;}
    });
    if(!result.ok)throw result.error;return result.value;
  }
  close(){this.db.close();}
}
