import {TransportRepairOwner} from '../local/storage/transport-repair.js';
/** Recover a selected server without exposing HTTP proofs or tokens to the popup. */
import {ServerCredentials} from '../local/migration/credentials.js';
import {RemoteRecoverySelection,recoveryErrors} from '../local/storage/remote-recovery-selection.js';
import type {RemoteRecoveryIntent} from '../local/storage/remote-recovery-selection.js';
import {RemoteControl} from '../local/storage/remote-control.js';
import {ArchiveFileOwner} from '../local/storage/archive-file-owner.js';
import {readArchive} from '../local/portable/zip.js';
import {requireParticipant,participantUuid} from '../control/participant-wire.js';
import type {ResolvedApplication} from './runtime.js';
import type {StorageControlOptions} from './storage-controls.js';

export type RemoteArchiveOptions=Pick<StorageControlOptions,'name'|'sentinel'|'persistent'|'serverPermission'|'fetch'>;
export class RemoteArchiveRecovery{
  private credentials:ServerCredentials;
  constructor(private options:RemoteArchiveOptions){
    this.credentials=new ServerCredentials(options.persistent,options.serverPermission,options.fetch);
  }
  async #selection<T>(work:(owner:RemoteRecoverySelection)=>Promise<T>){
    const owner=await RemoteRecoverySelection.open(this.options.name,this.options.sentinel);
    try{return await work(owner);}finally{owner.close();}
  }
  async #file<T>(work:(owner:ArchiveFileOwner)=>Promise<T>){
    const owner=await ArchiveFileOwner.open(this.options.name,this.options.sentinel);
    try{return await work(owner);}finally{owner.close();}
  }
  async #client(value:RemoteRecoveryIntent){
    const ref=await this.#transportRef(value),saved=await this.credentials.read(ref);
    requireParticipant(saved.url===value.descriptor.url,'recovery_required');
    if(ref===value.initialRoot.credentialRef)requireParticipant(saved.contextId===value.descriptor.contextId&&saved.legacy===value.descriptor.legacy,'recovery_required');
    return this.credentials.client(ref);
  }
  async #transportRef(value:RemoteRecoveryIntent){
    const owner=await TransportRepairOwner.open(this.options.name,this.options.sentinel);
    try{return await owner.ref('recovery',value.id,value.initialRoot.credentialRef!);}finally{owner.close();}
  }
  async repairServer(app:ResolvedApplication,id:string,token:string){
    await app.assert(true);const owner=await TransportRepairOwner.open(this.options.name,this.options.sentinel);
    try{
      const snapshot=await owner.snapshot('recovery',id,app.root),value=await this.#selection(selection=>selection.pending(id));
      requireParticipant(JSON.stringify(snapshot.record)===JSON.stringify(value),'stale_context');
      const candidate=await this.credentials.verify({url:value.descriptor.url,token},value.request.owner_ids),peer=candidate.identity;
      requireParticipant(peer.installation_id===value.request.installation_id&&[null,id].includes(peer.operation_id),'migration_invalid');
      if(value.phase!=='pending'||peer.dataset_id!==value.descriptor.datasetId){
        const status=await (await this.credentials.client(candidate.ref)).archiveStatus(id);
        requireParticipant(status.kind==='recovery'&&(value.phase==='cancelled'?['cancelled','cleaned'].includes(status.phase):status.phase==='activated')&&status.installation_id===value.request.installation_id&&
          status.initial_epoch===value.request.expected_epoch&&status.dataset_id===value.request.dataset_id&&
          status.archive_sha256===value.request.archive_sha256&&status.archive_size===value.request.archive_size&&
          peer.dataset_id===(value.phase==='cancelled'?value.descriptor.datasetId:value.request.dataset_id)&&peer.state==='active'&&peer.operation_id===null,'migration_invalid');
      }
      await owner.install(snapshot,value.initialRoot.credentialRef!,candidate.ref);return {repaired:true};
    }finally{owner.close();}
  }
  #view(value:RemoteRecoveryIntent){
    return {kind:'remote-recovery' as const,serverUrl:value.descriptor.url,id:value.id,phase:value.phase,error:value.lastError,
      remoteCleaned:value.remoteCleaned,uploaded:value.uploaded,chunks:Math.ceil(Number(value.request.archive_size)/262144),preview:value.preview,
      canCancel:value.phase==='pending'&&!value.cancelRequested,cancelRequested:value.cancelRequested,
      cleaning:value.phase!=='pending'&&(!value.remoteCleaned||!value.fileCleaned),activationStarted:value.activationPreview!==null,
      awaitingConfirmation:!value.cancelRequested&&value.preview!==null&&value.acceptedPreview===null};
  }
  async current(){const value=await this.#selection(owner=>owner.current());return value?this.#view(value):null;}
  async begin(app:ResolvedApplication,id:string,consent:{formerWritersRetired:boolean;acceptPostSnapshotEvidenceLoss:boolean}){
    participantUuid(id);await app.assert();
    requireParticipant(app.context.mode==='remote'&&app.root.credentialRef!==null,'migration_paused');
    requireParticipant(consent.formerWritersRetired===true&&consent.acceptPostSnapshotEvidenceLoss===true,'migration_paused');
    const file=await this.#file(owner=>owner.status(id));requireParticipant(file.phase==='ready','migration_incomplete');
    const archive=await readArchive(await this.#file(owner=>owner.blob(id)),{async manifest(){},async row(){}});
    requireParticipant(archive.archiveSha256===file.sha256,'migration_invalid');
    const control=await RemoteControl.open(this.options.name,this.options.sentinel);
    let descriptor;try{descriptor=await control.remoteContext(app.root);}finally{control.close();}
    requireParticipant(descriptor.installationId!==undefined&&descriptor.datasetId!==undefined,'server_verification_required');
    const client=await this.credentials.client(app.root.credentialRef);
    // A rejected or never-delivered begin must always have an online withdrawal.
    await client.archiveCapabilities();const peer=await client.identity();
    requireParticipant(peer.installation_id===descriptor.installationId&&peer.dataset_id===descriptor.datasetId,'stale_context');
    requireParticipant(peer.can_import&&peer.state==='active'&&peer.operation_id===null&&!peer.awaiting_sync&&peer.legacy_hold===null,'migration_not_empty');
    requireParticipant(JSON.stringify([...peer.owner_ids].sort())===JSON.stringify([...archive.manifest.zenmoney_identity.owner_ids].sort()),'migration_wrong_account');
    await app.assert();
    const value=await this.#selection(owner=>owner.begin(app.root,{id,installation_id:peer.installation_id,expected_epoch:peer.participant_epoch,
      dataset_id:archive.manifest.dataset_id,archive_sha256:file.sha256,archive_size:String(file.bytes),owner_ids:[...peer.owner_ids].sort(),
      former_writers_retired:true,accept_post_snapshot_evidence_loss:true}));
    return this.#view(value);
  }
  /** One bounded upload or server control unit; an alarm may continue it later. */
  async step(id:string){
    const value=await this.#selection(owner=>owner.pending(id));
    if(value.phase!=='pending')return this.#cleanup(value);
    if(value.cancelRequested)return this.#withdraw(value);
    let beginning=false;
    try{
      const client=await this.#client(value);
      let status;try{status=await client.archiveStatus(id);}catch(error){if((error as {code?:string}).code!=='not_found')throw error;beginning=true;status=await client.archiveRestore(value.request);}
      if(status.phase==='activated'){
        const peer=await client.identity();
        await this.credentials.cloneContext(await this.#transportRef(value),value.selectedRef,value.selectedContext);
        const selected=await this.#selection(owner=>owner.activated(id,status,peer,value.selectedRef,value.selectedContext));
        return {state:'cleaning',...this.#view(selected)};
      }
      if(['cancelled','cleaned'].includes(status.phase))return this.cancel(id);
      if(status.phase==='uploading'){
        const file=await this.#file(owner=>owner.status(id));requireParticipant(file.phase==='ready'&&file.sha256===value.request.archive_sha256&&String(file.bytes)===value.request.archive_size,'migration_invalid');
        if(value.uploaded<file.chunks){
          const bytes=await this.#file(owner=>owner.chunk(id,value.uploaded));await client.archiveUpload(id,value.uploaded,bytes);
          return {state:'working',...this.#view(await this.#selection(owner=>owner.uploaded(id,value.uploaded)))};
        }
        await client.archiveAction(id,'finalize');return {state:'waiting',...this.#view(value)};
      }
      if(status.phase==='preview'){
        if(value.acceptedPreview===null){
          const preview=await client.archivePreview(id,value.request.archive_sha256);
          const shown=await this.#selection(owner=>owner.showPreview(id,preview));
          return {state:shown.cancelRequested?'working':'preview',...this.#view(shown)};
        }
        const grant=await this.#selection(owner=>owner.dispatchActivation(id,value.acceptedPreview!));
        // Do not await unrelated work after the native grant. A later cancel may
        // win withdrawal at the server, but cannot retract this granted request.
        await client.archiveActivate(id,grant.activationPreview!,true);
        return {state:'working',...this.#view(value)};
      }
      if(status.phase==='blocked'){
        const code=status.error_code??'migration_incomplete';await this.#selection(owner=>owner.failed(id,code));
        return {state:'blocked',...this.#view({...value,lastError:code})};
      }
      return {state:'waiting',...this.#view(value)};
    }catch(error){
      if((error as {code?:string}).code==='migration_busy'){
        if(beginning){
          const peer=await (await this.#client(value)).identity().catch(()=>null);
          if(peer&&(peer.participant_epoch!==value.request.expected_epoch||peer.installation_id!==value.request.installation_id||peer.dataset_id!==value.descriptor.datasetId)){
            await this.#selection(owner=>owner.failed(id,'migration_busy'));return {state:'blocked',...this.#view({...value,lastError:'migration_busy'})};
          }
        }
        return {state:'waiting',...this.#view(value)};
      }
      const code=recoveryErrors.has((error as {code?:string})?.code??'')?(error as {code:string}).code:'migration_invalid';
      await this.#selection(owner=>owner.failed(id,code));return {state:'blocked',...this.#view({...value,lastError:code})};
    }
  }
  async accept(id:string,previewId:string){
    const value=await this.#selection(owner=>owner.pending(id));requireParticipant(value.phase==='pending','migration_paused');
    // Consent is durable before dispatch; lost replies resume this exact ID.
    return this.#view(await this.#selection(owner=>owner.previewConsent(id,previewId)));
  }
  async retry(id:string,refreshPreview=false){
    const value=await this.#selection(owner=>owner.pending(id));requireParticipant(value.phase==='pending','migration_paused');
    const client=await this.#client(value);
    if(refreshPreview){await this.#selection(owner=>owner.previewConsent(id,null));await client.archiveAction(id,'finalize');}
    else{try{await client.archiveAction(id,'retry');}catch(error){if((error as {code?:string}).code!=='not_found')throw error;}}
    return this.step(id);
  }
  async #cleanup(value:RemoteRecoveryIntent){
    const id=value.id;
    try{
      const repair=await TransportRepairOwner.open(this.options.name,this.options.sentinel);
      try{await repair.adoptSelected('recovery',id,this.credentials);}finally{repair.close();}
      if(!value.remoteCleaned){
        const client=await this.#client(value),status=await client.archiveStatus(id);
        requireParticipant(status.installation_id===value.request.installation_id&&status.dataset_id===value.request.dataset_id&&
          status.archive_sha256===value.request.archive_sha256&&status.initial_epoch===value.request.expected_epoch,'migration_invalid');
        requireParticipant(value.phase==='activated'?status.phase==='activated':['cancelled','cleaned'].includes(status.phase),'migration_invalid');
        if(value.phase==='activated'&&status.acknowledged_at===null){await client.archiveAcknowledge(id,value.request.archive_sha256);return {state:'cleaning',...this.#view(value)};}
        if(!(await client.archiveClean(id)).complete)return {state:'cleaning',...this.#view(value)};
        const next=await this.#selection(owner=>owner.cleaned(id,'remote'));return {state:'cleaning',...this.#view(next)};
      }
      if(!value.fileCleaned){
        const complete=await this.#file(async owner=>{await owner.cancel(id);return owner.clean(id);});
        if(!complete.complete)return {state:'cleaning',...this.#view(value)};
        const next=await this.#selection(owner=>owner.cleaned(id,'file'));return {state:'complete',...this.#view(next)};
      }
      return {state:'complete',...this.#view(value)};
    }catch(error){
      const code=recoveryErrors.has((error as {code?:string})?.code??'')?(error as {code:string}).code:'migration_invalid';
      await this.#selection(owner=>owner.failed(id,code));return {state:'blocked',...this.#view({...value,lastError:code})};
    }
  }
  async #withdraw(value:RemoteRecoveryIntent){
    try{
      const client=await this.#client(value),proof=await client.archiveWithdraw(value.request),peer=await client.identity();
      const cancelled=await this.#selection(owner=>owner.withdrawn(value.id,proof,peer));
      return {state:'cleaning',...this.#view(cancelled)};
    }catch(error){
      // Withdrawal and an already granted activation can race at the server.
      // Activation is permanent; resolve it forward without issuing another one.
      const client=await this.#client(value),status=await client.archiveStatus(value.id).catch(()=>null);
      if(status?.phase==='activated'){
        const peer=await client.identity();await this.credentials.cloneContext(await this.#transportRef(value),value.selectedRef,value.selectedContext);
        const selected=await this.#selection(owner=>owner.activated(value.id,status,peer,value.selectedRef,value.selectedContext));
        return {state:'cleaning',...this.#view(selected)};
      }
      const code=recoveryErrors.has((error as {code?:string})?.code??'')?(error as {code:string}).code:'migration_invalid';
      await this.#selection(owner=>owner.failed(value.id,code));return {state:code==='migration_busy'?'waiting':'blocked',...this.#view({...value,lastError:code})};
    }
  }
  async cancel(id:string){
    const value=await this.#selection(owner=>owner.requestCancel(id));
    return value.phase==='pending'?this.#withdraw(value):this.#cleanup(value);
  }
}
