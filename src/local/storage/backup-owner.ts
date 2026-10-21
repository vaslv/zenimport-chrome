/** Local snapshots carry facts, never peer handoff or financial write authority. */
import Dexie from 'dexie';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import type {RuntimeControl,SentinelPort} from '../../control/types.js';
import {datasetControl} from '../../control/validation.js';
import {FinancialDatabase} from './database.js';
import {readAnchor,assertAnchor} from './anchor.js';
import {HeldReader} from './held-reader.js';
import {packRow} from './cells.js';
import {readOutbox} from './outbox-control.js';
import {participantControl} from './participant-validation.js';
import {participantUuid,requireParticipant} from '../../control/participant-wire.js';
import {int64,storageFailure} from './types.js';
import {createArchive} from '../portable/zip.js';
import {validateFinancialGraph} from '../portable/graph.js';
import type {PortableManifest} from '../portable/format.js';

interface Backup{
  version:'1';id:string;generation:string;datasetId:string;initialRoot:RuntimeControl;
  held:boolean;phase:'building'|'ready'|'cancelled'|'cleaned';nonce:string|null;createdAt:string;
  archiveId:string;sha256:string|null;bytes:number;chunks:number;manifest:PortableManifest|null;acknowledgedAt:string|null;
}
const scope=(id:string)=>'local-backup:'+id;
const increment=(value:string)=>int64(String(BigInt(value)+1n));
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const hash=(data:Uint8Array)=>bytesToHex(sha256(data));
export class BackupOwner{
  private constructor(private db:FinancialDatabase,private port:SentinelPort){}
  static async open(name:string,port:SentinelPort){
    const marker=await readAnchor(port),db=new FinancialDatabase(name,false);
    try{await db.open();await db.transaction('r',db.runtime,db.datasets,()=>assertAnchor(db,marker));return new BackupOwner(db,port);}
    catch(error){db.close();throw storageFailure(error);}
  }
  close(){this.db.close();}
  async #unit<T>(write:boolean,work:(root:RuntimeControl)=>Promise<T>){
    const marker=await readAnchor(this.port);
    try{return await this.db.transaction(write?'rw':'r',this.db.tables,async()=>work(await assertAnchor(this.db,marker)));}
    catch(error){if(error&&typeof error==='object'&&'code'in error)throw error;throw storageFailure(error);}
  }
  async #read(id:string){
    participantUuid(id);const value=(await this.db.applicationState.get(scope(id)))?.value as unknown as Backup|undefined;
    requireParticipant(value?.version==='1'&&value.id===id,'migration_invalid');return value;
  }
  async #save(value:Backup){await this.db.applicationState.put({scope:scope(value.id),value:value as unknown as Record<string,unknown>});}
  async #guard(root:RuntimeControl,value:Backup,nonce?:string){
    requireParticipant(value.phase==='building'&&(nonce===undefined||value.nonce===nonce),'migration_paused');
    const dataset=datasetControl(await this.db.datasets.get(value.generation));
    requireParticipant(dataset.datasetId===value.datasetId,'migration_invalid');
    if(value.held)requireParticipant(same(root,{...value.initialRoot,pendingSwitchId:value.id,epoch:increment(value.initialRoot.epoch)})&&
      dataset.lifecycle==='held'&&dataset.holdId===value.id,'migration_paused');
    else requireParticipant(dataset.lifecycle==='retired'&&root.activeGeneration!==value.generation,'migration_paused');
  }
  async list(){return this.#unit(false,async()=>{
    const rows=await this.db.applicationState.where('scope').startsWith('local-backup:').toArray();
    return rows.map(row=>structuredClone(row.value) as unknown as Backup);
  });}
  /** Caller quiesces first; this final transaction owns the actual snapshot hold. */
  async begin(id:string,generation:string,expected:RuntimeControl,now:string){
    participantUuid(id);participantUuid(generation);int64(now);requireParticipant(BigInt(now)>=0n&&BigInt(now)<=253402300799n);
    return this.#unit(true,async root=>{
      const old=(await this.db.applicationState.get(scope(id)))?.value as unknown as Backup|undefined;
      if(old){requireParticipant(old.generation===generation);return old;}
      requireParticipant(same(root,expected)&&root.pendingSwitchId===null,'migration_busy');
      for(const head of ['mode-switch-head','mode-join-head','local-backup-head','archive-restore-head']){
        const key=(await this.db.applicationState.get(head))?.value.id;
        if(typeof key==='string'){
          const prefix=head==='mode-switch-head'?'mode-switch:':head==='mode-join-head'?'mode-join:':head==='archive-restore-head'?'archive-restore:':'local-backup:';
          const pending=(await this.db.applicationState.get(prefix+key))?.value;
          requireParticipant(!pending||['complete','cancelled','ready','cleaned','activated'].includes(pending.phase as string),'migration_busy');
        }
      }
      const dataset=datasetControl(await this.db.datasets.get(generation));
      const held=root.activeMode==='local'&&root.activeGeneration===generation;
      if(held){
        // Reserve both hold/release epochs before making the source unwritable.
        increment(increment(root.epoch));
        const control=participantControl(await this.db.participants.get(dataset.participantId));
        requireParticipant(dataset.lifecycle==='active'&&dataset.holdId===null&&control.state==='active'&&!control.awaitingSync&&
          control.epoch===dataset.participantEpoch,'migration_paused');
        const outbox=await readOutbox(this.db,generation);
        requireParticipant(outbox===null||outbox.phase==='settled','migration_busy');
        requireParticipant(await this.db.financial('capture_jobs').where('[generation+i0]').between([generation,Dexie.minKey],[generation,Dexie.maxKey],true,true).first()===undefined,'migration_incomplete');
      }else requireParticipant(dataset.lifecycle==='retired'&&root.activeGeneration!==generation,'migration_paused');
      const value:Backup={version:'1',id,generation,datasetId:dataset.datasetId,initialRoot:root,held,phase:'building',nonce:null,createdAt:now,
        archiveId:crypto.randomUUID(),sha256:null,bytes:0,chunks:0,manifest:null,acknowledgedAt:null};
      if(held){await this.db.datasets.put({...dataset,lifecycle:'held',holdId:id});await this.db.runtime.put({...root,pendingSwitchId:id,epoch:increment(root.epoch)});}
      await this.#save(value);await this.db.applicationState.put({scope:'local-backup-head',value:{id}});return value;
    });
  }
  async #release(root:RuntimeControl,value:Backup){
    if(!value.held)return;await this.#guard(root,value);
    const dataset=datasetControl(await this.db.datasets.get(value.generation));
    await this.db.datasets.put({...dataset,lifecycle:'active',holdId:null});
    await this.db.runtime.put({...root,pendingSwitchId:null,epoch:increment(root.epoch)});
  }
  async cancel(id:string){return this.#unit(true,async root=>{
    const value=await this.#read(id);if(value.phase==='cancelled')return value;
    requireParticipant(value.phase==='building','migration_paused');await this.#release(root,value);
    const next={...value,phase:'cancelled' as const,nonce:null};await this.#save(next);return next;
  });}
  /** A fresh nonce fences every late chunk writer from an interrupted attempt. */
  async build(id:string){
    const value=await this.#unit(true,async root=>{
      const value=await this.#read(id);if(value.phase==='ready')return value;
      await this.#guard(root,value);const next={...value,nonce:crypto.randomUUID()};
      await this.db.backupChunks.where('id').equals(id).delete();await this.#save(next);return next;
    });if(value.phase==='ready')return value;
    const guard=async(root:RuntimeControl)=>this.#guard(root,await this.#read(id),value.nonce!);
    let marker=await readAnchor(this.port);
    const reader=new HeldReader(this.db,value.generation,async()=>{marker=await readAnchor(this.port);},async()=>guard(await assertAnchor(this.db,marker)));
    const owners:string[]=[];for await(const row of reader.rows('zen_entities',[['text','user']]))if(row.deleted==='0')owners.push(row.id);
    let buffer=new Uint8Array(262144),used=0,number=0;
    const flush=async()=>{
      if(!used)return;const data=buffer.slice(0,used);await this.#unit(true,async root=>{await guard(root);requireParticipant(number<256,'migration_incomplete');
        await this.db.backupChunks.add({id,number,data,sha256:hash(data)});});number++;used=0;buffer=new Uint8Array(262144);
    };
    const result=await createArchive({datasetId:value.datasetId,ownerIds:owners,sessionId:id,archiveId:value.archiveId,
      createdAt:new Date(Number(value.createdAt)*1000).toISOString(),version:'local-backup-v1'},async function*(table){
        for await(const row of reader.rows(table))yield packRow(table,row);
      },{async write(part){for(let offset=0;offset<part.length;){const size=Math.min(buffer.length-used,part.length-offset);buffer.set(part.subarray(offset,offset+size),used);used+=size;offset+=size;if(used===buffer.length)await flush();}}});
    await flush();await validateFinancialGraph(reader,result.manifest);
    const digest=sha256.create();let bytes=0;
    for(let i=0;i<number;i++){
      const part=await this.#unit(false,async root=>{await guard(root);return this.db.backupChunks.get([id,i]);});
      requireParticipant(part!==undefined&&hash(part.data)===part.sha256,'migration_incomplete');digest.update(part.data);bytes+=part.data.length;
    }
    requireParticipant(bytes===result.bytes&&bytesToHex(digest.digest())===result.archiveSha256,'migration_incomplete');
    return this.#unit(true,async root=>{
      const current=await this.#read(id);await guard(root);await this.#release(root,current);
      const ready:Backup={...current,phase:'ready',nonce:null,manifest:result.manifest,sha256:result.archiveSha256,bytes,chunks:number};
      await this.#save(ready);return ready;
    });
  }
  async chunk(id:string,number:number){
    requireParticipant(Number.isInteger(number)&&number>=0&&number<256);
    return this.#unit(false,async()=>{
      const value=await this.#read(id);requireParticipant(value.phase==='ready'&&number<value.chunks,'migration_incomplete');
      const chunk=await this.db.backupChunks.get([id,number]);requireParticipant(chunk!==undefined&&hash(chunk.data)===chunk.sha256,'migration_incomplete');return chunk;
    });
  }
  /** The UI acknowledges only after a verified complete download, never on build. */
  async acknowledge(id:string,checksum:string,now:string){
    int64(now);requireParticipant(BigInt(now)>=0n&&BigInt(now)<=253402300799n);
    return this.#unit(true,async()=>{
      const value=await this.#read(id);requireParticipant(value.phase==='ready'&&value.sha256===checksum,'migration_incomplete');
      const dataset=datasetControl(await this.db.datasets.get(value.generation));
      requireParticipant(dataset.datasetId===value.datasetId&&BigInt(now)>=BigInt(value.createdAt),'migration_invalid');
      if(value.acknowledgedAt!==null)return value;
      if(dataset.backupAcknowledgedAt===null||BigInt(now)>BigInt(dataset.backupAcknowledgedAt))await this.db.datasets.put({...dataset,backupAcknowledgedAt:int64(now)});
      const next={...value,acknowledgedAt:now};await this.#save(next);return next;
    });
  }
  /** At most one 256 KiB chunk per call. Financial history is never removed. */
  async clean(id:string){return this.#unit(true,async()=>{
    const value=await this.#read(id);requireParticipant(['cancelled','cleaned'].includes(value.phase)||value.phase==='ready'&&value.acknowledgedAt!==null,'migration_paused');
    const chunk=await this.db.backupChunks.where('id').equals(id).first();if(!chunk){await this.#save({...value,phase:'cleaned'});return {complete:true};}
    await this.db.backupChunks.delete([id,chunk.number]);return {complete:false};
  });}
}
