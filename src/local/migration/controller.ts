/** Privileged transfer orchestration. Configuration is never writer selection. */
import type {SentinelPort} from '../../control/types.js';
import type {StorageArea} from '../../application/state.js';
import type {MirrorReader} from '../zenmoney/reader.js';
import {CredentialCandidates} from '../zenmoney/candidates.js';
import {MigrationOwner} from '../storage/migration-owner.js';
import {SwitchJournalRepository} from '../storage/switch-journal-repository.js';
import {ServerCredentials} from './credentials.js';
import {NativeParticipant,ServerParticipant} from './participants.js';
import {SwitchRunner} from './runner.js';
import {participantUuid,requireParticipant} from '../../control/participant-wire.js';
interface TransferOptions{
  name:string;sentinel:SentinelPort;persistent:StorageArea;reader:MirrorReader;
  serverPermission(url:string):Promise<boolean>;fetch?:typeof fetch;clock?:()=>number;
}
export class ModeTransfers{
  readonly serverCredentials:ServerCredentials;
  readonly localCredentials:CredentialCandidates;
  private owner!:MigrationOwner;private journal!:SwitchJournalRepository;
  private constructor(private options:TransferOptions){
    this.serverCredentials=new ServerCredentials(options.persistent,options.serverPermission,options.fetch);
    this.localCredentials=new CredentialCandidates(options.persistent,options.reader,this.clock);
  }
  private clock=()=>Math.floor(this.options.clock?.()??Date.now()/1000);
  static async open(options:TransferOptions){
    const self=new ModeTransfers(options);
    self.journal=await SwitchJournalRepository.open(options.name,options.sentinel);
    try{self.owner=await MigrationOwner.open(options.name,options.sentinel,{
      verifyOwner:ref=>self.localCredentials.verifyReference(ref),
      async readPeer(id,switchId){
        const value=await self.journal.current();requireParticipant(value!==null&&value.plan.id===switchId,'migration_paused');
        const plan=value.plan,remoteId=plan.direction==='local-to-remote'?plan.destinationId:plan.sourceId;
        requireParticipant(remoteId===id,'migration_invalid');
        return new ServerParticipant(await self.serverCredentials.client(plan.remoteCredentialRef),id).status(switchId);
      },
    });return self;}catch(error){self.journal.close();throw error;}
  }
  async current(){return this.journal.current();}
  async pending(){const value=await this.current();return value!==null&&!['complete','cancelled'].includes(value.phase);}
  /** Both candidates are freshly checked before the initial Root CAS. */
  async toServer(candidateRef:string){
    participantUuid(candidateRef);const current=await this.owner.current(),root=current.root;
    requireParticipant(root.activeMode==='local'&&root.pendingSwitchId===null&&current.participantId!==null&&root.credentialRef!==null,'migration_paused');
    const local=await this.localCredentials.verifyReference(root.credentialRef),remote=await this.serverCredentials.verifiedCandidate(candidateRef,local.ownerIds);
    requireParticipant(remote.can_import&&remote.state==='active'&&!remote.awaiting_sync&&remote.legacy_hold===null,'migration_not_empty');
    return this.journal.create(root,{id:crypto.randomUUID(),direction:'local-to-remote',sourceId:current.participantId,destinationId:remote.installation_id,
      remoteCredentialRef:candidateRef,localCredentialRef:root.credentialRef,ownerIds:[...local.ownerIds]});
  }
  /** The UI must explicitly describe the shared-server pause before calling. */
  async toBrowser(candidateRef:string,consent:{pauseSharedServer:boolean}){
    participantUuid(candidateRef);requireParticipant(consent.pauseSharedServer===true,'migration_paused');
    const {root}=await this.owner.current();requireParticipant(root.activeMode==='remote'&&root.pendingSwitchId===null&&root.credentialRef!==null,'migration_paused');
    const local=await this.localCredentials.verifyReference(candidateRef),remote=await this.serverCredentials.verifyReference(root.credentialRef,local.ownerIds);
    requireParticipant(remote.state==='active'&&!remote.awaiting_sync&&remote.legacy_hold===null,'migration_paused');
    return this.journal.create(root,{id:crypto.randomUUID(),direction:'remote-to-local',sourceId:remote.installation_id,destinationId:null,
      remoteCredentialRef:root.credentialRef,localCredentialRef:candidateRef,ownerIds:[...local.ownerIds]});
  }
  async cancel(id:string,requestId:string){
    participantUuid(id);participantUuid(requestId);const value=await this.journal.current();requireParticipant(value?.plan.id===id,'migration_invalid');
    let observed;
    if(value.plan.direction==='remote-to-local'&&value.commands.some(row=>row.command==='source_start')&&!value.receipts.length){
      observed=await new ServerParticipant(await this.serverCredentials.client(value.plan.remoteCredentialRef),value.plan.sourceId).status(id);
    }
    return this.journal.requestCancel(id,requestId,observed);
  }
  async run(){
    const value=await this.journal.current();if(!value||['complete','cancelled'].includes(value.phase))return {state:value?.phase??'idle'};
    const plan=value.plan,localSource=plan.direction==='local-to-remote',remoteId=localSource?plan.destinationId!:plan.sourceId;
    const client=await this.serverCredentials.client(plan.remoteCredentialRef),remote=new ServerParticipant(client,remoteId);
    const native=(id:string)=>new NativeParticipant(this.owner,id,this.clock);
    const runner=new SwitchRunner(this.journal,{
      prepare:async current=>{
        const checked=localSource?await this.serverCredentials.verifiedCandidate(current.remoteCredentialRef,current.ownerIds):
          await this.serverCredentials.verifyReference(current.remoteCredentialRef,current.ownerIds,current.sourceId);
        requireParticipant(checked.installation_id===remoteId,'migration_invalid');
        if(localSource){requireParticipant(checked.can_import&&checked.state==='active'&&!checked.awaiting_sync&&checked.legacy_hold===null,'migration_not_empty');return null;}
        requireParticipant(checked.state==='active'&&!checked.awaiting_sync&&checked.legacy_hold===null,'migration_paused');
        const proof=await this.localCredentials.verifyReference(current.localCredentialRef);
        requireParticipant(JSON.stringify(proof.ownerIds)===JSON.stringify(current.ownerIds),'migration_wrong_account');
        const reserved=await this.owner.reserveDestination(current.id,current.sourceId,current.localCredentialRef,String(this.clock()));
        return {id:reserved.participantId,generation:reserved.generation};
      },
      quiesce:async current=>{
        const source=localSource?native(current.sourceId):remote,status=await source.status(current.id);
        // A lost source_start response must recover its receipt, not try to stop
        // captures again through a Root which is already durably held.
        if(status.operation_id===current.id&&status.state!=='active')return true;
        if(!localSource)return client.quiesce(current.sourceId,status.participant_epoch);
        const original=(await this.journal.current())!;
        return this.owner.quiesceLocal(original.initialRoot,String(this.clock()));
      },
      source:current=>localSource?native(current.sourceId):remote,
      destination:current=>localSource?remote:native(current.destinationId!),
      selectRemote:async current=>{
        const secret=await this.serverCredentials.read(current.remoteCredentialRef);
        await this.owner.selectRemote(current.sourceId,current.id,secret.ref,{url:secret.url,contextId:secret.contextId,legacy:secret.legacy});
      },
    },this.clock);
    return runner.run(plan.id);
  }
  close(){this.owner.close();this.journal.close();}
}
