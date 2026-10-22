import {assertNoBackupPreparation} from './backup-preparation.js';
/** Snapshot coordination is not writer authority; the server owns its short hold. */
import type {RuntimeControl,SentinelPort} from '../../control/types.js';
import {runtimeControl} from '../../control/validation.js';
import {participantUuid,requireParticipant} from '../../control/participant-wire.js';
import {archiveStatus,backupRequest,backupWithdrawal} from '../migration/archive-wire.js';
import type {ArchiveStatus,ArchiveBackupRequest,RecoveryWithdrawal} from '../migration/archive-wire.js';
import {sameJournal} from '../migration/journal.js';
import {FinancialDatabase} from './database.js';
import {assertAnchor,readAnchor} from './anchor.js';
import {storageFailure} from './types.js';
import {recoveryErrors} from './remote-recovery-selection.js';

const head='remote-backup-head',scope=(id:string)=>'remote-backup:'+id;
export interface RemoteBackupIntent{
  version:'1';id:string;installationId:string;server:{url:string;installationId:string;datasetId:string};
  request:ArchiveBackupRequest;phase:'working'|'ready'|'cleaning'|'complete';
  status:ArchiveStatus|null;downloaded:number;cancelRequested:boolean;ackRequested:boolean;
  decision:'withdrawn'|'downloaded'|null;remoteCleaned:boolean;fileCleaned:boolean;error:string|null;
}
function checked(input:unknown):RemoteBackupIntent{
  requireParticipant(input!==null&&typeof input==='object'&&!Array.isArray(input));const v=input as RemoteBackupIntent;
  requireParticipant(Object.keys(v).sort().join(',')==='ackRequested,cancelRequested,decision,downloaded,error,fileCleaned,id,installationId,phase,remoteCleaned,request,server,status,version'&&v.version==='1');
  for(const id of [v.id,v.installationId,v.server?.installationId,v.server?.datasetId])participantUuid(id);
  requireParticipant(Object.keys(v.server).sort().join(',')==='datasetId,installationId,url'&&typeof v.server.url==='string');
  const request=backupRequest(v.request);requireParticipant(request.id===v.id&&request.installation_id===v.server.installationId);
  requireParticipant(['working','ready','cleaning','complete'].includes(v.phase)&&[null,'withdrawn','downloaded'].includes(v.decision));
  requireParticipant([v.cancelRequested,v.ackRequested,v.remoteCleaned,v.fileCleaned].every(value=>typeof value==='boolean'));
  requireParticipant(Number.isSafeInteger(v.downloaded)&&v.downloaded>=0&&v.downloaded<=256&&(v.error===null||recoveryErrors.has(v.error)));
  if(v.status!==null){const status=archiveStatus(v.status,v.id);requireParticipant(status.kind==='backup'&&status.installation_id===v.server.installationId&&status.dataset_id===v.server.datasetId&&status.initial_epoch===request.expected_epoch);}
  requireParticipant((v.phase==='cleaning'||v.phase==='complete')===(v.decision!==null));
  requireParticipant(v.phase!=='complete'||v.remoteCleaned&&v.fileCleaned);
  requireParticipant(v.phase!=='ready'||v.status?.phase==='ready'&&v.downloaded===Number(v.status.chunks));
  return structuredClone(v);
}
export async function assertNoRemoteBackup(db:FinancialDatabase){
  const id=(await db.applicationState.get(head))?.value.id;
  if(id!==undefined)requireParticipant(checked((await db.applicationState.get(scope(participantUuid(id))))?.value).phase==='complete','migration_busy');
}
export async function assertRemoteBackupFile(db:FinancialDatabase,permit?:string,cleanup=false){
  const id=(await db.applicationState.get(head))?.value.id;if(id===undefined){requireParticipant(permit===undefined,'migration_paused');return;}
  const value=checked((await db.applicationState.get(scope(participantUuid(id))))?.value);
  requireParticipant(permit===undefined?value.phase==='complete':permit===id&&(cleanup?value.phase==='cleaning':value.phase==='working'&&!value.cancelRequested),'migration_paused');
}
export class RemoteBackupOwner{
  private constructor(private db:FinancialDatabase,private sentinel:SentinelPort,private expected:RuntimeControl){}
  static async open(name:string,sentinel:SentinelPort,expected:RuntimeControl){
    const captured=structuredClone(runtimeControl(expected)),marker=await readAnchor(sentinel),db=new FinancialDatabase(name,false);
    try{await db.open();await db.transaction('r',db.runtime,db.datasets,()=>assertAnchor(db,marker));return new RemoteBackupOwner(db,sentinel,captured);}
    catch(error){db.close();throw storageFailure(error);}
  }
  close(){this.db.close();}
  async #unit<T>(write:boolean,work:(root:RuntimeControl)=>Promise<T>){
    const marker=await readAnchor(this.sentinel);
    try{return await this.db.transaction(write?'rw':'r',this.db.tables,async()=>{
      const root=await assertAnchor(this.db,marker),expected=this.expected;
      requireParticipant((!expected.financialMayHaveStarted||root.financialMayHaveStarted)&&
        sameJournal({...root,financialMayHaveStarted:expected.financialMayHaveStarted},expected),'stale_context');return work(root);
    });}catch(error){if(error&&typeof error==='object'&&'code'in error)throw error;throw storageFailure(error);}
  }
  async #read(id:string){participantUuid(id);return checked((await this.db.applicationState.get(scope(id)))?.value);}
  async #save(v:RemoteBackupIntent){await this.db.applicationState.put({scope:scope(v.id),value:checked(v) as unknown as Record<string,unknown>});}
  async #guard(root:RuntimeControl,v:RemoteBackupIntent){
    requireParticipant(root.installationId===v.installationId&&root.activeMode==='remote'&&root.pendingSwitchId===null&&root.credentialRef!==null,'stale_context');
    const server=await this.db.remoteContexts.get(root.credentialRef);
    // A freshly repaired token may continue the same physical server/dataset.
    requireParticipant(server?.url===v.server.url&&server.installationId===v.server.installationId&&server.datasetId===v.server.datasetId,'stale_context');
    requireParticipant((await this.db.applicationState.get(head))?.value.id===v.id,'stale_context');
  }
  async current(){return this.#unit(false,async()=>{const id=(await this.db.applicationState.get(head))?.value.id;return id===undefined?null:this.#read(participantUuid(id));});}
  async begin(request:ArchiveBackupRequest){
    const input=backupRequest(request);await this.sentinel.markFinancialActivity(this.expected.installationId);
    return this.#unit(true,async root=>{
      requireParticipant(root.activeMode==='remote'&&root.pendingSwitchId===null&&root.credentialRef!==null,'migration_paused');
      const existing=(await this.db.applicationState.get(scope(input.id)))?.value;
      if(existing){const v=checked(existing);await this.#guard(root,v);requireParticipant(sameJournal(v.request,input));return v;}
      await assertNoRemoteBackup(this.db);await assertNoBackupPreparation(this.db);
      for(const [pointer,prefix,terminal] of [
        ['mode-switch-head','mode-switch:',['complete','cancelled']],['mode-join-head','mode-join:',['complete','cancelled']],
        ['local-backup-head','local-backup:',['ready','cancelled','cleaned']],['archive-restore-head','archive-restore:',['activated','cancelled']],
        ['remote-recovery-head','remote-recovery:',['activated','cancelled']],
      ] as const){const id=(await this.db.applicationState.get(pointer))?.value.id;
        if(typeof id==='string')requireParticipant(terminal.includes((await this.db.applicationState.get(prefix+id))?.value.phase as never),'migration_busy');}
      const file=(await this.db.applicationState.get('archive-file-head'))?.value.id;
      if(typeof file==='string')requireParticipant((await this.db.applicationState.get('archive-file:'+file))?.value.phase==='cleaned','migration_busy');
      const descriptor=await this.db.remoteContexts.get(root.credentialRef);
      requireParticipant(descriptor?.installationId===input.installation_id&&descriptor.datasetId!==undefined,'server_verification_required');
      const v=checked({version:'1',id:input.id,installationId:root.installationId,
        server:{url:descriptor.url,installationId:descriptor.installationId,datasetId:descriptor.datasetId},request:input,
        phase:'working',status:null,downloaded:0,cancelRequested:false,ackRequested:false,decision:null,remoteCleaned:false,fileCleaned:false,error:null});
      await this.#save(v);await this.db.applicationState.put({scope:head,value:{id:v.id}});
      await this.db.runtime.put({...root,financialMayHaveStarted:true});return v;
    });
  }
  async pending(id:string){return this.#unit(false,async root=>{const v=await this.#read(id);if(v.phase!=='complete')await this.#guard(root,v);return v;});}
  async #change(id:string,work:(v:RemoteBackupIntent)=>RemoteBackupIntent){return this.#unit(true,async root=>{
    const v=await this.#read(id);await this.#guard(root,v);const next=work(v);await this.#save(next);return next;
  });}
  observe(id:string,input:ArchiveStatus){return this.#change(id,v=>{
    requireParticipant(v.phase==='working'&&!v.cancelRequested&&v.decision===null,'migration_paused');
    const status=archiveStatus(input,id);requireParticipant(status.kind==='backup'&&status.installation_id===v.server.installationId&&status.dataset_id===v.server.datasetId&&status.initial_epoch===v.request.expected_epoch,'migration_invalid');
    requireParticipant(v.status?.archive_sha256===null||v.status===null||v.status.archive_sha256===status.archive_sha256&&v.status.archive_size===status.archive_size,'migration_invalid');
    return {...v,status,error:null};
  });}
  received(id:string,number:number){return this.#change(id,v=>{
    requireParticipant(v.phase==='working'&&!v.cancelRequested&&Number.isSafeInteger(number)&&number>=0&&number<=v.downloaded&&number<Number(v.status?.chunks),'migration_invalid');
    return {...v,downloaded:Math.max(v.downloaded,number+1),error:null};
  });}
  ready(id:string){return this.#change(id,v=>{requireParticipant(!v.cancelRequested&&v.phase==='working'&&v.status?.phase==='ready'&&v.downloaded===Number(v.status.chunks),'migration_incomplete');return {...v,phase:'ready',error:null};});}
  acknowledge(id:string,checksum:string){return this.#change(id,v=>{requireParticipant(!v.cancelRequested&&v.phase==='ready'&&v.status?.archive_sha256===checksum,'migration_incomplete');return {...v,ackRequested:true,error:null};});}
  cancel(id:string){return this.#change(id,v=>{requireParticipant(v.decision===null,'migration_paused');return {...v,cancelRequested:true,error:null};});}
  withdrawn(id:string,input:RecoveryWithdrawal){return this.#change(id,v=>{
    const proof=backupWithdrawal(input,v.request);requireParticipant(v.cancelRequested&&v.decision===null&&proof.dataset_id===v.server.datasetId&&BigInt(proof.participant_epoch)>=BigInt(v.request.expected_epoch),'migration_invalid');
    return {...v,decision:'withdrawn',phase:'cleaning',error:null};
  });}
  acknowledged(id:string,input:ArchiveStatus){return this.#change(id,v=>{
    const status=archiveStatus(input,id);requireParticipant(v.ackRequested&&!v.cancelRequested&&v.decision===null&&status.kind==='backup'&&status.phase==='ready'&&status.installation_id===v.server.installationId&&status.dataset_id===v.server.datasetId&&status.initial_epoch===v.request.expected_epoch&&status.archive_sha256===v.status?.archive_sha256&&status.acknowledged_at!==null,'migration_invalid');
    return {...v,status,decision:'downloaded',phase:'cleaning',error:null};
  });}
  cleaned(id:string,side:'remote'|'file'){return this.#change(id,v=>{
    requireParticipant(v.phase==='cleaning','migration_paused');const next={...v,[side==='remote'?'remoteCleaned':'fileCleaned']:true,error:null};
    if(next.remoteCleaned&&next.fileCleaned)next.phase='complete';return next;
  });}
  failed(id:string,error:string){requireParticipant(recoveryErrors.has(error));return this.#change(id,v=>v.phase==='complete'?v:({...v,error}));}
}
