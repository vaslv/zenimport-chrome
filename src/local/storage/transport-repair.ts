/** A replacement transport secret never grants writer authority. */
import type {RuntimeControl,SentinelPort} from '../../control/types.js';
import {FinancialDatabase} from './database.js';
import {assertAnchor,readAnchor} from './anchor.js';
import {participantUuid,requireParticipant} from '../../control/participant-wire.js';
import type {ServerCredentials} from '../migration/credentials.js';
import {int64} from './types.js';
import {sameJournal} from '../migration/journal.js';
export type RepairKind='move'|'recovery'|'local';
interface Repair{version:'1';kind:RepairKind;id:string;originalRef:string;ref:string;credentialEpoch?:string}
export interface RepairSnapshot{kind:RepairKind;id:string;root:RuntimeControl;record:Record<string,unknown>;overlay:Repair|null}
const scopes={local:['mode-switch-head','mode-switch:'],move:['mode-switch-head','mode-switch:'],recovery:['remote-recovery-head','remote-recovery:']} as const;
const key=(kind:RepairKind,id:string)=>'transport-repair:'+kind+':'+id;
async function read(db:FinancialDatabase,kind:RepairKind,id:string):Promise<Repair|null>{
  const raw=(await db.applicationState.get(key(kind,id)))?.value;
  if(raw===undefined)return null;
  requireParticipant(Object.keys(raw).sort().join(',')===(kind==='local'?'credentialEpoch,id,kind,originalRef,ref,version':'id,kind,originalRef,ref,version')&&raw.version==='1'&&raw.kind===kind&&raw.id===id,'recovery_required');
  participantUuid(raw.originalRef);participantUuid(raw.ref);if(kind==='local')int64(raw.credentialEpoch as string);return raw as unknown as Repair;
}
export async function repairedTransportRef(db:FinancialDatabase,kind:RepairKind,id:string,originalRef:string){
  participantUuid(id);participantUuid(originalRef);const value=await read(db,kind,id);
  requireParticipant(value===null||value.originalRef===originalRef,'recovery_required');return value?.ref??originalRef;
}
export async function repairedLocalEpoch(db:FinancialDatabase,id:string,original:string){return int64((await read(db,'local',id))?.credentialEpoch??original);}
export class TransportRepairOwner{
  private constructor(private db:FinancialDatabase,private sentinel:SentinelPort){}
  static async open(name:string,sentinel:SentinelPort){
    const db=new FinancialDatabase(name,false),marker=await readAnchor(sentinel);
    try{await db.open();await db.transaction('r',db.runtime,db.datasets,()=>assertAnchor(db,marker));return new TransportRepairOwner(db,sentinel);}
    catch(error){db.close();throw error;}
  }
  close(){this.db.close();}
  async #snapshot(kind:RepairKind,id:string,root:RuntimeControl):Promise<RepairSnapshot>{
    participantUuid(id);const [head,prefix]=scopes[kind];
    requireParticipant((await this.db.applicationState.get(head))?.value.id===id,'stale_context');
    const record=(await this.db.applicationState.get(prefix+id))?.value;
    requireParticipant(record!==undefined&&(kind!=='recovery'?!['complete','cancelled'].includes(record.phase as string):(record.phase==='pending'||record.remoteCleaned===false)),'migration_paused');
    return {kind,id,root,record:structuredClone(record),overlay:await read(this.db,kind,id)};
  }
  async snapshot(kind:RepairKind,id:string,expected:RuntimeControl){
    const marker=await readAnchor(this.sentinel);
    return this.db.transaction('r',this.db.tables,async()=>{
      const root=await assertAnchor(this.db,marker);requireParticipant(sameJournal(root,expected),'stale_context');return this.#snapshot(kind,id,root);
    });
  }
  async ref(kind:RepairKind,id:string,originalRef:string){
    const marker=await readAnchor(this.sentinel);
    return this.db.transaction('r',this.db.tables,async()=>{
      await assertAnchor(this.db,marker);return repairedTransportRef(this.db,kind,id,originalRef);
    });
  }
  /** Complete credential adoption only after authority transfer is terminal.
   * The overlay is the durable intent; native Root/ref/epoch checks retire it if
   * a later explicit configuration has already selected another credential.
   */
  async adoption(kind:'move'|'recovery',id:string){
    const marker=await readAnchor(this.sentinel);return await this.db.transaction('r',this.db.tables,async()=>{
      const root=await assertAnchor(this.db,marker),[head,prefix]=scopes[kind];
      if((await this.db.applicationState.get(head))?.value.id!==id)return null;
      const record=(await this.db.applicationState.get(prefix+id))?.value,overlay=await read(this.db,kind,id);
      if(!record||!overlay||root.activeMode!=='remote'||root.pendingSwitchId!==null)return null;
      const initial=record.initialRoot as RuntimeControl,adopted=(await this.db.applicationState.get('transport-adopted:'+kind+':'+id))?.value;
      let selected:string|null=null,delta=1n,baseCredentialEpoch=initial.credentialEpoch,rootDelta=2n;
      if(kind==='move'){
        const direction=(record.plan as {direction:string}).direction,transfer=await this.db.switches.get(id);
        if(record.phase==='complete'&&direction==='local-to-remote')selected=transfer?.credentialRef??null;
        else if(record.phase==='cancelled'&&direction==='remote-to-local'){
          selected=initial.credentialRef;delta=0n;rootDelta=transfer?2n:0n;
          baseCredentialEpoch=await repairedLocalEpoch(this.db,id,initial.credentialEpoch);
        }else return null;
      }else{
        if(!['activated','cancelled'].includes(record.phase as string))return null;
        selected=record.phase==='activated'?record.selectedRef as string:initial.credentialRef;delta=record.phase==='activated'?1n:0n;
      }
      if(adopted){
        if(!sameJournal(root,adopted.root)||adopted.ref===overlay.ref)return null;
      }else if(root.credentialRef!==selected||root.credentialRef===overlay.ref||root.epoch!==String(BigInt(initial.epoch)+rootDelta)||
        root.credentialEpoch!==String(BigInt(baseCredentialEpoch)+delta))return null;
      const descriptor=await this.db.remoteContexts.get(root.credentialRef!);requireParticipant(descriptor!==undefined,'recovery_required');
      return {root,record,overlay,descriptor};
    });
  }
  async adoptSelected(kind:'move'|'recovery',id:string,credentials:ServerCredentials){
    const capture=await this.adoption(kind,id);if(!capture)return;
    const marker=await readAnchor(this.sentinel),target=crypto.randomUUID();
    const secret=await credentials.read(capture.overlay.ref);
    requireParticipant(secret.url===capture.descriptor.url,'recovery_required');
    await credentials.cloneContext(capture.overlay.ref,target,capture.descriptor.contextId);
    await this.db.transaction('rw',this.db.tables,async()=>{
      const root=await assertAnchor(this.db,marker),[head,prefix]=scopes[kind];
      requireParticipant((await this.db.applicationState.get(head))?.value.id===id&&sameJournal(root,capture.root)&&
        JSON.stringify((await this.db.applicationState.get(prefix+id))?.value)===JSON.stringify(capture.record)&&
        sameJournal(await read(this.db,kind,id),capture.overlay),'stale_context');
      await this.db.remoteContexts.add({...capture.descriptor,id:target});
      const next={...root,credentialRef:target,credentialEpoch:int64(String(BigInt(root.credentialEpoch)+1n))};
      await this.db.runtime.put(next);
      await this.db.applicationState.put({scope:'transport-adopted:'+kind+':'+id,value:{root:next,ref:capture.overlay.ref}});
    });
  }
  /** CAS includes the previous overlay, so a late repair cannot replace a newer one. */
  async install(expected:RepairSnapshot,originalRef:string,ref:string){
    participantUuid(originalRef);participantUuid(ref);const marker=await readAnchor(this.sentinel);
    return this.db.transaction('rw',this.db.tables,async()=>{
      const current=await this.#snapshot(expected.kind,expected.id,await assertAnchor(this.db,marker));
      requireParticipant(sameJournal(current.root,expected.root)&&JSON.stringify(current.record)===JSON.stringify(expected.record)&&sameJournal(current.overlay,expected.overlay),'stale_context');
      const original=current.kind==='local'?(current.record.plan as {localCredentialRef?:string})?.localCredentialRef:current.kind==='move'?(current.record.plan as {remoteCredentialRef?:string})?.remoteCredentialRef:
        (current.record.initialRoot as RuntimeControl)?.credentialRef;
      requireParticipant(original===originalRef&&(current.overlay===null||current.overlay.originalRef===originalRef),'recovery_required');
      const value:Repair={version:'1',kind:current.kind,id:current.id,originalRef,ref};
      if(current.kind==='local'){
        const plan=current.record.plan as {direction:string},transfer=await this.db.switches.get(current.id);
        requireParticipant(plan.direction==='remote-to-local'&&current.root.activeMode==='remote'&&current.root.pendingSwitchId===current.id&&
          transfer?.role==='destination'&&transfer.state==='pending'&&transfer.credentialRef===(current.overlay?.ref??originalRef),'migration_paused');
        const epoch=int64(String(BigInt(current.root.credentialEpoch)+1n));int64(String(BigInt(epoch)+1n));
        value.credentialEpoch=epoch;
        await this.db.switches.put({...transfer,credentialRef:ref});
        await this.db.runtime.put({...current.root,credentialEpoch:epoch});
        await this.db.applicationState.put({scope:scopes.local[1]+current.id,value:{...current.record,lease:null,revision:String(BigInt(current.record.revision as string)+1n)}});
      }
      await this.db.applicationState.put({scope:key(current.kind,current.id),value:{...value}});
      // A secret may already have been cloned before an interrupted activation.
      // Reserve a new immutable final reference; stale activation callbacks must
      // still pass RemoteRecoverySelection's selectedRef/context CAS.
      if(current.kind==='recovery'&&current.record.phase==='pending')await this.db.applicationState.put({scope:scopes.recovery[1]+current.id,
        value:{...current.record,selectedRef:crypto.randomUUID(),selectedContext:crypto.randomUUID()}});
      return ref;
    });
  }
}
