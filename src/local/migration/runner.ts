/** One bounded durable migration step per wake; never a financial API writer. */
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {storageFailure} from '../storage/types.js';
import {requireParticipant,ParticipantError} from '../../control/participant-wire.js';
import type {ParticipantReceipt} from '../../control/participant-wire.js';
import type {SwitchJournalRepository,SwitchLease} from '../storage/switch-journal-repository.js';
import type {JournalCommand,Side,SwitchJournal,SwitchPlan,SwitchPhase} from './journal.js';
import type {PortableStatus} from './wire.js';
export interface LiveParticipant{
  /** Must authenticate the same saved participant, not just parse a receipt hash. */
  status(switchId:string):Promise<PortableStatus>;
  command(command:Exclude<JournalCommand['command'],'finalize'>,request:Record<string,unknown>):Promise<ParticipantReceipt|null>;
  seal(switchId:string):Promise<ParticipantReceipt|null>;
  finalize(request:Record<string,unknown>):Promise<boolean>;
  download(switchId:string,number:number):Promise<Uint8Array>;
  upload(switchId:string,epoch:string,number:number,bytes:Uint8Array):Promise<unknown>;
}
export interface SwitchPorts{
  /** Fresh identity/eligibility checks; may reserve a new native destination. */
  prepare(plan:SwitchPlan):Promise<{id:string;generation:string}|null>;
  /** At most one bounded capture-stop/recovery unit; never dispatch a new send. */
  quiesce(plan:SwitchPlan):Promise<boolean>;
  source(plan:SwitchPlan):LiveParticipant;
  destination(plan:SwitchPlan):LiveParticipant;
  /** Idempotently select the verified remote reference after source handoff. */
  selectRemote(plan:SwitchPlan):Promise<void>;
}
export interface SwitchProgress{state:'idle'|'busy'|'progress'|'waiting'|'blocked'|'complete'|'cancelled';phase?:SwitchPhase;code?:string}
const stable=new Set(['migration_busy','migration_paused','migration_not_empty','migration_invalid','migration_wrong_account','migration_incomplete','zenmoney_unavailable','backend_unavailable','unauthorized','permission_required','quota_exceeded','recovery_required']);
export class SwitchRunner{
  constructor(private journal:SwitchJournalRepository,private ports:SwitchPorts,private clock=()=>Math.floor(Date.now()/1000)){}
  #now(){return String(Math.floor(this.clock()));}
  #participant(value:SwitchJournal,side:Side){return side==='source'?this.ports.source(value.plan):this.ports.destination(value.plan);}
  #proof(value:SwitchJournal,command:string){const proof=value.receipts.find(row=>row.command===command);requireParticipant(proof!==undefined,'migration_incomplete');return proof;}
  async #status(value:SwitchJournal,side:Side){
    const status=await this.#participant(value,side).status(value.plan.id);
    requireParticipant(status.installation_id===(side==='source'?value.plan.sourceId:value.plan.destinationId));
    return status;
  }
  async #command(value:SwitchJournal,lease:SwitchLease,side:Side,command:Exclude<JournalCommand['command'],'finalize'>,peer?:ParticipantReceipt){
    const status=await this.#status(value,side),request=await this.journal.command(lease,side,command,status.participant_epoch,this.#now(),peer);
    const known=status.receipts.find(proof=>proof.request_id===request.request_id);
    if(known){await this.journal.accept(lease,known,this.#now());return true;}
    const work=status.work.find(work=>work.id===request.request_id);
    if(work?.state==='blocked')throw new ParticipantError(String(work.error_code??'migration_incomplete'));
    if(work?.state==='queued'||work?.state==='running')return false;
    const result=await this.#participant(value,side).command(command,request);
    if(result===null)return false;
    await this.journal.accept(lease,result,this.#now());return true;
  }
  async #advance(lease:SwitchLease,phase:SwitchPhase){await this.journal.advance(lease,phase,this.#now());return 'progress' as const;}
  async #step(value:SwitchJournal,lease:SwitchLease):Promise<SwitchProgress['state']>{
    const plan=value.plan;
    if(value.phase==='requested'){
      const reserved=await this.ports.prepare(plan);
      if(plan.direction==='remote-to-local'&&plan.destinationId===null){requireParticipant(reserved!==null);await this.journal.reserve(lease,reserved.id,reserved.generation,this.#now());return 'progress';}
      return this.#advance(lease,'destination_checked');
    }
    if(value.phase==='destination_checked')return this.#advance(lease,'source_quiescing');
    if(value.phase==='source_quiescing'){
      if(!await this.ports.quiesce(plan))return 'waiting';
      return await this.#command(value,lease,'source','source_start')?this.#advance(lease,'source_paused'):'waiting';
    }
    if(value.phase==='source_paused'){
      const source=this.ports.source(plan),status=await this.#status(value,'source');
      const blocked=status.work.find(work=>work.kind==='snapshot'&&work.state==='blocked');
      if(blocked)throw new ParticipantError(String(blocked.error_code??'migration_incomplete'));
      const sealed=status.receipts.find(proof=>proof.command==='source_seal')??await source.seal(plan.id);
      if(!sealed)return 'waiting';
      await this.journal.accept(lease,sealed,this.#now());return this.#advance(lease,'export_ready');
    }
    if(value.phase==='export_ready')return await this.#command(value,lease,'destination','destination_start',this.#proof(value,'source_seal'))?this.#advance(lease,'importing'):'waiting';
    if(value.phase==='importing'){
      const sealed=this.#proof(value,'source_seal');requireParticipant(sealed.archive_size!==null);
      const count=Math.ceil(Number(sealed.archive_size)/262144),destination=this.ports.destination(plan),status=await this.#status(value,'destination');
      if(value.chunks.length<count){
        const number=value.chunks.length,bytes=await this.ports.source(plan).download(plan.id,number);
        requireParticipant(bytes instanceof Uint8Array&&bytes.length===Math.min(262144,Number(sealed.archive_size)-number*262144));
        await destination.upload(plan.id,status.participant_epoch,number,bytes);
        await this.journal.chunk(lease,number,bytesToHex(sha256(bytes)),this.#now());return 'progress';
      }
      const request=await this.journal.command(lease,'destination','finalize',status.participant_epoch,this.#now());
      if(!await destination.finalize(request))return 'waiting';
      return await this.#command(value,lease,'destination','destination_arm')?this.#advance(lease,'destination_verified'):'waiting';
    }
    if(value.phase==='destination_verified')return await this.#command(value,lease,'source','source_handoff',this.#proof(value,'destination_arm'))?this.#advance(lease,'source_handed_off'):'waiting';
    if(value.phase==='source_handed_off'){
      if(plan.direction==='local-to-remote')await this.ports.selectRemote(plan);
      else if(!await this.#command(value,lease,'destination','destination_activate',this.#proof(value,'source_handoff')))return 'waiting';
      return this.#advance(lease,'active_pointer_committed');
    }
    if(value.phase==='active_pointer_committed'){
      if(plan.direction==='local-to-remote'&&!await this.#command(value,lease,'destination','destination_activate',this.#proof(value,'source_handoff')))return 'waiting';
      return this.#advance(lease,'destination_activated');
    }
    if(value.phase==='destination_activated'){await this.#advance(lease,'complete');return 'complete';}
    return 'complete';
  }
  async #cancel(value:SwitchJournal,lease:SwitchLease):Promise<SwitchProgress['state']>{
    const plan=value.plan,status=await this.#status(value,'source');
    if(plan.direction==='remote-to-local'&&status.operation_id!==plan.id&&value.receipts.length===0){
      const cancellation=await this.journal.cancellation(plan.id);requireParticipant(cancellation!==null);
      if(await this.journal.requestCancel(plan.id,cancellation.requestId,status)==='cancelled')return 'cancelled';
    }
    const intended=value.commands.find(row=>row.command==='source_handoff');
    const handed=intended?status.receipts.find(proof=>proof.request_id===intended.request.request_id):undefined;
    if(handed){
      await this.journal.accept(lease,handed,this.#now());await this.journal.recoverForward(lease,this.#now());return 'progress';
    }
    requireParticipant(status.state!=='handed_off','migration_paused');
    if(plan.destinationId===null){
      const reserved=await this.ports.prepare(plan);requireParticipant(reserved!==null);
      await this.journal.reserve(lease,reserved.id,reserved.generation,this.#now());return 'progress';
    }
    if(!value.receipts.some(proof=>proof.command==='source_start')){
      if(!await this.ports.quiesce(plan))return 'waiting';
      return await this.#command(value,lease,'source','source_start')?'progress':'waiting';
    }
    if(!value.receipts.some(proof=>proof.command==='source_cancel')){
      const saved=value.commands.find(row=>row.command==='source_cancel');
      if(saved&&BigInt(status.participant_epoch)>BigInt(saved.request.expected_epoch as string)&&!status.receipts.some(proof=>proof.request_id===saved.request.request_id)){
        await this.journal.rebaseRejected(lease,'source','source_cancel',status,this.#now());return 'progress';
      }
      return await this.#command(value,lease,'source','source_cancel')?'progress':'waiting';
    }
    if(!value.receipts.some(proof=>proof.command==='destination_discard')){
      const destination=await this.#status(value,'destination'),saved=value.commands.find(row=>row.command==='destination_discard');
      if(saved&&BigInt(destination.participant_epoch)>BigInt(saved.request.expected_epoch as string)&&!destination.receipts.some(proof=>proof.request_id===saved.request.request_id)){
        await this.journal.rebaseRejected(lease,'destination','destination_discard',destination,this.#now());return 'progress';
      }
      return await this.#command(value,lease,'destination','destination_discard',this.#proof(value,'source_cancel'))?'progress':'waiting';
    }
    if(!value.receipts.some(proof=>proof.command==='source_resume'))return await this.#command(value,lease,'source','source_resume',this.#proof(value,'destination_discard'))?'progress':'waiting';
    await this.journal.finishCancel(lease,this.#now());return 'cancelled';
  }
  async run(expectedId?:string):Promise<SwitchProgress>{
    const value=await this.journal.current();if(!value)return {state:'idle'};
    if(expectedId!==undefined&&value.plan.id!==expectedId)return {state:'busy',code:'migration_busy'};
    if(value.phase==='complete'||value.phase==='cancelled')return {state:value.phase,phase:value.phase};
    const lease=await this.journal.claim(value.plan.id,this.#now());if(!lease)return {state:'busy',phase:value.phase};
    let error:string|null=null;
    try{
      const current=await this.journal.current();requireParticipant(current?.lease?.id===lease.id,'migration_busy');
      const cancellation=await this.journal.cancellation(value.plan.id);
      const state=await (cancellation?.state==='requested'?this.#cancel(current,lease):this.#step(current,lease)),updated=await this.journal.current();return {state,phase:updated!.phase};
    }catch(failure){
      const code=(failure as {code?:unknown})?.code;error=typeof code==='string'&&stable.has(code)?code:storageFailure(failure).code==='quota_exceeded'?'quota_exceeded':'migration_incomplete';return error==='migration_busy'?{state:'waiting',phase:value.phase}:{state:'blocked',phase:value.phase,code:error};
    }finally{
      // A late owner may not clear a replacement lease. A failed release leaves
      // durable expiry recovery rather than pretending the operation completed.
      try{await this.journal.release(lease,this.#now(),error);}catch{}
    }
  }
}
