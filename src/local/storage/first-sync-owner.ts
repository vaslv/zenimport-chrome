/** Only an explicit sync can release imported delivery; setup has a lesser permit. */
import type {SentinelPort,RuntimeControl} from '../../control/types.js';
import {runtimeControl,datasetControl} from '../../control/validation.js';
import {participantUuid} from '../../control/participant-wire.js';
import {FinancialDatabase} from './database.js';
import {readAnchor,assertAnchor} from './anchor.js';
import {participantControl} from './participant-validation.js';
import {RepositorySession} from './kernel.js';
import {mirrorScope} from './mirror-scope.js';
import {mirrorFresh} from '../reconciliation/freshness.js';
import {int64,requireStorage} from './types.js';
import {setupScope,assertSetup} from './setup-permit.js';
import Dexie from 'dexie';
export interface SetupCredential{ownerIds:readonly string[];sourceHash:string}
export class FirstSyncOwner{
  private constructor(private db:FinancialDatabase,private sentinel:SentinelPort,private credential:(ref:string)=>Promise<SetupCredential>,private clock:()=>number,private bound?:RuntimeControl){}
  static async open(name:string,sentinel:SentinelPort,credential:(ref:string)=>Promise<SetupCredential>,clock=()=>Date.now()/1000,bound?:RuntimeControl){
    const marker=await readAnchor(sentinel),db=new FinancialDatabase(name,false);try{await db.open();await db.transaction('r',db.runtime,db.datasets,()=>assertAnchor(db,marker));return new FirstSyncOwner(db,sentinel,credential,clock,bound?{...bound}:undefined);}catch(error){db.close();throw error;}
  }
  async #context(){
    const marker=await readAnchor(this.sentinel);return this.db.transaction('r',this.db.tables,async()=>{
      const root=runtimeControl(await assertAnchor(this.db,marker));requireStorage(root.activeMode==='local'&&root.activeGeneration!==null&&root.pendingSwitchId===null,'dataset_not_writable');
      requireStorage(!this.bound||(!this.bound.financialMayHaveStarted||root.financialMayHaveStarted)&&JSON.stringify({...root,financialMayHaveStarted:this.bound.financialMayHaveStarted})===JSON.stringify(this.bound),'stale_epoch');
      const dataset=datasetControl(await this.db.datasets.get(root.activeGeneration)),participant=participantControl(await this.db.participants.get(dataset.participantId));
      requireStorage(dataset.lifecycle==='active'&&dataset.holdId===null&&participant.state==='active'&&participant.generation===dataset.generation&&participant.epoch===dataset.participantEpoch,'dataset_not_writable');
      return {root,dataset,participant};
    });
  }
  async status(){const {participant}=await this.#context();return {awaitingSync:participant.awaitingSync};}
  async prepare(){
    const before=await this.#context();if(!before.participant.awaitingSync)return {prepared:false};
    requireStorage(before.root.credentialRef!==null,'dataset_not_writable');const proof=await this.credential(before.root.credentialRef),marker=await readAnchor(this.sentinel);
    return this.db.transaction('rw',this.db.tables,async()=>{
      const root=runtimeControl(await assertAnchor(this.db,marker));requireStorage(JSON.stringify({...root,financialMayHaveStarted:before.root.financialMayHaveStarted})===JSON.stringify(before.root),'stale_epoch');
      const dataset=datasetControl(await this.db.datasets.get(root.activeGeneration!)),participant=participantControl(await this.db.participants.get(dataset.participantId));
      requireStorage(dataset.holdId===null&&participant.awaitingSync&&participant.state==='active'&&participant.epoch===dataset.participantEpoch&&JSON.stringify(proof.ownerIds)===JSON.stringify(dataset.ownerIds),'dataset_not_writable');
      const view=new RepositorySession(this.db,dataset.generation,Dexie.currentTransaction!,await mirrorScope(this.db,dataset.generation));
      try{
        const state=await view.get('zen_mirror_state',[['integer',int64('1')]]),control=(await this.db.applicationState.get('mirror:'+dataset.generation))?.value??null;
        requireStorage(state?.source_hash===proof.sourceHash&&mirrorFresh(state??undefined,{credentialRef:root.credentialRef,mirrorControl:JSON.stringify(control)},String(Math.floor(this.clock()))),'dataset_not_writable');
        await this.db.applicationState.put({scope:setupScope(dataset.generation),value:{generation:dataset.generation,epoch:root.epoch,credentialEpoch:root.credentialEpoch,credentialRef:root.credentialRef,mirror:JSON.stringify(state)}});
        return {prepared:true};
      }finally{view.close();}
    });
  }
  async acknowledge(requestId:string){
    participantUuid(requestId);await this.prepare();const before=await this.#context(),marker=await readAnchor(this.sentinel);
    if(!before.participant.awaitingSync)return {released:false};
    return this.db.transaction('rw',this.db.tables,async()=>{
      const root=runtimeControl(await assertAnchor(this.db,marker));requireStorage(JSON.stringify(root)===JSON.stringify(before.root),'stale_epoch');
      const dataset=datasetControl(await this.db.datasets.get(root.activeGeneration!)),participant=participantControl(await this.db.participants.get(dataset.participantId));
      requireStorage(dataset.holdId===null&&participant.state==='active'&&participant.awaitingSync&&participant.epoch===dataset.participantEpoch,'dataset_not_writable');
      await assertSetup(this.db,root,false,Math.floor(this.clock()));
      await this.db.participants.put({...participant,awaitingSync:false});
      await this.db.applicationState.put({scope:'local-first-sync:'+dataset.generation,value:{requestId,at:String(Math.floor(this.clock())),epoch:root.epoch,credentialEpoch:root.credentialEpoch}});
      return {released:true};
    });
  }
  close(){this.db.close();}
}
