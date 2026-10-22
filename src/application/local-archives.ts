/** Trusted local backup/recovery facade. No proof object is accepted from the UI. */
import type {ResolvedApplication} from './runtime.js';
import type {StorageControlOptions} from './storage-controls.js';
import {ArchiveFileOwner} from '../local/storage/archive-file-owner.js';
import {BackupOwner} from '../local/storage/backup-owner.js';
import {RestoreOwner} from '../local/storage/restore-owner.js';
import type {RestoreConsent} from '../local/storage/restore-owner.js';
import type {RestoreIntent} from '../local/storage/restore-control.js';
import {ModeTransfers} from '../local/migration/controller.js';
import {CredentialCandidates} from '../local/zenmoney/candidates.js';
import {mirrorReader} from '../local/zenmoney/reader.js';
import {prepareMirror} from '../local/zenmoney/projection.js';
import {requireParticipant,participantUuid} from '../control/participant-wire.js';

export type LocalArchiveOptions=Omit<StorageControlOptions,'verifyServer'>;
export class LocalArchives{
  private reader;private credentials:CredentialCandidates;
  constructor(private options:LocalArchiveOptions,private app:ResolvedApplication){
    this.reader=mirrorReader(options);
    this.credentials=new CredentialCandidates(options.persistent,this.reader,()=>Math.floor(this.clock()));
  }
  private clock(){return this.options.clock?.()??Date.now()/1000;}
  private now(){return String(Math.floor(this.clock()));}
  async #file<T>(work:(owner:ArchiveFileOwner)=>Promise<T>){
    await this.app.assert(true);const owner=await ArchiveFileOwner.open(this.options.name,this.options.sentinel,this.app.root);
    try{return await work(owner);}finally{owner.close();}
  }
  async #backup<T>(work:(owner:BackupOwner)=>Promise<T>){
    await this.app.assert(true);const owner=await BackupOwner.open(this.options.name,this.options.sentinel,this.app.root);
    try{return await work(owner);}finally{owner.close();}
  }
  async #restore<T>(work:(owner:RestoreOwner)=>Promise<T>){
    await this.app.assert(true);const owner=await RestoreOwner.open(this.options.name,this.options.sentinel,{
      verify:async ref=>{
        const secret=await this.credentials.read(ref),diff=await this.reader.read(secret.token,'0',true);
        const ownerIds=prepareMirror(diff.rawJson,'0',true,crypto.randomUUID()).owners!;
        requireParticipant(JSON.stringify(ownerIds)===JSON.stringify(secret.owners),'migration_wrong_account');
        return {ownerIds,sourceHash:secret.hash,raw:diff.rawJson};
      },
      credential:async ref=>{const secret=await this.credentials.read(ref);return {ownerIds:secret.owners,sourceHash:secret.hash};},
      permission:()=>this.options.permission(),
    },()=>this.clock(),this.app.root);
    try{return await work(owner);}finally{owner.close();}
  }
  #restoreView(value:RestoreIntent|null){
    if(!value)return null;const proof=value.preview;
    return {id:value.id,phase:value.phase,sha256:value.archiveSha256,bytes:value.archiveSize,preview:proof?{
      id:proof.id,checkedAt:proof.checkedAt,bankTransactions:proof.bankTransactions,zenTransactions:proof.zenTransactions,
      missingBank:proof.missingBank,extraZen:proof.extraZen,uncheckedAccounts:proof.uncheckedAccounts,
    }:null};
  }
  async status(){
    const file=await this.#file(owner=>owner.current()),backups=await this.#backup(owner=>owner.list());
    const restore=await this.#restore(owner=>owner.current()),sources=await this.#backup(owner=>owner.sources(this.app.root));
    const preparation=await this.#backup(owner=>owner.preparation());
    await this.app.assert(true);
    return {file:file?{id:file.id,phase:file.phase,bytes:file.bytes,chunks:file.chunks,sha256:file.sha256,nonce:file.nonce}:null,
      backups:backups.map(value=>({id:value.id,generation:value.generation,datasetId:value.datasetId,phase:value.phase,
        sha256:value.sha256,bytes:value.bytes,chunks:value.chunks,acknowledged:value.acknowledgedAt!==null})),
      restore:this.#restoreView(restore),sources,preparation:preparation?{id:preparation.id,generation:preparation.generation,phase:preparation.phase}:null};
  }
  uploadBegin(id:string,bytes:number,sha256:string){return this.#file(owner=>owner.begin(id,bytes,sha256));}
  uploadStatus(id:string){return this.#file(owner=>owner.status(id));}
  uploadChunk(id:string,nonce:string,number:number,bytes:Uint8Array){return this.#file(owner=>owner.put(id,nonce,number,bytes));}
  uploadSeal(id:string){return this.#file(owner=>owner.seal(id));}
  async discardUpload(id:string){
    // A file backing a held recovery must survive until its native decision.
    await this.app.assert();return this.#file(async owner=>{await owner.cancel(id);return owner.clean(id);});
  }
  async backupBegin(id:string,generation:string){
    participantUuid(id);participantUuid(generation);await this.app.assert(true);
    const previous=(await this.#backup(owner=>owner.list())).find(value=>value.id===id);
    if(previous){requireParticipant(previous.generation===generation,'migration_invalid');return {state:previous.phase,id};}
    await this.app.assert();const sources=await this.#backup(owner=>owner.sources(this.app.root));
    requireParticipant(sources.some(value=>value.generation===generation),'migration_invalid');
    let expected=this.app.root;
    if(this.app.context.mode==='local'&&generation===this.app.root.activeGeneration){
      await this.#backup(owner=>owner.prepare(id,generation));
      const transfer=await ModeTransfers.open({...this.options,reader:this.reader,expectedRoot:this.app.root});
      try{const result=await transfer.backupRoot(id);if(!result)return {state:'quiescing' as const,id};expected=result;}
      finally{transfer.close();}
    }
    const value=await this.#backup(owner=>owner.begin(id,generation,expected,this.now()));
    return {state:value.phase,id:value.id};
  }
  async backupStep(id:string){
    participantUuid(id);const preparation=await this.#backup(owner=>owner.preparation());
    if(preparation?.id===id&&preparation.phase==='quiescing'){const value=await this.backupBegin(id,preparation.generation);return {...value,state:value.state==='quiescing'?'waiting':value.state};}
    const value=await this.#backup(async owner=>{
      const previous=(await owner.list()).find(value=>value.id===id);requireParticipant(previous!==undefined,'migration_invalid');
      return previous.phase==='building'?owner.build(id):previous;
    });
    return {id:value.id,phase:value.phase,bytes:value.bytes,chunks:value.chunks,sha256:value.sha256};
  }
  async backupChunk(id:string,number:number){const value=await this.#backup(owner=>owner.chunk(id,number));return value.data;}
  async backupAcknowledge(id:string,sha256:string){
    const value=await this.#backup(owner=>owner.acknowledge(id,sha256,this.now()));return {id:value.id,acknowledged:value.acknowledgedAt!==null};
  }
  async backupCancel(id:string){const value=await this.#backup(owner=>owner.cancel(id));return {id:value.id,phase:value.phase};}
  backupClean(id:string){return this.#backup(owner=>owner.clean(id));}
  async restoreBegin(id:string,token:string|null,consent:RestoreConsent){
    participantUuid(id);await this.app.assert();let ref=this.app.context.mode==='local'?this.app.root.credentialRef:null;
    if(token!==null){const candidate=await this.credentials.verifyToken(token);ref=candidate.ref;}
    requireParticipant(ref!==null,'zenmoney_not_configured');await this.app.assert();
    const blob=await this.#file(owner=>owner.blob(id));
    return this.#restoreView(await this.#restore(owner=>owner.begin(id,blob,ref!,consent)));
  }
  async restoreStep(id:string){
    participantUuid(id);const current=await this.#restore(owner=>owner.current());
    requireParticipant(current?.id===id,'migration_invalid');
    if(current.phase==='loading'){
      const blob=await this.#file(owner=>owner.blob(id));return this.#restoreView(await this.#restore(owner=>owner.load(id,blob)));
    }
    if(current.phase==='validated')return this.#restoreView(await this.#restore(owner=>owner.preview(id)));
    return this.#restoreView(current);
  }
  async restorePreview(id:string){return this.#restoreView(await this.#restore(owner=>owner.preview(id)));}
  async restoreAccept(id:string,previewId:string){return this.#restoreView(await this.#restore(owner=>owner.activate(id,previewId,true)));}
  async restoreCancel(id:string){return this.#restoreView(await this.#restore(owner=>owner.cancel(id)));}
  restoreClean(id:string){return this.#restore(owner=>owner.cleanCancelled(id,true));}
}
