/** Bounded selected-server snapshot export. It never grants financial authority. */
import type {ResolvedApplication} from './runtime.js';
import type {RemoteArchiveOptions} from './remote-archive-recovery.js';
import {RemoteBackupOwner} from '../local/storage/remote-backup-owner.js';
import type {RemoteBackupIntent} from '../local/storage/remote-backup-owner.js';
import {ArchiveFileOwner} from '../local/storage/archive-file-owner.js';
import {RemoteParticipant} from '../local/migration/remote.js';
import {readArchive} from '../local/portable/zip.js';
import {recoveryErrors} from '../local/storage/remote-recovery-selection.js';
import {requireParticipant,participantUuid} from '../control/participant-wire.js';

export class RemoteArchiveBackup{
  constructor(private options:RemoteArchiveOptions,private app:ResolvedApplication){}
  async #owner<T>(work:(owner:RemoteBackupOwner)=>Promise<T>){
    await this.app.assert();const owner=await RemoteBackupOwner.open(this.options.name,this.options.sentinel,this.app.root);
    try{return await work(owner);}finally{owner.close();}
  }
  async #file<T>(id:string,work:(owner:ArchiveFileOwner)=>Promise<T>){
    await this.app.assert();const owner=await ArchiveFileOwner.open(this.options.name,this.options.sentinel,this.app.root,id);
    try{return await work(owner);}finally{owner.close();}
  }
  #client(){return new RemoteParticipant(this.app.config,()=>this.options.serverPermission(this.app.config.url),this.options.fetch);}
  #view(v:RemoteBackupIntent){return {kind:'remote-backup' as const,id:v.id,phase:v.phase,error:v.error,
    downloaded:v.downloaded,chunks:v.status?.chunks??null,bytes:v.status?.archive_size??null,sha256:v.status?.archive_sha256??null,
    cancelRequested:v.cancelRequested,ackRequested:v.ackRequested,decision:v.decision};}
  async current(){const value=await this.#owner(owner=>owner.current());return value?this.#view(value):null;}
  async begin(id:string){
    participantUuid(id);await this.app.assert();requireParticipant(this.app.context.mode==='remote','migration_paused');
    const client=this.#client();await client.archiveBackupCapabilities();const peer=await client.identity();await this.app.assert();
    requireParticipant(peer.dataset_id===this.app.context.dataset_id,'stale_context');
    requireParticipant(peer.state==='active'&&peer.operation_id===null&&!peer.awaiting_sync&&peer.legacy_hold===null,'migration_paused');
    return this.#view(await this.#owner(owner=>owner.begin({id,installation_id:peer.installation_id,expected_epoch:peer.participant_epoch})));
  }
  async #error(id:string,error:unknown){
    const code=(error as {code?:string})?.code??'',checked=recoveryErrors.has(code)?code:'migration_invalid';
    if(['stale_context','stale_epoch'].includes(checked))throw error;
    const value=await this.#owner(owner=>owner.failed(id,checked));return {state:checked==='migration_busy'?'waiting':'blocked',...this.#view(value)};
  }
  async step(id:string){
    let value=await this.#owner(owner=>owner.pending(id));if(value.phase==='complete')return {state:'complete',...this.#view(value)};
    let beginning=false;
    try{
      const client=this.#client();
      if(value.phase==='cleaning'){
        if(!value.remoteCleaned){
          if(!(await client.archiveClean(id)).complete)return {state:'cleaning',...this.#view(value)};
          value=await this.#owner(owner=>owner.cleaned(id,'remote'));return {state:'cleaning',...this.#view(value)};
        }
        if(!value.fileCleaned){
          const file=await this.#file(id,owner=>owner.current());
          if(file?.id===id){const result=await this.#file(id,async owner=>{await owner.cancel(id);return owner.clean(id);});
            if(!result.complete)return {state:'cleaning',...this.#view(value)};}
          value=await this.#owner(owner=>owner.cleaned(id,'file'));
        }
        return {state:value.phase==='complete'?'complete':'cleaning',...this.#view(value)};
      }
      if(value.cancelRequested){
        const proof=await client.archiveBackupWithdraw(value.request);
        value=await this.#owner(owner=>owner.withdrawn(id,proof));return {state:'cleaning',...this.#view(value)};
      }
      if(value.phase==='ready'){
        if(!value.ackRequested)return {state:'download',...this.#view(value)};
        const ack=await client.archiveAcknowledge(id,value.status!.archive_sha256!);
        value=await this.#owner(owner=>owner.acknowledged(id,ack));return {state:'cleaning',...this.#view(value)};
      }
      let status;try{status=await client.archiveStatus(id);}catch(error){if((error as {code?:string}).code!=='not_found')throw error;beginning=true;status=await client.archiveBackup(value.request);}
      value=await this.#owner(owner=>owner.observe(id,status));
      if(status.phase==='blocked')return this.#error(id,{code:status.error_code});
      if(['cancelled','cleaned'].includes(status.phase))return {state:'working',...await this.cancel(id)};
      if(status.phase!=='ready')return {state:'waiting',...this.#view(value)};
      const file=await this.#file(id,owner=>owner.begin(id,Number(status.archive_size),status.archive_sha256!));
      if(value.downloaded<Number(status.chunks)){
        const number=value.downloaded,bytes=await client.archiveDownload(id,number);
        await this.#file(id,owner=>owner.put(id,file.nonce,number,bytes));
        value=await this.#owner(owner=>owner.received(id,number));return {state:'working',...this.#view(value)};
      }
      await this.#file(id,owner=>owner.seal(id));
      const archive=await readArchive(await this.#file(id,owner=>owner.blob(id)),{async manifest(){},async row(){}});
      requireParticipant(archive.manifest.dataset_id===value.server.datasetId&&archive.archiveSha256===status.archive_sha256,'migration_invalid');
      value=await this.#owner(owner=>owner.ready(id));return {state:'download',...this.#view(value)};
    }catch(error){
      if(beginning&&(error as {code?:string}).code==='migration_busy'){
        const peer=await this.#client().identity().catch(()=>null);
        if(peer&&(peer.participant_epoch!==value.request.expected_epoch||peer.installation_id!==value.server.installationId||peer.dataset_id!==value.server.datasetId))return {...await this.#error(id,error),state:'blocked'};
      }
      return this.#error(id,error);
    }
  }
  async chunk(id:string,number:number){
    const value=await this.#owner(owner=>owner.pending(id));requireParticipant(value.phase==='ready'&&!value.cancelRequested&&!value.ackRequested,'migration_paused');
    return this.#file(id,owner=>owner.chunk(id,number));
  }
  async acknowledge(id:string,checksum:string){return this.#view(await this.#owner(owner=>owner.acknowledge(id,checksum)));}
  async cancel(id:string){return this.#view(await this.#owner(owner=>owner.cancel(id)));}
  async retry(id:string){
    const value=await this.#owner(owner=>owner.pending(id));
    if(!value.cancelRequested&&value.phase==='working')try{await this.#client().archiveAction(id,'retry');}catch(error){if((error as {code?:string}).code!=='not_found')throw error;}
    return this.step(id);
  }
}
