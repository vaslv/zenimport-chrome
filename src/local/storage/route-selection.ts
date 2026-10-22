import {assertNoBackupPreparation} from './backup-preparation.js';
import {assertNoRemoteBackup} from './remote-backup-owner.js';
/** Native-only no-import route decision; it never fabricates peer authority. */
import Dexie from 'dexie';
import type {RuntimeControl,SentinelPort} from '../../control/types.js';
import {runtimeControl,datasetControl} from '../../control/validation.js';
import {participantUuid,requireParticipant} from '../../control/participant-wire.js';
import {identity} from '../migration/wire.js';
import type {PortableIdentity} from '../migration/wire.js';
import {sameJournal,switchJournal} from '../migration/journal.js';
import {serverAddress} from '../../../extension/backend-client.js';
import {FinancialDatabase} from './database.js';
import {readAnchor,assertAnchor} from './anchor.js';
import {participantControl} from './participant-validation.js';
import type {RemoteDescriptor} from './remote-control.js';
import {readOutbox} from './outbox-control.js';
import {int64} from './types.js';
import {encodeKey} from './cells.js';
export interface JoinConsent{retainLocalCopy:boolean;withoutImport:boolean;acceptMissingDedupEvidence:boolean}
export interface JoinIntent{
  version:1;id:string;initialRoot:RuntimeControl;credentialRef:string;descriptor:RemoteDescriptor;
  destination:PortableIdentity;phase:'quiescing'|'complete'|'cancelled';createdAt:string;
}
const head='mode-join-head',scope=(id:string)=>'mode-join:'+id;
const equalOwners=(a:readonly string[],b:readonly string[])=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
function checked(input:unknown):JoinIntent{
  requireParticipant(input!==null&&typeof input==='object'&&!Array.isArray(input));const value=input as JoinIntent;
  requireParticipant(Object.keys(value).sort().join(',')==='createdAt,credentialRef,descriptor,destination,id,initialRoot,phase,version'&&value.version===1&&['quiescing','complete','cancelled'].includes(value.phase));
  participantUuid(value.id);participantUuid(value.credentialRef);const root=runtimeControl(value.initialRoot);
  requireParticipant(root.activeMode==='local'&&root.activeGeneration!==null&&root.pendingSwitchId===null);
  const target=identity(value.destination),descriptor=value.descriptor;
  requireParticipant(descriptor!==null&&typeof descriptor==='object'&&Object.keys(descriptor).sort().join(',')==='contextId,datasetId,installationId,legacy,url'&&descriptor.legacy===false&&serverAddress(descriptor.url)===descriptor.url&&descriptor.installationId===target.installation_id&&descriptor.datasetId===target.dataset_id);
  participantUuid(descriptor.contextId);requireParticipant(BigInt(int64(value.createdAt))>=0n);return structuredClone(value);
}
export class RouteSelection{
  private constructor(private db:FinancialDatabase,private sentinel:SentinelPort){}
  static async open(name:string,sentinel:SentinelPort){
    const marker=await readAnchor(sentinel),db=new FinancialDatabase(name,false);
    try{await db.open();await db.transaction('r',db.runtime,db.datasets,()=>assertAnchor(db,marker));return new RouteSelection(db,sentinel);}catch(error){db.close();throw error;}
  }
  async current(){
    const marker=await readAnchor(this.sentinel);return this.db.transaction('r',this.db.runtime,this.db.datasets,this.db.applicationState,async()=>{
      await assertAnchor(this.db,marker);const pointer=(await this.db.applicationState.get(head))?.value;
      if(pointer===undefined)return null;requireParticipant(Object.keys(pointer).join(',')==='id');
      const value=checked((await this.db.applicationState.get(scope(participantUuid(pointer.id))))?.value);requireParticipant(value.id===pointer.id);return value;
    });
  }
  #sameRoot(root:RuntimeControl,expected:RuntimeControl){
    requireParticipant((!expected.financialMayHaveStarted||root.financialMayHaveStarted)&&sameJournal({...root,financialMayHaveStarted:expected.financialMayHaveStarted},expected),'migration_busy');
  }
  async #available(){
    await assertNoRemoteBackup(this.db);await assertNoBackupPreparation(this.db);
    const restore=(await this.db.applicationState.get('archive-restore-head'))?.value;
      if(restore)requireParticipant(['activated','cancelled'].includes((await this.db.applicationState.get('archive-restore:'+restore.id))?.value.phase as string),'migration_busy');
      const backup=(await this.db.applicationState.get('local-backup-head'))?.value;
    if(backup)requireParticipant((await this.db.applicationState.get('local-backup:'+backup.id))?.value.phase!=='building','migration_busy');
    const pointer=(await this.db.applicationState.get('mode-switch-head'))?.value;
    if(pointer){const value=switchJournal((await this.db.applicationState.get('mode-switch:'+participantUuid(pointer.id)))?.value);requireParticipant(['complete','cancelled'].includes(value.phase),'migration_busy');}
  }
  async #local(root:RuntimeControl,owners:readonly string[]){
    requireParticipant(root.activeMode==='local'&&root.activeGeneration!==null&&root.pendingSwitchId===null,'migration_paused');
    const dataset=datasetControl(await this.db.datasets.get(root.activeGeneration)),participant=participantControl(await this.db.participants.get(dataset.participantId));
    requireParticipant(dataset.lifecycle==='active'&&dataset.holdId===null&&participant.state==='active'&&!participant.awaitingSync&&participant.generation===dataset.generation&&participant.epoch===dataset.participantEpoch,'migration_paused');
    let history=false;
    for(const table of ['bank_transactions','deliveries','processing_receipts','processing_targets','capture_jobs'] as const)if(await this.db.financial(table).where('generation').equals(dataset.generation).count()){history=true;break;}
    for(const key of ['sync_ever_started','migration_import_sha256','portable_imports'])if(await this.db.financial('dataset_metadata').get([dataset.generation,encodeKey([['text',key]])]))history=true;
    requireParticipant(dataset.ownerIds.length?equalOwners(dataset.ownerIds,owners):!history,'migration_wrong_account');return dataset;
  }
  async create(expected:RuntimeControl,input:Omit<JoinIntent,'version'|'phase'|'initialRoot'>,consent:JoinConsent){
    requireParticipant(consent.retainLocalCopy===true&&consent.withoutImport===true&&consent.acceptMissingDedupEvidence===true,'migration_paused');
    const value=checked({...input,version:1,phase:'quiescing',initialRoot:expected}),marker=await readAnchor(this.sentinel);
    return this.db.transaction('rw',this.db.tables,async()=>{
      const root=await assertAnchor(this.db,marker);this.#sameRoot(root,expected);await this.#available();
      const pointer=(await this.db.applicationState.get(head))?.value;
      if(pointer){const previous=checked((await this.db.applicationState.get(scope(participantUuid(pointer.id))))?.value);
        if(previous.id===value.id){requireParticipant(sameJournal({...previous,version:'1'},{...value,version:'1',phase:previous.phase}));return previous;}
        requireParticipant(previous.phase!=='quiescing','migration_busy');}
      int64(String(BigInt(root.epoch)+1n));int64(String(BigInt(root.credentialEpoch)+1n));
      await this.#local(root,value.destination.owner_ids);
      requireParticipant(value.destination.state==='active'&&value.destination.legacy_hold===null,'migration_paused');
      await this.db.applicationState.add({scope:scope(value.id),value:value as unknown as Record<string,unknown>});
      await this.db.applicationState.put({scope:head,value:{id:value.id}});return value;
    });
  }
  async select(id:string,authenticatedDestination:PortableIdentity){
    participantUuid(id);const destination=identity(authenticatedDestination),marker=await readAnchor(this.sentinel);
    return this.db.transaction('rw',this.db.tables,async()=>{
      const root=await assertAnchor(this.db,marker);requireParticipant((await this.db.applicationState.get(head))?.value.id===id,'migration_busy');
      const value=checked((await this.db.applicationState.get(scope(id)))?.value);
      if(value.phase==='complete'){
        requireParticipant(root.activeMode==='remote'&&root.credentialRef===value.credentialRef&&root.epoch===String(BigInt(value.initialRoot.epoch)+1n),'migration_busy');return value;
      }
      requireParticipant(value.phase==='quiescing','migration_paused');this.#sameRoot(root,value.initialRoot);await this.#available();
      requireParticipant(destination.installation_id===value.destination.installation_id&&destination.dataset_id===value.destination.dataset_id&&equalOwners(destination.owner_ids,value.destination.owner_ids),'migration_invalid');
      requireParticipant(destination.state==='active'&&destination.legacy_hold===null,'migration_paused');
      const dataset=await this.#local(root,destination.owner_ids),outbox=await readOutbox(this.db,dataset.generation);
      requireParticipant(outbox===null||outbox.phase==='settled','migration_busy');
      requireParticipant(await this.db.financial('capture_jobs').where('[generation+i0]').between([dataset.generation,Dexie.minKey],[dataset.generation,Dexie.maxKey],true,true).first()===undefined,'migration_busy');
      const descriptor={id:value.credentialRef,...value.descriptor},saved=await this.db.remoteContexts.get(value.credentialRef);
      requireParticipant(saved===undefined||sameJournal(saved,descriptor));if(!saved)await this.db.remoteContexts.add(descriptor);
      await this.db.datasets.put({...dataset,lifecycle:'retired'});
      // The retained participant has no invented handoff receipt. Root/epoch and
      // retired generation fences revoke all native financial writer claims.
      await this.db.runtime.put({...root,activeMode:'remote',activeGeneration:null,credentialRef:value.credentialRef,
        credentialEpoch:int64(String(BigInt(root.credentialEpoch)+1n)),epoch:int64(String(BigInt(root.epoch)+1n))});
      const complete=checked({...value,phase:'complete'});await this.db.applicationState.put({scope:scope(id),value:complete as unknown as Record<string,unknown>});return complete;
    });
  }
  async cancel(id:string){
    participantUuid(id);const marker=await readAnchor(this.sentinel);
    return this.db.transaction('rw',this.db.runtime,this.db.datasets,this.db.applicationState,async()=>{
      const root=await assertAnchor(this.db,marker);requireParticipant((await this.db.applicationState.get(head))?.value.id===id,'migration_busy');
      const value=checked((await this.db.applicationState.get(scope(id)))?.value);
      if(value.phase==='complete')return value;
      const cancelled=checked({...value,phase:'cancelled'});
      await this.db.applicationState.put({scope:scope(id),value:cancelled as unknown as Record<string,unknown>});return cancelled;
    });
  }
  close(){this.db.close();}
}
