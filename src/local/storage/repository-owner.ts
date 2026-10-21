/** Internal transaction owner for named local repositories, never a UI service. */
import Dexie from 'dexie';
import type {ContextFence,SentinelPort} from '../../control/types.js';
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
  static async open(name:string,sentinel:SentinelPort,fence:ContextFence){
    const db=new FinancialDatabase(name,false);try{await db.open();const owner=new RepositoryOwner(db,sentinel,{...fence});await owner.read(async()=>{});return owner;}
    catch(error){db.close();throw error;}
  }
  async read<T>(operation:(view:RepositorySession)=>Promise<T>){
    const marker=await readAnchor(this.sentinel,this.fence.installationId);
    return this.db.transaction('r',this.db.tables,async()=>{
      const root=runtimeControl(await assertAnchor(this.db,marker)),fence=this.fence;
      requireStorage(root.activeMode==='local'&&root.activeGeneration===fence.generation&&root.epoch===fence.epoch&&root.pendingSwitchId===null,'stale_epoch');
      const dataset=datasetControl(await this.db.datasets.get(fence.generation)),participant=participantControl(await this.db.participants.get(dataset.participantId));
      requireStorage(dataset.lifecycle==='active'&&dataset.holdId===null&&participant.state==='active'&&participant.generation===dataset.generation&&participant.epoch===dataset.participantEpoch,'dataset_not_writable');
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
  close(){this.db.close();}
}
