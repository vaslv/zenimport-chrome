/** Durable coordinator ownership. This journal never grants financial authority. */
import type {RuntimeControl,SentinelPort} from '../../control/types.js';
import {participantUuid,participantInteger,participantDigest,requireParticipant,checkPeerReceipt} from '../../control/participant-wire.js';
import type {ParticipantReceipt} from '../../control/participant-wire.js';
import {FinancialDatabase} from './database.js';
import {readAnchor,assertAnchor} from './anchor.js';
import {datasetControl} from '../../control/validation.js';
import {int64} from './types.js';
import {participantControl} from './participant-validation.js';
import {switchPlan,switchJournal,sameJournal,advancePhase,commandRequest} from '../migration/journal.js';
import type {SwitchPlan,SwitchJournal,SwitchPhase,Side,JournalCommand} from '../migration/journal.js';
import {receipt,status as checkedStatus} from '../migration/wire.js';
const head='mode-switch-head',scope=(id:string)=>'mode-switch:'+id,cancelScope=(id:string)=>'mode-switch-cancel:'+id;
export interface SwitchLease{id:string;switchId:string}
const nowText=(now:string)=>participantInteger(now,9223372036854775507n,0n);
const cloneRecord=(value:SwitchJournal)=>value as unknown as Record<string,unknown>;
export class SwitchJournalRepository{
  private constructor(private db:FinancialDatabase,private sentinel:SentinelPort){}
  static async open(name:string,sentinel:SentinelPort){
    const marker=await readAnchor(sentinel),db=new FinancialDatabase(name,false);
    try{await db.open();await db.transaction('r',db.runtime,db.datasets,()=>assertAnchor(db,marker));return new SwitchJournalRepository(db,sentinel);}catch(error){db.close();throw error;}
  }
  async current(){
    const marker=await readAnchor(this.sentinel);return this.db.transaction('r',this.db.tables,async()=>{
      await assertAnchor(this.db,marker);const pointer=(await this.db.applicationState.get(head))?.value;
      if(pointer===undefined)return null;
      requireParticipant(Object.keys(pointer).join(',')==='id');const id=participantUuid(pointer.id);
      const journal=switchJournal((await this.db.applicationState.get(scope(id)))?.value);requireParticipant(journal.plan.id===id);return journal;
    });
  }
  async create(expected:RuntimeControl,input:SwitchPlan){
    const plan=switchPlan(input),marker=await readAnchor(this.sentinel);
    return this.db.transaction('rw',this.db.tables,async()=>{
      const root=await assertAnchor(this.db,marker);requireParticipant(sameJournal(root,expected)&&root.pendingSwitchId===null,'migration_busy');
      const pointer=(await this.db.applicationState.get(head))?.value;
      if(pointer){
        const previous=switchJournal((await this.db.applicationState.get(scope(participantUuid(pointer.id))))?.value);
        if(previous.plan.id===plan.id){requireParticipant(sameJournal(previous.plan,plan)&&sameJournal(previous.initialRoot,expected));return previous;}
        requireParticipant(['complete','cancelled'].includes(previous.phase),'migration_busy');
      }
      if(plan.direction==='local-to-remote'){
        requireParticipant(root.activeMode==='local'&&root.activeGeneration!==null&&root.credentialRef===plan.localCredentialRef,'migration_busy');
        const dataset=datasetControl(await this.db.datasets.get(root.activeGeneration)),participant=participantControl(await this.db.participants.get(dataset.participantId));
        requireParticipant(dataset.participantId===plan.sourceId&&dataset.lifecycle==='active'&&dataset.holdId===null&&participant.state==='active'&&!participant.awaitingSync&&participant.epoch===dataset.participantEpoch,'migration_paused');
        requireParticipant(sameJournal(dataset.ownerIds,plan.ownerIds),'migration_wrong_account');
      }else{requireParticipant(root.activeMode==='remote'&&root.credentialRef===plan.remoteCredentialRef,'migration_busy');requireParticipant(plan.destinationId===null);}
      const value=switchJournal({version:1,plan,initialRoot:root,phase:'requested',revision:'1',lease:null,destinationGeneration:null,commands:[],receipts:[],chunks:[],error:null});
      // add preserves every prior decision if a caller tries reusing an old ID.
      await this.db.applicationState.add({scope:scope(plan.id),value:cloneRecord(value)});
      await this.db.applicationState.put({scope:head,value:{id:plan.id}});return value;
    });
  }
  async #root(value:SwitchJournal,root:RuntimeControl){
    const initial=value.initialRoot;
    requireParticipant(initial.installationId===root.installationId&&(!initial.financialMayHaveStarted||root.financialMayHaveStarted),'migration_busy');
    const comparable={...root,financialMayHaveStarted:initial.financialMayHaveStarted};
    if(sameJournal(comparable,initial))return;
    const transfer=await this.db.switches.get(value.plan.id),local=value.plan.direction==='remote-to-local';
    requireParticipant(transfer!==undefined&&transfer.role===(local?'destination':'source')&&transfer.previousMode===initial.activeMode&&transfer.previousGeneration===initial.activeGeneration&&transfer.peerId===(local?value.plan.sourceId:value.plan.destinationId),'migration_busy');
    if(local){
      const dataset=datasetControl(await this.db.datasets.get(transfer.generation));
      requireParticipant(value.plan.destinationId===null||value.plan.destinationId===dataset.participantId&&value.destinationGeneration===transfer.generation,'migration_busy');
    }else requireParticipant(transfer.generation===initial.activeGeneration,'migration_busy');
    let expected:RuntimeControl;
    if(transfer.state==='pending')requireParticipant(transfer.credentialRef===(local?value.plan.localCredentialRef:null),'migration_busy');
    else if(transfer.state==='local'||transfer.state==='remote')requireParticipant(transfer.credentialRef===(local?value.plan.localCredentialRef:value.plan.remoteCredentialRef),'migration_busy');
    if(transfer.state==='pending')expected={...initial,pendingSwitchId:value.plan.id,epoch:int64(String(BigInt(initial.epoch)+1n))};
    else if(transfer.state==='cancelled')expected={...initial,epoch:int64(String(BigInt(initial.epoch)+2n))};
    else{
      requireParticipant(transfer.state===(local?'local':'remote')&&value.receipts.some(proof=>proof.command==='source_handoff'),'migration_busy');
      expected={...initial,activeMode:local?'local':'remote',activeGeneration:local?transfer.generation:null,pendingSwitchId:null,
        epoch:int64(String(BigInt(initial.epoch)+2n)),credentialRef:local?value.plan.localCredentialRef:value.plan.remoteCredentialRef,
        credentialEpoch:int64(String(BigInt(initial.credentialEpoch)+1n))};
    }
    requireParticipant(sameJournal(comparable,expected)&&transfer.routingEpoch===(transfer.state==='pending'?expected.epoch:transfer.state==='cancelled'?int64(String(BigInt(initial.epoch)+1n)):expected.epoch),'migration_busy');
  }
  async claim(id:string,now:string):Promise<SwitchLease|null>{
    participantUuid(id);const at=nowText(now),marker=await readAnchor(this.sentinel);
    return this.db.transaction('rw',this.db.tables,async()=>{
      const root=await assertAnchor(this.db,marker);requireParticipant((await this.db.applicationState.get(head))?.value.id===id,'migration_busy');
      const value=switchJournal((await this.db.applicationState.get(scope(id)))?.value);
      await this.#root(value,root);
      if(['complete','cancelled'].includes(value.phase)||value.lease!==null&&BigInt(value.lease.deadline)>at)return null;
      const lease={id:crypto.randomUUID(),deadline:String(at+300n)};
      await this.db.applicationState.put({scope:scope(id),value:cloneRecord(switchJournal({...value,revision:String(BigInt(value.revision)+1n),lease}))});
      return {id:lease.id,switchId:id};
    });
  }
  async #unit<T>(lease:SwitchLease,now:string,work:(value:SwitchJournal,root:RuntimeControl)=>{value:SwitchJournal;result:T}|Promise<{value:SwitchJournal;result:T}>){
    participantUuid(lease.id);participantUuid(lease.switchId);const at=nowText(now),marker=await readAnchor(this.sentinel);
    return this.db.transaction('rw',this.db.tables,async()=>{
      const root=await assertAnchor(this.db,marker);requireParticipant(root.pendingSwitchId===null||root.pendingSwitchId===lease.switchId,'migration_busy');
      requireParticipant((await this.db.applicationState.get(head))?.value.id===lease.switchId,'migration_busy');
      const value=switchJournal((await this.db.applicationState.get(scope(lease.switchId)))?.value);
      await this.#root(value,root);
      requireParticipant(value.initialRoot.installationId===root.installationId&&value.lease?.id===lease.id&&BigInt(value.lease.deadline)>at,'migration_busy');
      const next=await work(structuredClone(value),root);
      const checked=switchJournal({...next.value,revision:String(BigInt(value.revision)+1n)});
      requireParticipant(sameJournal(checked.initialRoot,value.initialRoot)&&checked.plan.id===value.plan.id);
      await this.#root(checked,root);
      await this.db.applicationState.put({scope:scope(lease.switchId),value:cloneRecord(checked)});return structuredClone(next.result);
    });
  }
  async cancellation(id:string){
    participantUuid(id);const marker=await readAnchor(this.sentinel);
    return this.db.transaction('r',this.db.runtime,this.db.datasets,this.db.applicationState,async()=>{
      await assertAnchor(this.db,marker);const value=(await this.db.applicationState.get(cancelScope(id)))?.value;
      if(value===undefined)return null;
      requireParticipant(Object.keys(value).sort().join(',')==='requestId,state'&&['requested','forward','finished'].includes(value.state as string));participantUuid(value.requestId);
      return value as {requestId:string;state:'requested'|'forward'|'finished'};
    });
  }
  async requestCancel(id:string,requestId:string){
    participantUuid(id);participantUuid(requestId);const marker=await readAnchor(this.sentinel);
    return this.db.transaction('rw',this.db.tables,async()=>{
      const root=await assertAnchor(this.db,marker);requireParticipant((await this.db.applicationState.get(head))?.value.id===id,'migration_busy');
      const value=switchJournal((await this.db.applicationState.get(scope(id)))?.value);
      if(['complete','cancelled'].includes(value.phase))return value.phase;
      const previous=(await this.db.applicationState.get(cancelScope(id)))?.value;
      if(previous){requireParticipant(['requested','forward','finished'].includes(previous.state as string));return previous.state;}
      const native=await this.db.switches.get(id),unused=value.commands.length===0&&value.receipts.length===0&&native===undefined&&root.pendingSwitchId!==id;
      if(!unused)await this.#root(value,root);
      const forward=value.receipts.some(proof=>proof.command==='source_handoff');
      const next=switchJournal({...value,phase:unused?'cancelled':value.phase,lease:null,revision:String(BigInt(value.revision)+1n)});
      await this.db.applicationState.put({scope:scope(id),value:cloneRecord(next)});
      await this.db.applicationState.put({scope:cancelScope(id),value:{requestId,state:unused?'finished':forward?'forward':'requested'}});
      return unused?'cancelled':forward?'forward':'requested';
    });
  }
  /** An obsolete CAS is replaceable only after permanent epoch advancement proves
   * it cannot have committed and can never commit later. Keep its exact audit. */
  async rebaseRejected(lease:SwitchLease,side:Side,command:'source_cancel'|'destination_discard',input:unknown,now:string){
    return this.#unit(lease,now,async value=>{
      const observed=checkedStatus(input,value.plan.id),cancel=(await this.db.applicationState.get(cancelScope(value.plan.id)))?.value;
      requireParticipant(cancel?.state==='requested'&&(command==='source_cancel'?side==='source':side==='destination'));
      requireParticipant(observed.installation_id===(side==='source'?value.plan.sourceId:value.plan.destinationId));
      requireParticipant(side==='source'?observed.state==='export_hold':['import_hold','armed'].includes(observed.state));
      const old=value.commands.find(row=>row.side===side&&row.command===command);requireParticipant(old!==undefined);
      requireParticipant(!value.receipts.some(row=>row.command===command)&&!observed.receipts.some(row=>row.request_id===old.request.request_id));
      const before=BigInt(old.request.expected_epoch as string),after=BigInt(observed.participant_epoch);
      requireParticipant(after>before&&after-before<=2n);
      const changes=observed.receipts.filter(proof=>BigInt(proof.participant_epoch)>before&&BigInt(proof.participant_epoch)<=after)
        .sort((a,b)=>BigInt(a.participant_epoch)<BigInt(b.participant_epoch)?-1:1);
      const allowed=side==='source'?['source_seal']:['destination_start','destination_arm'];
      requireParticipant(changes.length===Number(after-before)&&changes.every((proof,index)=>allowed.includes(proof.command)&&BigInt(proof.participant_epoch)===before+BigInt(index)+1n));
      const proofs=[...value.receipts];
      for(const proof of changes){const prior=proofs.find(row=>row.command===proof.command);if(prior)requireParticipant(sameJournal(prior,proof));else proofs.push(proof);}
      const request=commandRequest(side,command,{...old.request,request_id:crypto.randomUUID(),expected_epoch:observed.participant_epoch});
      await this.db.applicationState.add({scope:'mode-switch-rejected:'+value.plan.id+':'+old.request.request_id,
        value:{side,command,request:old.request,reason:'superseded_epoch',observedEpoch:observed.participant_epoch,replacementId:request.request_id}});
      return {value:{...value,receipts:proofs,commands:value.commands.map(row=>row===old?{...row,request}:row)},result:request};
    });
  }
  async finishCancel(lease:SwitchLease,now:string){return this.#unit(lease,now,async value=>{
    requireParticipant(value.receipts.some(proof=>proof.command==='source_resume'),'migration_incomplete');
    const cancel=(await this.db.applicationState.get(cancelScope(value.plan.id)))?.value;requireParticipant(cancel?.state==='requested');
    await this.db.applicationState.put({scope:cancelScope(value.plan.id),value:{...cancel,state:'finished'}});
    return {value:{...value,phase:'cancelled',error:null},result:true};
  });}
  async recoverForward(lease:SwitchLease,now:string){return this.#unit(lease,now,async value=>{
    requireParticipant(value.receipts.some(proof=>proof.command==='source_handoff'),'migration_incomplete');
    const cancel=(await this.db.applicationState.get(cancelScope(value.plan.id)))?.value;requireParticipant(cancel?.state==='requested');
    await this.db.applicationState.put({scope:cancelScope(value.plan.id),value:{...cancel,state:'forward'}});
    return {value:{...value,phase:'source_handed_off',error:null},result:true};
  });}
  async reserve(lease:SwitchLease,id:string,generation:string,now:string){
    participantUuid(id);participantUuid(generation);
    return this.#unit(lease,now,(value,root)=>{
      requireParticipant(root.pendingSwitchId===value.plan.id,'migration_paused');
      requireParticipant(value.phase==='requested'&&value.plan.direction==='remote-to-local'&&id!==value.plan.sourceId);
      // Reservation must already be durable in the native participant owner.
      // The final Root/switch check compares the supplied pair in the same TX.
      if(value.plan.destinationId!==null)requireParticipant(value.plan.destinationId===id&&value.destinationGeneration===generation);
      return {value:{...value,plan:{...value.plan,destinationId:id},destinationGeneration:generation},result:true};
    });
  }
  /** Save once before dispatch. Only rebaseRejected may retire a proven stale CAS. */
  async command(lease:SwitchLease,side:Side,command:JournalCommand['command'],epoch:string,now:string,peer?:ParticipantReceipt){
    participantInteger(epoch);
    return this.#unit(lease,now,value=>{
      requireParticipant(value.plan.destinationId!==null);
      const previous=value.commands.find(row=>row.side===side&&row.command===command);
      const extras=command==='source_start'?{peer_id:value.plan.destinationId}:peer?{peer_receipt:receipt(peer)}:{};
      if(previous){
        const expected={...previous.request,...extras};requireParticipant(sameJournal(expected,previous.request));return {value,result:previous.request};
      }
      if(peer){requireParticipant(value.receipts.some(old=>sameJournal(old,peer)),'migration_invalid');}
      const request=commandRequest(side,command,{request_id:crypto.randomUUID(),switch_id:value.plan.id,expected_epoch:epoch,...extras});
      return {value:{...value,commands:[...value.commands,{side,command,request}]},result:request};
    });
  }
  async accept(lease:SwitchLease,input:unknown,now:string){
    const proof=receipt(input);
    return this.#unit(lease,now,value=>{
      const prior=value.receipts.find(row=>row.command===proof.command);
      if(prior){requireParticipant(sameJournal(prior,proof));return {value,result:prior};}
      const sealed=value.receipts.find(row=>row.command==='source_seal');
      if(sealed&&proof.command!=='source_cancel')requireParticipant(proof.dataset_id===sealed.dataset_id&&proof.dataset_digest===sealed.dataset_digest&&proof.archive_sha256===sealed.archive_sha256&&proof.archive_size===sealed.archive_size);
      if(proof.command==='source_seal'){
        checkPeerReceipt(proof,'source_seal',value.plan.destinationId!);requireParticipant(proof.dataset_digest!==null&&proof.archive_sha256!==null&&proof.archive_size!==null);
        const started=value.receipts.find(row=>row.command==='source_start');requireParticipant(started!==undefined&&started.dataset_id===proof.dataset_id);
      }
      const next=switchJournal({...value,receipts:[...value.receipts,proof]});return {value:next,result:proof};
    });
  }
  async advance(lease:SwitchLease,next:SwitchPhase,now:string){return this.#unit(lease,now,(value,root)=>{
    if(['active_pointer_committed','destination_activated','complete'].includes(next)){
      const local=value.plan.direction==='remote-to-local';
      requireParticipant(root.activeMode===(local?'local':'remote')&&root.pendingSwitchId===null&&root.activeGeneration===(local?value.destinationGeneration:null)&&root.credentialRef===(local?value.plan.localCredentialRef:value.plan.remoteCredentialRef),'migration_paused');
    }
    return {value:advancePhase(value,next),result:true};
  });}
  async chunk(lease:SwitchLease,number:number,digest:string,now:string){
    participantDigest(digest);requireParticipant(Number.isInteger(number)&&number>=0&&number<256);
    return this.#unit(lease,now,value=>{
      requireParticipant(value.phase==='importing'&&number<=value.chunks.length);
      if(number<value.chunks.length){requireParticipant(value.chunks[number]===digest);return {value,result:true};}
      const seal=value.receipts.find(row=>row.command==='source_seal');requireParticipant(seal!==undefined&&seal.archive_size!==null&&number*262144<Number(seal.archive_size));
      return {value:{...value,chunks:[...value.chunks,digest]},result:true};
    });
  }
  async release(lease:SwitchLease,now:string,error:string|null=null){return this.#unit(lease,now,value=>({value:{...value,lease:null,error},result:true}));}
  close(){this.db.close();}
}
