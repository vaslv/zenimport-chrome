/** Root owner for upgrading configured remote profiles without a local writer. */
import Dexie from 'dexie';
import type {RuntimeControl,SentinelPort} from '../../control/types.js';
import {runtimeControl} from '../../control/validation.js';
import {participantUuid} from '../../control/participant-wire.js';
import {FinancialDatabase} from './database.js';
import {serializeOpen} from './bootstrap-lock.js';
import {assertAnchor,readAnchor} from './anchor.js';
import {int64,requireStorage,storageFailure} from './types.js';

const same=(a:RuntimeControl,b:RuntimeControl)=>Object.keys(a).every(key=>a[key as keyof RuntimeControl]===b[key as keyof RuntimeControl]);
export interface RemoteDescriptor{url:string;contextId:string;legacy:boolean;installationId?:string;datasetId?:string}
export class RemoteControl{
  private constructor(private db:FinancialDatabase,private port:SentinelPort){}
  static async exists(name:string,port:SentinelPort){return await port.read()!==null||await Dexie.exists(name);}
  static async open(name:string,port:SentinelPort,initialCredentialRef?:string,initialContext?:RemoteDescriptor){
    return serializeOpen(name,async()=>{
      let marker=await port.read();const exists=await Dexie.exists(name),creating=marker===null&&!exists;
      if(creating){
        requireStorage(initialCredentialRef!==undefined&&initialContext!==undefined,'recovery_required');participantUuid(initialCredentialRef);participantUuid(initialContext.contextId);
        marker={version:'1',installationId:crypto.randomUUID(),datasetId:crypto.randomUUID(),generation:crypto.randomUUID(),state:'initializing',financialMayHaveStarted:false};
        await port.create(marker);
      }else requireStorage(marker!==null&&marker.state==='ready'&&exists,'recovery_required');
      const db=new FinancialDatabase(name,creating);
      try{
        await db.open();
        if(creating){
          const participantId=crypto.randomUUID(),stamp=int64(String(Math.floor(Date.now()/1000)));
          await db.transaction('rw',db.tables,async()=>{
            requireStorage(await db.runtime.count()===0&&await db.datasets.count()===0,'storage_corrupt');
            await db.runtime.add(runtimeControl({id:'runtime',installationId:marker!.installationId,activeMode:'remote',activeGeneration:null,
              epoch:'1',pendingSwitchId:null,credentialRef:initialCredentialRef!,credentialEpoch:'1',financialMayHaveStarted:false}));
            await db.datasets.add({generation:marker!.generation,datasetId:marker!.datasetId,participantId,participantEpoch:int64('1'),
              logicalSchemaVersion:'1',lifecycle:'retired',ownerIds:[],holdId:null,createdAt:stamp,backupAcknowledgedAt:null});
            await db.participants.add({id:participantId,generation:marker!.generation,epoch:'1',state:'active',operationId:null,everActivated:false,awaitingSync:false});
            await db.remoteContexts.add({id:initialCredentialRef!,...initialContext!});
          });
          await port.acknowledgeReady({...marker!,state:'ready'});
        }
        const anchor=await readAnchor(port);await db.transaction('r',db.runtime,db.datasets,()=>assertAnchor(db,anchor));
        return new RemoteControl(db,port);
      }catch(error){db.close();throw storageFailure(error);}
    });
  }
  async read(){
    const marker=await readAnchor(this.port);return this.db.transaction('r',this.db.runtime,this.db.datasets,()=>assertAnchor(this.db,marker));
  }
  async selectCredential(expected:RuntimeControl,ref:string,switchDataset:boolean,context:RemoteDescriptor){
    participantUuid(ref);const anchor=await readAnchor(this.port);
    return this.db.transaction('rw',this.db.runtime,this.db.datasets,this.db.remoteContexts,async()=>{
      const current=await assertAnchor(this.db,anchor);
      requireStorage(same(current,expected)&&current.activeMode==='remote'&&current.pendingSwitchId===null,'stale_epoch');
      const next=runtimeControl({...current,credentialRef:ref,credentialEpoch:int64(String(BigInt(current.credentialEpoch)+1n)),
        epoch:switchDataset?int64(String(BigInt(current.epoch)+1n)):current.epoch});
      await this.db.remoteContexts.add({id:ref,...context});await this.db.runtime.put(next);return next;
    });
  }
  /** Strengthen an old selected context after fresh authenticated discovery. */
  async bindIdentity(expected:RuntimeControl,installationId:string,datasetId:string){
    participantUuid(installationId);participantUuid(datasetId);const anchor=await readAnchor(this.port);
    return this.db.transaction('rw',this.db.runtime,this.db.datasets,this.db.remoteContexts,async()=>{
      const current=await assertAnchor(this.db,anchor);requireStorage(same(current,expected)&&current.activeMode==='remote'&&current.pendingSwitchId===null&&current.credentialRef!==null,'stale_epoch');
      const context=await this.db.remoteContexts.get(current.credentialRef);requireStorage(context!==undefined,'recovery_required');
      requireStorage(context.installationId===undefined&&context.datasetId===undefined||context.installationId===installationId&&context.datasetId===datasetId,'stale_epoch');
      const bound={...context,installationId,datasetId};await this.db.remoteContexts.put(bound);return bound;
    });
  }
  async remoteContext(expected:RuntimeControl){
    const anchor=await readAnchor(this.port);
    return this.db.transaction('r',this.db.runtime,this.db.datasets,this.db.remoteContexts,async()=>{
      const current=await assertAnchor(this.db,anchor);requireStorage(same(current,expected)&&current.credentialRef!==null,'stale_epoch');
      const context=await this.db.remoteContexts.get(current.credentialRef);requireStorage(context!==undefined,'recovery_required');return context;
    });
  }
  async readState(expected:RuntimeControl,scope:string){
    participantUuid(scope);const anchor=await readAnchor(this.port);
    return this.db.transaction('r',this.db.runtime,this.db.datasets,this.db.applicationState,async()=>{
      const current=await assertAnchor(this.db,anchor);requireStorage(same(current,expected),'stale_epoch');
      return (await this.db.applicationState.get(scope))?.value??null;
    });
  }
  async patchState(expected:RuntimeControl,scope:string,patch:Record<string,unknown>,initialize=false){
    participantUuid(scope);const anchor=await readAnchor(this.port);
    return this.db.transaction('rw',this.db.runtime,this.db.datasets,this.db.applicationState,async()=>{
      const current=await assertAnchor(this.db,anchor);requireStorage(same(current,expected)&&current.pendingSwitchId===null,'stale_epoch');
      const previous=(await this.db.applicationState.get(scope))?.value;
      if(initialize&&previous)return previous;
      const value={...previous,...patch};await this.db.applicationState.put({scope,value});return value;
    });
  }
  close(){this.db.close();}
}
