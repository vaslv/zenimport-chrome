/** Private bounded file upload cache. Files never grant financial write authority. */
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import type {RuntimeControl,SentinelPort} from '../../control/types.js';
import {participantUuid,participantDigest,requireParticipant} from '../../control/participant-wire.js';
import {FinancialDatabase} from './database.js';
import {assertAnchor,readAnchor} from './anchor.js';
import {storageFailure} from './types.js';
import {runtimeControl} from '../../control/validation.js';
import {sameJournal} from '../migration/journal.js';

const CHUNK=262144,MAX=67108864;
const scope=(id:string)=>'archive-file:'+id;
const digest=(data:Uint8Array)=>bytesToHex(sha256(data));
interface ArchiveFile{
  version:'1';id:string;installationId:string;nonce:string;bytes:number;chunks:number;sha256:string;
  phase:'uploading'|'ready'|'cancelled'|'cleaned';
}
function file(input:unknown):ArchiveFile{
  requireParticipant(input!==null&&typeof input==='object'&&!Array.isArray(input));const v=input as ArchiveFile;
  requireParticipant(Object.keys(v).sort().join(',')==='bytes,chunks,id,installationId,nonce,phase,sha256,version'&&v.version==='1');
  for(const id of [v.id,v.installationId,v.nonce])participantUuid(id);participantDigest(v.sha256);
  requireParticipant(Number.isSafeInteger(v.bytes)&&v.bytes>0&&v.bytes<=MAX&&v.chunks===Math.ceil(v.bytes/CHUNK)&&
    ['uploading','ready','cancelled','cleaned'].includes(v.phase));return structuredClone(v);
}
export class ArchiveFileOwner{
  private constructor(private db:FinancialDatabase,private port:SentinelPort,private expected?:RuntimeControl){}
  static async open(name:string,port:SentinelPort,expected?:RuntimeControl){
    const captured=expected?structuredClone(runtimeControl(expected)):undefined;
    const marker=await readAnchor(port),db=new FinancialDatabase(name,false);
    try{await db.open();await db.transaction('r',db.runtime,db.datasets,async()=>{await assertAnchor(db,marker);});return new ArchiveFileOwner(db,port,captured);}
    catch(error){db.close();throw storageFailure(error);}
  }
  close(){this.db.close();}
  async #unit<T>(write:boolean,work:(installationId:string)=>Promise<T>){
    const marker=await readAnchor(this.port);
    try{return await this.db.transaction(write?'rw':'r',this.db.runtime,this.db.datasets,this.db.applicationState,this.db.archiveFileChunks,
      async()=>{const root=await assertAnchor(this.db,marker),expected=this.expected;
        requireParticipant(!expected||(!expected.financialMayHaveStarted||root.financialMayHaveStarted)&&
          sameJournal({...root,financialMayHaveStarted:expected.financialMayHaveStarted},expected),'stale_context');
        return work(root.installationId);});}
    catch(error){if(error&&typeof error==='object'&&'code'in error)throw error;throw storageFailure(error);}
  }
  async #read(id:string,installationId:string){participantUuid(id);const v=file((await this.db.applicationState.get(scope(id)))?.value);requireParticipant(v.id===id&&v.installationId===installationId);return v;}
  async #save(v:ArchiveFile){await this.db.applicationState.put({scope:scope(v.id),value:file(v) as unknown as Record<string,unknown>});}
  async begin(id:string,bytes:number,checksum:string){
    participantUuid(id);participantDigest(checksum);requireParticipant(Number.isSafeInteger(bytes)&&bytes>0&&bytes<=MAX);
    return this.#unit(true,async installationId=>{
      if(await this.db.applicationState.get(scope(id))){const v=await this.#read(id,installationId);requireParticipant(v.bytes===bytes&&v.sha256===checksum);return v;}
      const head=(await this.db.applicationState.get('archive-file-head'))?.value.id;
      if(typeof head==='string')requireParticipant((await this.#read(head,installationId)).phase==='cleaned','migration_busy');
      const v:ArchiveFile={version:'1',id,installationId,nonce:crypto.randomUUID(),bytes,chunks:Math.ceil(bytes/CHUNK),sha256:checksum,phase:'uploading'};
      await this.#save(v);await this.db.applicationState.put({scope:'archive-file-head',value:{id}});return v;
    });
  }
  async current(){return this.#unit(false,async installationId=>{
    const id=(await this.db.applicationState.get('archive-file-head'))?.value.id;
    return id===undefined?null:this.#read(participantUuid(id),installationId);
  });}
  async status(id:string){return this.#unit(false,async installationId=>{
    const v=await this.#read(id,installationId),keys=await this.db.archiveFileChunks.where('id').equals(id).primaryKeys();
    const received=keys.map(key=>key[1]).sort((a,b)=>a-b);requireParticipant(received.length<=v.chunks&&received.every(n=>Number.isInteger(n)&&n>=0&&n<v.chunks));return {...v,received};
  });}
  async put(id:string,nonce:string,number:number,input:Uint8Array){
    participantUuid(nonce);requireParticipant(input instanceof Uint8Array&&input.length>0&&input.length<=CHUNK&&Number.isInteger(number)&&number>=0&&number<256);
    const data=input.slice(),checksum=digest(data);
    return this.#unit(true,async installationId=>{
      const v=await this.#read(id,installationId);requireParticipant(v.phase==='uploading'&&v.nonce===nonce,'migration_paused');
      requireParticipant(number<v.chunks&&data.length===Math.min(CHUNK,v.bytes-number*CHUNK));
      const old=await this.db.archiveFileChunks.get([id,number]);
      if(old)requireParticipant(old.sha256===checksum&&digest(old.data)===checksum,'migration_invalid');
      else await this.db.archiveFileChunks.add({id,number,data,sha256:checksum});return {number,sha256:checksum};
    });
  }
  async #part(v:ArchiveFile,number:number){return this.#unit(false,async installationId=>{
    const current=await this.#read(v.id,installationId);requireParticipant(current.nonce===v.nonce&&current.bytes===v.bytes&&current.sha256===v.sha256&&['uploading','ready'].includes(current.phase),'migration_paused');
    const row=await this.db.archiveFileChunks.get([v.id,number]);
    requireParticipant(row!==undefined&&row.data instanceof Uint8Array&&row.data.length===Math.min(CHUNK,v.bytes-number*CHUNK)&&digest(row.data)===row.sha256,'migration_incomplete');return row.data;
  });}
  async chunk(id:string,number:number){
    requireParticipant(Number.isInteger(number)&&number>=0&&number<256);
    const value=await this.#unit(false,installationId=>this.#read(id,installationId));
    requireParticipant(value.phase==='ready'&&number<value.chunks,'migration_incomplete');
    return this.#part(value,number);
  }
  async seal(id:string){
    const v=await this.#unit(false,installationId=>this.#read(id,installationId));requireParticipant(['uploading','ready'].includes(v.phase),'migration_paused');
    const hash=sha256.create();for(let i=0;i<v.chunks;i++)hash.update(await this.#part(v,i));
    requireParticipant(bytesToHex(hash.digest())===v.sha256,'migration_invalid');
    return this.#unit(true,async installationId=>{
      const current=await this.#read(id,installationId);requireParticipant(current.nonce===v.nonce&&current.bytes===v.bytes&&current.sha256===v.sha256&&['uploading','ready'].includes(current.phase),'migration_paused');
      const next={...current,phase:'ready' as const};await this.#save(next);return next;
    });
  }
  /** Assemble at most 64 MiB only after all immutable chunk checks succeeded. */
  async blob(id:string){
    const v=await this.#unit(false,installationId=>this.#read(id,installationId));requireParticipant(v.phase==='ready','migration_incomplete');
    const parts:Uint8Array<ArrayBuffer>[]=[],hash=sha256.create();for(let i=0;i<v.chunks;i++){const part=await this.#part(v,i);hash.update(part);parts.push(part.slice());}
    requireParticipant(bytesToHex(hash.digest())===v.sha256,'migration_invalid');
    await this.#unit(false,async installationId=>{const current=await this.#read(id,installationId);requireParticipant(current.phase==='ready'&&current.nonce===v.nonce&&current.bytes===v.bytes&&current.sha256===v.sha256,'migration_paused');});
    return new Blob(parts,{type:'application/zip'});
  }
  async cancel(id:string){return this.#unit(true,async installationId=>{
    const v=await this.#read(id,installationId);if(['cancelled','cleaned'].includes(v.phase))return v;
    const next={...v,phase:'cancelled' as const,nonce:crypto.randomUUID()};await this.#save(next);return next;
  });}
  /** One cached chunk per call; recovery and financial rows are never touched. */
  async clean(id:string){return this.#unit(true,async installationId=>{
    const v=await this.#read(id,installationId);requireParticipant(['cancelled','cleaned'].includes(v.phase),'migration_paused');
    const row=await this.db.archiveFileChunks.where('id').equals(id).first();if(row){await this.db.archiveFileChunks.delete([id,row.number]);return {complete:false};}
    await this.#save({...v,phase:'cleaned'});return {complete:true};
  });}
}
