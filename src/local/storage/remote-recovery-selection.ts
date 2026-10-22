import {assertNoBackupPreparation} from './backup-preparation.js';
import {assertNoRemoteBackup} from './remote-backup-owner.js';
/** Native route hold for archive recovery on the currently selected server. */
import type {RuntimeControl,SentinelPort} from '../../control/types.js';
import {runtimeControl} from '../../control/validation.js';
import {participantUuid,requireParticipant} from '../../control/participant-wire.js';
import type {RemoteDescriptor} from './remote-control.js';
import {FinancialDatabase} from './database.js';
import {assertAnchor,readAnchor} from './anchor.js';
import {int64,storageFailure} from './types.js';
import {sameJournal} from '../migration/journal.js';
import {identity} from '../migration/wire.js';
import type {PortableIdentity} from '../migration/wire.js';
import {archiveStatus,archivePreview,recoveryRequest,recoveryWithdrawal} from '../migration/archive-wire.js';
import type {ArchiveRecoveryRequest,ArchiveStatus,RecoveryWithdrawal,ArchivePreview} from '../migration/archive-wire.js';

export interface RemoteRecoveryIntent{
  version:'1';id:string;initialRoot:RuntimeControl;descriptor:RemoteDescriptor;
  request:ArchiveRecoveryRequest;phase:'pending'|'activated'|'cancelled';
  selectedRef:string;selectedContext:string;withdrawal:RecoveryWithdrawal|null;
  uploaded:number;acceptedPreview:string|null;lastError:string|null;preview:ArchivePreview|null;
  cancelRequested:boolean;activationPreview:string|null;remoteCleaned:boolean;fileCleaned:boolean;
}
export const recoveryErrors=new Set(['backend_unavailable','unauthorized','permission_required','unsupported_migration_version','migration_busy','migration_paused','migration_not_empty','migration_invalid','migration_wrong_account','migration_incomplete','zenmoney_unavailable','validation_error','quota_exceeded','recovery_required','storage_corrupt','stale_context','stale_epoch','dataset_not_writable']);
const head='remote-recovery-head',scope=(id:string)=>'remote-recovery:'+id;
const increment=(value:string)=>int64(String(BigInt(value)+1n));
function checked(input:unknown):RemoteRecoveryIntent{
  requireParticipant(input!==null&&typeof input==='object'&&!Array.isArray(input));const v=input as RemoteRecoveryIntent;
  requireParticipant(Object.keys(v).sort().join(',')==='acceptedPreview,activationPreview,cancelRequested,descriptor,fileCleaned,id,initialRoot,lastError,phase,preview,remoteCleaned,request,selectedContext,selectedRef,uploaded,version,withdrawal'&&v.version==='1'&&['pending','activated','cancelled'].includes(v.phase));
  participantUuid(v.id);runtimeControl(v.initialRoot);recoveryRequest(v.request);
  requireParticipant(v.initialRoot.activeMode==='remote'&&v.initialRoot.credentialRef!==null&&v.initialRoot.pendingSwitchId===null&&v.request.id===v.id);
  requireParticipant(v.descriptor!==null&&typeof v.descriptor==='object'&&typeof v.descriptor.url==='string'&&typeof v.descriptor.legacy==='boolean');
  participantUuid(v.descriptor.contextId);participantUuid(v.descriptor.installationId);participantUuid(v.descriptor.datasetId);
  requireParticipant(v.request.installation_id===v.descriptor.installationId);
  participantUuid(v.selectedRef);participantUuid(v.selectedContext);
  requireParticipant(Number.isSafeInteger(v.uploaded)&&v.uploaded>=0&&v.uploaded<=Math.ceil(Number(v.request.archive_size)/262144));
  requireParticipant(typeof v.cancelRequested==='boolean'&&typeof v.remoteCleaned==='boolean'&&typeof v.fileCleaned==='boolean'&&(v.phase!=='pending'||!v.remoteCleaned&&!v.fileCleaned));
  if(v.activationPreview!==null){participantUuid(v.activationPreview);requireParticipant(v.acceptedPreview===v.activationPreview&&v.preview?.id===v.activationPreview);}
  if(v.preview!==null)archivePreview(v.preview,v.request.archive_sha256);
  if(v.acceptedPreview!==null)participantUuid(v.acceptedPreview);
  requireParticipant(v.lastError===null||recoveryErrors.has(v.lastError));
  if(v.withdrawal!==null){requireParticipant(v.phase==='cancelled');recoveryWithdrawal(v.withdrawal,v.request);}
  return structuredClone(v);
}
export class RemoteRecoverySelection{
  private constructor(private db:FinancialDatabase,private sentinel:SentinelPort){}
  static async open(name:string,sentinel:SentinelPort){
    const marker=await readAnchor(sentinel),db=new FinancialDatabase(name,false);
    try{await db.open();await db.transaction('r',db.runtime,db.datasets,()=>assertAnchor(db,marker));return new RemoteRecoverySelection(db,sentinel);}
    catch(error){db.close();throw storageFailure(error);}
  }
  close(){this.db.close();}
  async #unit<T>(write:boolean,work:(root:RuntimeControl)=>Promise<T>){
    const marker=await readAnchor(this.sentinel);
    try{return await this.db.transaction(write?'rw':'r',this.db.tables,async()=>work(await assertAnchor(this.db,marker)));}
    catch(error){if(error&&typeof error==='object'&&'code'in error)throw error;throw storageFailure(error);}
  }
  async #read(id:string){participantUuid(id);return checked((await this.db.applicationState.get(scope(id)))?.value);}
  async #save(value:RemoteRecoveryIntent){await this.db.applicationState.put({scope:scope(value.id),value:checked(value) as unknown as Record<string,unknown>});}
  async current(){return this.#unit(false,async()=>{
    const id=(await this.db.applicationState.get(head))?.value.id;return id===undefined?null:this.#read(participantUuid(id));
  });}
  #same(root:RuntimeControl,expected:RuntimeControl){
    requireParticipant((!expected.financialMayHaveStarted||root.financialMayHaveStarted)&&sameJournal({...root,financialMayHaveStarted:expected.financialMayHaveStarted},expected),'stale_context');
  }
  async #held(root:RuntimeControl,value:RemoteRecoveryIntent){
    requireParticipant((await this.db.applicationState.get(head))?.value.id===value.id&&value.phase==='pending','migration_paused');
    this.#same(root,{...value.initialRoot,pendingSwitchId:value.id,epoch:increment(value.initialRoot.epoch),financialMayHaveStarted:true});
    requireParticipant(sameJournal(await this.db.remoteContexts.get(root.credentialRef!),{id:root.credentialRef,...value.descriptor}),'stale_context');
  }
  /** The immutable begin command exists before any server hold can be requested. */
  async begin(expected:RuntimeControl,request:ArchiveRecoveryRequest){
    const input=recoveryRequest(request),captured=structuredClone(runtimeControl(expected));await this.sentinel.markFinancialActivity(captured.installationId);
    return this.#unit(true,async root=>{
      const previous=(await this.db.applicationState.get(scope(input.id)))?.value;
      if(previous){const value=checked(previous);requireParticipant(sameJournal(value.request,input),'migration_invalid');return value;}
      this.#same(root,captured);requireParticipant(root.activeMode==='remote'&&root.pendingSwitchId===null&&root.credentialRef!==null,'migration_paused');
      increment(increment(root.epoch));increment(root.credentialEpoch);
      await assertNoRemoteBackup(this.db);await assertNoBackupPreparation(this.db);
      for(const [pointer,prefix,terminal] of [
        ['mode-switch-head','mode-switch:',['complete','cancelled']],['mode-join-head','mode-join:',['complete','cancelled']],
        ['local-backup-head','local-backup:',['ready','cancelled','cleaned']],['archive-restore-head','archive-restore:',['activated','cancelled']],
        [head,'remote-recovery:',['activated','cancelled']],
      ] as const){const id=(await this.db.applicationState.get(pointer))?.value.id;
        if(typeof id==='string')requireParticipant(terminal.includes((await this.db.applicationState.get(prefix+id))?.value.phase as never),'migration_busy');}
      const descriptor=await this.db.remoteContexts.get(root.credentialRef);requireParticipant(descriptor!==undefined,'recovery_required');
      const {id:_id,...context}=descriptor;
      const value=checked({version:'1',id:input.id,initialRoot:root,descriptor:context,request:input,phase:'pending',selectedRef:crypto.randomUUID(),selectedContext:crypto.randomUUID(),withdrawal:null,uploaded:0,acceptedPreview:null,lastError:null,preview:null,cancelRequested:false,activationPreview:null,remoteCleaned:false,fileCleaned:false});
      await this.#save(value);await this.db.applicationState.put({scope:head,value:{id:value.id}});
      await this.db.runtime.put({...root,pendingSwitchId:value.id,epoch:increment(root.epoch),financialMayHaveStarted:true});return value;
    });
  }
  async pending(id:string){return this.#unit(false,async root=>{
    const value=await this.#read(id);if(value.phase==='pending')await this.#held(root,value);return value;
  });}
  async uploaded(id:string,number:number){return this.#unit(true,async root=>{
    const value=await this.#read(id);await this.#held(root,value);
    requireParticipant(Number.isSafeInteger(number)&&number>=0&&number<Math.ceil(Number(value.request.archive_size)/262144)&&number<=value.uploaded);
    if(number<value.uploaded)return value;
    const next={...value,uploaded:number+1,lastError:null};await this.#save(next);return next;
  });}
  async showPreview(id:string,input:ArchivePreview,expectedPreview:string|null){
    return this.#unit(true,async root=>{const value=await this.#read(id);await this.#held(root,value);
      const preview=archivePreview(input,value.request.archive_sha256);
      requireParticipant(!value.cancelRequested,'migration_paused');
      requireParticipant((value.preview?.id??null)===expectedPreview,'stale_context');
      // Only a fresh authenticated server preview can retire the previous grant.
      // Finalize serializes with activation and permanently replaces its ID.
      const changed=value.preview?.id!==preview.id;
      if(!changed)requireParticipant(sameJournal(value.preview,preview),'migration_invalid');
      const next={...value,preview,lastError:null,...(changed?{acceptedPreview:null,activationPreview:null}:{})};
      await this.#save(next);return next;});
  }
  async previewConsent(id:string,previewId:string|null){
    if(previewId!==null)participantUuid(previewId);
    return this.#unit(true,async root=>{const value=await this.#read(id);await this.#held(root,value);
      requireParticipant(!value.cancelRequested&&value.activationPreview===null,'migration_paused');
      requireParticipant(previewId===null||value.preview?.id===previewId,'migration_incomplete');
      const next={...value,acceptedPreview:previewId,preview:previewId===null?null:value.preview,lastError:null};await this.#save(next);return next;});
  }
  async failed(id:string,code:string){
    requireParticipant(recoveryErrors.has(code));
    return this.#unit(true,async root=>{const value=await this.#read(id);if(value.phase==='pending')await this.#held(root,value);
      const next={...value,lastError:code};await this.#save(next);return next;});
  }
  /** The final grant prevents a stale step from using revoked preview consent. */
  async dispatchActivation(id:string,previewId:string){
    participantUuid(previewId);
    return this.#unit(true,async root=>{const value=await this.#read(id);await this.#held(root,value);
      requireParticipant(!value.cancelRequested&&value.acceptedPreview===previewId&&value.preview?.id===previewId&&
        (value.activationPreview===null||value.activationPreview===previewId),'migration_paused');
      const next={...value,activationPreview:previewId,lastError:null};await this.#save(next);return next;});
  }
  /** Cancellation is durable before any HTTP; an already granted send stays uncertain. */
  async requestCancel(id:string){return this.#unit(true,async root=>{
    const value=await this.#read(id);if(value.phase!=='pending')return value;await this.#held(root,value);
    const next={...value,cancelRequested:true,acceptedPreview:value.activationPreview===null?null:value.acceptedPreview,lastError:null};await this.#save(next);return next;
  });}
  async cleaned(id:string,side:'remote'|'file'){return this.#unit(true,async()=>{
    const value=await this.#read(id);requireParticipant(value.phase!=='pending','migration_paused');
    const next={...value,[side==='remote'?'remoteCleaned':'fileCleaned']:true,lastError:null};await this.#save(next);return next;
  });}
  #proof(value:RemoteRecoveryIntent,input:ArchiveStatus,peer:PortableIdentity,phase:'activated'|'cancelled'){
    const status=archiveStatus(input,value.id),current=identity(peer),request=value.request;
    requireParticipant(status.kind==='recovery'&&status.phase===phase&&status.installation_id===request.installation_id&&
      status.initial_epoch===request.expected_epoch&&status.dataset_id===request.dataset_id&&status.archive_sha256===request.archive_sha256&&status.archive_size===request.archive_size,'migration_invalid');
    requireParticipant(current.installation_id===request.installation_id&&current.dataset_id===(phase==='activated'?request.dataset_id:value.descriptor.datasetId)&&
      current.state==='active'&&current.operation_id===null&&current.legacy_hold===null&&BigInt(current.participant_epoch)>=BigInt(request.expected_epoch)+2n&&
      sameJournal([...current.owner_ids].sort(),[...request.owner_ids].sort()),'migration_invalid');
    return current;
  }
  /** Called only with freshly authenticated permanent activation and identity. */
  async activated(id:string,status:ArchiveStatus,peer:PortableIdentity,credentialRef:string,contextId:string){
    participantUuid(credentialRef);participantUuid(contextId);
    return this.#unit(true,async root=>{
      const value=await this.#read(id),checkedPeer=this.#proof(value,status,peer,'activated');
      if(value.phase==='activated'){
        requireParticipant(root.activeMode==='remote'&&root.pendingSwitchId===null&&root.credentialRef===value.selectedRef&&
          root.epoch===increment(increment(value.initialRoot.epoch))&&root.credentialEpoch===increment(value.initialRoot.credentialEpoch),'stale_context');return value;
      }
      await this.#held(root,value);
      requireParticipant(credentialRef===value.selectedRef&&contextId===value.selectedContext&&credentialRef!==root.credentialRef&&contextId!==value.descriptor.contextId,'migration_invalid');
      requireParticipant(await this.db.remoteContexts.get(credentialRef)===undefined,'migration_invalid');
      await this.db.remoteContexts.add({id:credentialRef,...value.descriptor,contextId,legacy:false,installationId:checkedPeer.installation_id,datasetId:checkedPeer.dataset_id});
      await this.db.runtime.put({...root,pendingSwitchId:null,epoch:increment(root.epoch),credentialEpoch:increment(root.credentialEpoch),credentialRef});
      const next=checked({...value,phase:'activated'});await this.#save(next);return next;
    });
  }
  /** A permanent exact-request withdrawal can also retire a never-accepted begin.
   * Archive owners are deliberately irrelevant here: wrong-owner rejection must
   * restore only the original physical route, not activate any imported writer.
   */
  async withdrawn(id:string,input:RecoveryWithdrawal,peer:PortableIdentity){
    return this.#unit(true,async root=>{
      const value=await this.#read(id),proof=recoveryWithdrawal(input,value.request),current=identity(peer);
      requireParticipant(proof.dataset_id===value.descriptor.datasetId&&current.installation_id===proof.installation_id&&
        current.dataset_id===proof.dataset_id&&current.state==='active'&&current.operation_id===null&&current.legacy_hold===null&&
        BigInt(proof.participant_epoch)>=BigInt(value.request.expected_epoch)&&BigInt(current.participant_epoch)>=BigInt(proof.participant_epoch),'migration_invalid');
      if(value.phase==='cancelled'){
        this.#same(root,{...value.initialRoot,epoch:increment(increment(value.initialRoot.epoch)),financialMayHaveStarted:true});return value;
      }
      await this.#held(root,value);
      await this.db.runtime.put({...root,pendingSwitchId:null,epoch:increment(root.epoch)});
      const next=checked({...value,phase:'cancelled',withdrawal:proof});await this.#save(next);return next;
    });
  }
  /** No offline escape: a confirmed cancellation must precede release of Root. */
  async cancelled(id:string,status:ArchiveStatus,peer:PortableIdentity){
    return this.#unit(true,async root=>{
      const value=await this.#read(id);this.#proof(value,status,peer,'cancelled');if(value.phase==='cancelled'){
        this.#same(root,{...value.initialRoot,epoch:increment(increment(value.initialRoot.epoch)),financialMayHaveStarted:true});return value;
      }
      await this.#held(root,value);await this.db.runtime.put({...root,pendingSwitchId:null,epoch:increment(root.epoch)});
      const next=checked({...value,phase:'cancelled'});await this.#save(next);return next;
    });
  }
}
