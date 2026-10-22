import {TransportRepairOwner} from '../storage/transport-repair.js';
/** Privileged transfer orchestration. Configuration is never writer selection. */
import type {SentinelPort} from '../../control/types.js';
import type {StorageArea} from '../../application/state.js';
import type {MirrorReader} from '../zenmoney/reader.js';
import {CredentialCandidates} from '../zenmoney/candidates.js';
import {RemoteControl} from '../storage/remote-control.js';
import type {RuntimeControl} from '../../control/types.js';
import {MigrationOwner} from '../storage/migration-owner.js';
import {SwitchJournalRepository} from '../storage/switch-journal-repository.js';
import {RouteSelection} from '../storage/route-selection.js';
import type {JoinConsent} from '../storage/route-selection.js';
import {ServerCredentials} from './credentials.js';
import {NativeParticipant,ServerParticipant} from './participants.js';
import {SwitchRunner} from './runner.js';
import {sameJournal} from './journal.js';
import {participantUuid,participantInteger,requireParticipant} from '../../control/participant-wire.js';
interface TransferOptions{
  name:string;sentinel:SentinelPort;persistent:StorageArea;reader:MirrorReader;
  serverPermission(url:string):Promise<boolean>;fetch?:typeof fetch;clock?:()=>number;expectedRoot?:RuntimeControl;
}
export class ModeTransfers{
  readonly serverCredentials:ServerCredentials;
  readonly localCredentials:CredentialCandidates;
  private owner!:MigrationOwner;private journal!:SwitchJournalRepository;private routes!:RouteSelection;
  private constructor(private options:TransferOptions){
    this.serverCredentials=new ServerCredentials(options.persistent,options.serverPermission,options.fetch);
    this.localCredentials=new CredentialCandidates(options.persistent,options.reader,this.clock);
  }
  private clock=()=>Math.floor(this.options.clock?.()??Date.now()/1000);
  #expected(root:RuntimeControl){
    const expected=this.options.expectedRoot;
    requireParticipant(!expected||(!expected.financialMayHaveStarted||root.financialMayHaveStarted)&&
      sameJournal({...root,financialMayHaveStarted:expected.financialMayHaveStarted},expected),'stale_context');
  }
  static async open(options:TransferOptions){
    const self=new ModeTransfers({...options,...(options.expectedRoot?{expectedRoot:structuredClone(options.expectedRoot)}:{})});
    self.journal=await SwitchJournalRepository.open(options.name,options.sentinel);
    try{self.routes=await RouteSelection.open(options.name,options.sentinel);self.owner=await MigrationOwner.open(options.name,options.sentinel,{
      verifyOwner:ref=>self.localCredentials.verifyReference(ref),
      async readPeer(id,switchId){
        const value=await self.journal.current();requireParticipant(value!==null&&value.plan.id===switchId,'migration_paused');
        const plan=value.plan,remoteId=plan.direction==='local-to-remote'?plan.destinationId:plan.sourceId;
        requireParticipant(remoteId===id,'migration_invalid');
        return new ServerParticipant(await self.serverCredentials.client(await self.#transportRef(plan.id,plan.remoteCredentialRef)),id).status(switchId);
      },
    });return self;}catch(error){self.routes?.close();self.journal.close();throw error;}
  }
  /** Stop one capture/recover one expired batch before a separately fenced snapshot. */
  async backupRoot(backupId?:string){
    const {root}=await this.owner.current();this.#expected(root);
    requireParticipant(root.activeMode==='local'&&root.pendingSwitchId===null,'migration_paused');
    if(backupId!==undefined)participantUuid(backupId);
    if(!await this.owner.quiesceLocal(root,String(this.clock()),backupId?{kind:'backup',id:backupId}:undefined))return null;
    const selected=(await this.owner.current()).root;this.#expected(selected);return selected;
  }
  async #transportRef(id:string,originalRef:string,kind:'move'|'local'='move'){
    const owner=await TransportRepairOwner.open(this.options.name,this.options.sentinel);
    try{return await owner.ref(kind,id,originalRef);}finally{owner.close();}
  }
  /** Replace only this transfer's authenticated transport, preserving all commands. */
  async repairServer(id:string,token:string){
    const root=(await this.owner.current()).root;this.#expected(root);
    const owner=await TransportRepairOwner.open(this.options.name,this.options.sentinel);
    try{
      const snapshot=await owner.snapshot('move',id,root),value=await this.journal.current();
      requireParticipant(value!==null&&JSON.stringify(snapshot.record)===JSON.stringify(value),'stale_context');
      const plan=value.plan,old=await this.serverCredentials.read(plan.remoteCredentialRef);
      const originalDataset=plan.direction==='local-to-remote'?(await this.serverCredentials.proof(plan.remoteCredentialRef)).dataset_id:
        (await this.#selectedServer(root)).datasetId;
      const candidate=await this.serverCredentials.verify({url:old.url,token},plan.ownerIds),peer=candidate.identity;
      const remoteId=plan.direction==='local-to-remote'?plan.destinationId!:plan.sourceId;
      requireParticipant(peer.installation_id===remoteId&&[null,id].includes(peer.operation_id),'migration_invalid');
      if(peer.dataset_id!==originalDataset){
        requireParticipant(plan.direction==='local-to-remote','migration_invalid');
        const sealed=value.receipts.find(row=>row.command==='source_seal');
        const state=await new ServerParticipant(await this.serverCredentials.client(candidate.ref),remoteId).status(id);
        const activated=state.receipts.find(row=>row.command==='destination_activate');
        requireParticipant(sealed!==undefined&&activated!==undefined&&activated.peer_id===plan.sourceId&&
          activated.dataset_id===sealed.dataset_id&&peer.dataset_id===sealed.dataset_id&&
          activated.archive_sha256===sealed.archive_sha256&&peer.state==='active'&&peer.operation_id===null,'migration_invalid');
      }
      await owner.install(snapshot,plan.remoteCredentialRef,candidate.ref);return {repaired:true};
    }finally{owner.close();}
  }
  async repairLocal(id:string,token:string){
    const root=(await this.owner.current()).root;this.#expected(root);
    const owner=await TransportRepairOwner.open(this.options.name,this.options.sentinel);
    try{
      const snapshot=await owner.snapshot('local',id,root),value=await this.journal.current();
      requireParticipant(value!==null&&value.plan.direction==='remote-to-local'&&JSON.stringify(snapshot.record)===JSON.stringify(value),'stale_context');
      const candidate=await this.localCredentials.verifyToken(token,value.plan.ownerIds);
      await owner.install(snapshot,value.plan.localCredentialRef,candidate.ref);return {repaired:true};
    }finally{owner.close();}
  }
  async current(){return this.journal.current();}
  async pending(){const value=await this.current();return value!==null&&(!['complete','cancelled'].includes(value.phase)||await this.pendingRepair(value.plan.id))||(await this.routes.current())?.phase==='quiescing';}
  async joinCurrent(){return this.routes.current();}
  async joinServer(id:string,candidateRef:string,consent:JoinConsent){
    participantUuid(id);participantUuid(candidateRef);const previous=await this.routes.current();
    if(previous?.id===id){requireParticipant(previous.credentialRef===candidateRef);return previous;}
    const {root}=await this.owner.current();this.#expected(root);const target=await this.serverCredentials.verifiedCandidate(candidateRef),secret=await this.serverCredentials.read(candidateRef);
    return this.routes.create(root,{id,credentialRef:candidateRef,destination:target,createdAt:String(this.clock()),
      descriptor:{url:secret.url,contextId:secret.contextId,legacy:false,installationId:target.installation_id,datasetId:target.dataset_id}},consent);
  }
  async cancelJoin(id:string){return this.routes.cancel(id);}
  /** Both candidates are freshly checked before the initial Root CAS. */
  async toServer(candidateRef:string){
    participantUuid(candidateRef);const current=await this.owner.current(),root=current.root;this.#expected(root);
    requireParticipant(root.activeMode==='local'&&root.pendingSwitchId===null&&current.participantId!==null&&root.credentialRef!==null,'migration_paused');
    const local=await this.localCredentials.verifyReference(root.credentialRef),remote=await this.serverCredentials.verifiedCandidate(candidateRef,local.ownerIds);
    participantInteger(remote.participant_epoch,(1n<<63n)-4n);
    requireParticipant(remote.can_import&&remote.state==='active'&&!remote.awaiting_sync&&remote.legacy_hold===null,'migration_not_empty');
    return this.journal.create(root,{id:crypto.randomUUID(),direction:'local-to-remote',sourceId:current.participantId,destinationId:remote.installation_id,
      remoteCredentialRef:candidateRef,localCredentialRef:root.credentialRef,ownerIds:[...local.ownerIds]});
  }
  async #selectedServer(root:RuntimeControl){
    requireParticipant(root.credentialRef!==null,'migration_paused');const control=await RemoteControl.open(this.options.name,this.options.sentinel);
    try{
      const descriptor=await control.remoteContext(root),secret=await this.serverCredentials.read(root.credentialRef);
      requireParticipant(descriptor.url===secret.url&&descriptor.contextId===secret.contextId&&descriptor.legacy===secret.legacy,'recovery_required');return descriptor;
    }finally{control.close();}
  }
  /** The UI must explicitly describe the shared-server pause before calling. */
  async toBrowser(candidateRef:string,consent:{pauseSharedServer:boolean;replaceInactiveLocalCopy?:boolean}){
    participantUuid(candidateRef);requireParticipant(consent.pauseSharedServer===true,'migration_paused');
    const {root}=await this.owner.current();this.#expected(root);requireParticipant(root.activeMode==='remote'&&root.pendingSwitchId===null&&root.credentialRef!==null,'migration_paused');
    const descriptor=await this.#selectedServer(root),local=await this.localCredentials.verifyReference(candidateRef),remote=await this.serverCredentials.verifyReference(root.credentialRef,local.ownerIds);
    if(descriptor.installationId!==undefined||descriptor.datasetId!==undefined)requireParticipant(descriptor.installationId===remote.installation_id&&descriptor.datasetId===remote.dataset_id,'migration_invalid');
    participantInteger(remote.participant_epoch,(1n<<63n)-5n);
    requireParticipant(remote.state==='active'&&!remote.awaiting_sync&&remote.legacy_hold===null,'migration_paused');
    const control=await RemoteControl.open(this.options.name,this.options.sentinel);
    try{await control.bindIdentity(root,remote.installation_id,remote.dataset_id);}finally{control.close();}
    return this.journal.create(root,{id:crypto.randomUUID(),direction:'remote-to-local',sourceId:remote.installation_id,destinationId:null,
      remoteCredentialRef:root.credentialRef,localCredentialRef:candidateRef,ownerIds:[...local.ownerIds]},consent.replaceInactiveLocalCopy===true);
  }
  async cancel(id:string,requestId:string){
    participantUuid(id);participantUuid(requestId);const value=await this.journal.current();requireParticipant(value?.plan.id===id,'migration_invalid');
    let observed;
    if(value.plan.direction==='remote-to-local'&&value.commands.some(row=>row.command==='source_start')&&!value.receipts.length){
      observed=await new ServerParticipant(await this.serverCredentials.client(await this.#transportRef(value.plan.id,value.plan.remoteCredentialRef)),value.plan.sourceId).status(id);
    }
    return this.journal.requestCancel(id,requestId,observed);
  }
  /** Explicitly retry one already-owned peer task; never create a new transfer. */
  async retry(id:string){
    participantUuid(id);this.#expected((await this.owner.current()).root);
    const join=await this.routes.current();if(join?.id===id&&join.phase==='quiescing')return this.run(id);
    const value=await this.journal.current();requireParticipant(value?.plan.id===id,'migration_invalid');
    if(['complete','cancelled'].includes(value.phase))return this.run(id);
    if((await this.journal.cancellation(id))?.state==='requested')return this.run(id);
    const plan=value.plan,peerId=plan.direction==='local-to-remote'?plan.destinationId!:plan.sourceId;
    const client=await this.serverCredentials.client(await this.#transportRef(plan.id,plan.remoteCredentialRef)),peer=new ServerParticipant(client,peerId),state=await peer.status(id);
    const task=state.work.find(work=>work.state==='blocked');
    if(!task)return this.run(id);
    this.#expected((await this.owner.current()).root);
    const retried=await client.retry(participantUuid(task.id));
    requireParticipant(retried.switch_id===id&&retried.kind===task.kind,'migration_invalid');
    return {state:'waiting' as const,phase:value.phase};
  }
  async pendingRepair(id:string){
    const owner=await TransportRepairOwner.open(this.options.name,this.options.sentinel);
    try{return (await owner.adoption('move',id))!==null;}finally{owner.close();}
  }
  async finishRepair(id:string){
    const owner=await TransportRepairOwner.open(this.options.name,this.options.sentinel);
    try{await owner.adoptSelected('move',id,this.serverCredentials);}finally{owner.close();}
  }
  async run(expectedId?:string){
    this.#expected((await this.owner.current()).root);
    if(expectedId!==undefined)participantUuid(expectedId);
    const join=await this.routes.current();
    if(join?.phase==='quiescing'){
      requireParticipant(expectedId===undefined||join.id===expectedId,'stale_context');
      if(!await this.owner.quiesceLocal(join.initialRoot,String(this.clock()),{kind:'join',id:join.id}))return {state:'waiting',phase:'source_quiescing'};
      const target=await this.serverCredentials.verifiedCandidate(join.credentialRef,join.destination.owner_ids);
      await this.routes.select(join.id,target);return {state:'complete',phase:'complete'};
    }
    const value=await this.journal.current();
    requireParticipant(!value||expectedId===undefined||value.plan.id===expectedId,'stale_context');
    if(!value||['complete','cancelled'].includes(value.phase)){if(value)await this.finishRepair(value.plan.id);return {state:value?.phase??'idle'};}
    requireParticipant(expectedId===undefined||value.plan.id===expectedId,'stale_context');
    const plan=value.plan,localSource=plan.direction==='local-to-remote',remoteId=localSource?plan.destinationId!:plan.sourceId;
    const client=await this.serverCredentials.client(await this.#transportRef(plan.id,plan.remoteCredentialRef)),remote=new ServerParticipant(client,remoteId);
    const native=(id:string)=>new NativeParticipant(this.owner,id,this.clock);
    const runner=new SwitchRunner(this.journal,{
      sourceDataset:async current=>{
        if(localSource)return null;
        const selected=await this.#selectedServer((await this.owner.current()).root);
        requireParticipant(selected.installationId===current.sourceId&&selected.datasetId!==undefined,'migration_invalid');return selected.datasetId;
      },
      prepare:async current=>{
        const selected=localSource?null:await this.#selectedServer((await this.owner.current()).root);
        const checked=localSource?await this.serverCredentials.verifiedCandidate(await this.#transportRef(current.id,current.remoteCredentialRef),current.ownerIds):
          await this.serverCredentials.verifyReference(await this.#transportRef(current.id,current.remoteCredentialRef),current.ownerIds,current.sourceId);
        requireParticipant(checked.installation_id===remoteId,'migration_invalid');
        if(localSource){requireParticipant(checked.can_import&&checked.state==='active'&&!checked.awaiting_sync&&checked.legacy_hold===null,'migration_not_empty');return null;}
        requireParticipant(checked.state==='active'&&!checked.awaiting_sync&&checked.legacy_hold===null,'migration_paused');
        requireParticipant(selected?.installationId===checked.installation_id&&selected.datasetId===checked.dataset_id,'migration_invalid');
        const localRef=await this.#transportRef(current.id,current.localCredentialRef,'local');
        const proof=await this.localCredentials.verifyReference(localRef);
        requireParticipant(JSON.stringify(proof.ownerIds)===JSON.stringify(current.ownerIds),'migration_wrong_account');
        const reserved=await this.owner.reserveDestination(current.id,current.sourceId,localRef,String(this.clock()));
        return {id:reserved.participantId,generation:reserved.generation};
      },
      quiesce:async current=>{
        const source=localSource?native(current.sourceId):remote,status=await source.status(current.id);
        // A lost source_start response must recover its receipt, not try to stop
        // captures again through a Root which is already durably held.
        if(status.operation_id===current.id&&status.state!=='active')return true;
        if(!localSource)return client.quiesce(current.sourceId,status.participant_epoch);
        const original=(await this.journal.current())!;
        return this.owner.quiesceLocal(original.initialRoot,String(this.clock()),{kind:'switch',id:current.id});
      },
      source:current=>localSource?native(current.sourceId):remote,
      destination:current=>localSource?remote:native(current.destinationId!),
      selectRemote:async current=>{
        const secret=await this.serverCredentials.read(await this.#transportRef(current.id,current.remoteCredentialRef));
        const sealed=(await this.journal.current())!.receipts.find(row=>row.command==='source_seal');requireParticipant(sealed!==undefined);
        await this.owner.selectRemote(current.sourceId,current.id,secret.ref,{url:secret.url,contextId:secret.contextId,legacy:secret.legacy,installationId:current.destinationId!,datasetId:sealed.dataset_id});
      },
    },this.clock);
    const result=await runner.run(plan.id);if(result.state==='complete'||result.state==='cancelled')await this.finishRepair(plan.id);return result;
  }
  close(){this.owner.close();this.journal.close();this.routes.close();}
}
