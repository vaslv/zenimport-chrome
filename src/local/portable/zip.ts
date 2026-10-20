/** Bounded, inert ZIP containers. Never use async helpers that create Workers. */
import {Inflate,Zip,ZipDeflate} from 'fflate';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {SCHEMA} from '../storage/schema.generated.js';
import type {TableName} from '../storage/schema.generated.js';
import type {TaggedRow} from '../storage/types.js';
import {PORTABLE} from './contract.generated.js';
import {LIMITS,TABLES,PortableError,portableFailure,requirePortable,canonical,parseJson,digest,validateManifest,datasetDigest,rowBytes,TableScanner} from './format.js';
import type {PortableManifest,TableDescriptor} from './format.js';

const crcTable=Uint32Array.from({length:256},(_,i)=>{
  let value=i;for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;
});
function crc32(bytes:Uint8Array,previous=0):number{
  let value=previous^0xffffffff;for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;
}
interface Member{name:string;method:number;flags:number;crc:number;size:number;compressed:number;offset:number;data:number}
function members(raw:Uint8Array):Map<string,Member>{
  requirePortable(raw.length>=22,'invalid_archive');
  const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),end=raw.length-22;
  const u16=(offset:number)=>view.getUint16(offset,true),u32=(offset:number)=>view.getUint32(offset,true);
  requirePortable(u32(end)===0x06054b50&&u16(end+4)===0&&u16(end+6)===0&&u16(end+20)===0,'invalid_archive');
  const count=u16(end+10),central=u32(end+16),centralSize=u32(end+12);
  requirePortable(count===TABLES.length+1&&u16(end+8)===count&&central+centralSize===end,'unexpected_zip_member');
  const expected=new Set(['manifest.json',...TABLES.map(name=>'tables/'+name+'.ndjson')]);
  const entries=new Map<string,Member>();let offset=central,total=0;
  function nameAt(start:number,length:number):string{
    requirePortable(start>=0&&start+length<=end,'invalid_zip_member');
    try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw.subarray(start,start+length));}
    catch{throw new PortableError('invalid_zip_member');}
  }
  function extraAt(start:number,length:number):void{
    const last=start+length;requirePortable(last<=end,'invalid_zip_member');
    while(start<last){requirePortable(start+4<=last,'invalid_zip_member');const id=u16(start),size=u16(start+2);start+=4;
      requirePortable(id!==1&&start+size<=last,'invalid_zip_member');start+=size;}
  }
  for(let i=0;i<count;i++){
    requirePortable(offset+46<=end&&u32(offset)===0x02014b50,'invalid_zip_member');
    const flags=u16(offset+8),method=u16(offset+10),crc=u32(offset+16),compressed=u32(offset+20),size=u32(offset+24);
    const length=u16(offset+28),extra=u16(offset+30),comment=u16(offset+32),attributes=u32(offset+38),mode=(attributes>>>16)&0xf000;
    const name=nameAt(offset+46,length),local=u32(offset+42);
    requirePortable(expected.has(name)&&!entries.has(name),'unexpected_zip_member');
    requirePortable(u16(offset+6)<=20&&u16(offset+34)===0&&!(flags&~0x080e)&&[0,8].includes(method)&&
      [0,0x8000].includes(mode)&&!(attributes&16)&&comment===0,'invalid_zip_member');
    requirePortable(size<=(name==='manifest.json'?LIMITS.manifest_bytes:LIMITS.uncompressed_bytes),'zip_member_too_large');
    requirePortable(local<central&&compressed<=LIMITS.compressed_bytes,'invalid_zip_member');
    extraAt(offset+46+length,extra);total+=size;
    entries.set(name,{name,method,flags,crc,size,compressed,offset:local,data:0});offset+=46+length+extra+comment;
  }
  requirePortable(offset===end&&total<=LIMITS.uncompressed_bytes,'dataset_too_large');
  // Every byte before the central directory belongs to exactly one local file.
  // No prefixes, hidden/overlapping members, contradictory headers or trailing data.
  let cursor=0;
  const ordered=[...entries.values()].sort((a,b)=>a.offset-b.offset);
  for(let i=0;i<ordered.length;i++){
    const item=ordered[i],next=ordered[i+1]?.offset??central;
    const local=item.offset;requirePortable(local===cursor&&local+30<=central&&u32(local)===0x04034b50,'invalid_zip_member');
    const length=u16(local+26),extra=u16(local+28);
    requirePortable(u16(local+4)<=20&&u16(local+6)===item.flags&&u16(local+8)===item.method&&
      nameAt(local+30,length)===item.name,'invalid_zip_member');
    item.data=local+30+length+extra;extraAt(local+30+length,extra);
    cursor=item.data+item.compressed;requirePortable(cursor<=central,'invalid_zip_member');
    const localValues=[u32(local+14),u32(local+18),u32(local+22)],values=[item.crc,item.compressed,item.size];
    if(item.flags&8){
      requirePortable(localValues.every((value,i)=>value===0||value===values[i]),'invalid_zip_member');
      const descriptorSize=next-cursor;
      requirePortable([12,16].includes(descriptorSize)&&cursor+descriptorSize<=central,'invalid_zip_member');
      if(descriptorSize===16){requirePortable(u32(cursor)===0x08074b50,'invalid_zip_member');cursor+=4;}
      requirePortable(cursor+12<=central&&values.every((value,i)=>u32(cursor+i*4)===value),'invalid_zip_member');cursor+=12;
    }else requirePortable(values.every((value,i)=>value===localValues[i]),'invalid_zip_member');
  }
  requirePortable(cursor===central,'invalid_zip_member');return entries;
}

async function readMember(raw:Uint8Array,item:Member,accept:(chunk:Uint8Array)=>Promise<void>):Promise<void>{
  let size=0,crc=0,final=false,pending:Uint8Array[]=[],yieldBytes=0;
  function output(chunk:Uint8Array,last:boolean){
    size+=chunk.length;requirePortable(size<=item.size,'zip_member_too_large');
    crc=crc32(chunk,crc);pending.push(chunk);final=last;yieldBytes+=chunk.length;
  }
  const inflate=item.method===8?new Inflate(output):null;
  if(item.compressed===0){
    requirePortable(item.method===0&&item.size===0,'invalid_zip_member');final=true;
  }
  for(let start=0;start<item.compressed;start+=4096){
    const last=Math.min(start+4096,item.compressed),part=raw.subarray(item.data+start,item.data+last);
    if(inflate)inflate.push(part,last===item.compressed);else output(part,last===item.compressed);
    for(const chunk of pending)await accept(chunk);pending=[];
    if(yieldBytes>=1048576){await new Promise<void>(resolve=>setTimeout(resolve,0));yieldBytes=0;}
  }
  requirePortable(final&&size===item.size&&crc===item.crc,'zip_integrity_mismatch');
}

export interface ArchiveReader{
  /** Must create an inactive private stage; these callbacks do not grant authority. */
  manifest(value:PortableManifest):Promise<void>;
  row(table:TableName,value:TaggedRow,bytes:number):Promise<void>;
}
export async function readArchive(blob:Blob,sink:ArchiveReader):Promise<{manifest:PortableManifest;archiveSha256:string}>{
  try{
    requirePortable(blob.size<=LIMITS.compressed_bytes,'archive_too_large');
    const raw=new Uint8Array(await blob.arrayBuffer()),entries=members(raw),pieces:Uint8Array[]=[];
    await readMember(raw,entries.get('manifest.json')!,async chunk=>{pieces.push(chunk);});
    const size=pieces.reduce((sum,part)=>sum+part.length,0),bytes=new Uint8Array(size);let offset=0;
    for(const piece of pieces){bytes.set(piece,offset);offset+=piece.length;}
    const manifest=validateManifest(parseJson(bytes));
    // Freeze a private copy, not a caller-writable object shared with validation.
    await sink.manifest(validateManifest(parseJson(bytes)));
    for(const entry of manifest.tables){
      const member=entries.get(entry.filename)!;
      requirePortable(member.size===entry.bytes,'table_integrity_mismatch');
      const scanner=new TableScanner(entry.name,(row,bytes)=>sink.row(entry.name,row,bytes));
      await readMember(raw,member,chunk=>scanner.push(chunk));scanner.finish(entry);
    }
    return {manifest,archiveSha256:digest(raw)};
  }catch(error){throw portableFailure(error,'invalid_archive');}
}

export interface ArchiveOptions{datasetId:string;ownerIds:string[];sessionId:string;archiveId:string;createdAt:string;version:string}
export interface ArchiveWriter{write(bytes:Uint8Array):Promise<void>}
export async function createArchive(options:ArchiveOptions,tables:(name:TableName)=>AsyncIterable<TaggedRow>,sink:ArchiveWriter):Promise<{manifest:PortableManifest;archiveSha256:string;bytes:number}>{
  try{
    const config={...options,ownerIds:[...options.ownerIds]};
    let size=0,uncompressed=0,done=false,pending:Uint8Array[]=[],yieldBytes=0;
    const hash=sha256.create(),entries:TableDescriptor[]=[];
    const zip=new Zip((error,chunk,final)=>{
      if(error)throw new PortableError('invalid_archive');size+=chunk.length;
      requirePortable(size<=LIMITS.compressed_bytes,'archive_too_large');
      hash.update(chunk);pending.push(chunk);done=final;
    });
    async function flush(){for(const chunk of pending)await sink.write(chunk);pending=[];}
    // ZIP stores a wall clock without a timezone; keep its fields identical
    // when a held snapshot is rebuilt in a different browser timezone.
    function file(name:string){const entry=new ZipDeflate(name,{level:6});entry.mtime=new Date(2026,0,1,0,0,0);zip.add(entry);return entry;}
    for(const table of TABLES){
      const entry=file('tables/'+table+'.ndjson'),hash=sha256.create();let previous:string|null=null,count=0,bytes=0;
      for await(const row of tables(table)){
        const value=rowBytes(table,row);
        requirePortable(previous===null||previous<value.key,'duplicate_or_unordered_key');previous=value.key;
        uncompressed+=value.bytes.length;requirePortable(uncompressed<=LIMITS.uncompressed_bytes,'dataset_too_large');
        count++;bytes+=value.bytes.length;hash.update(value.bytes);
        for(let offset=0;offset<value.bytes.length;offset+=65536){
          const part=value.bytes.subarray(offset,offset+65536);entry.push(part);await flush();yieldBytes+=part.length;
          if(yieldBytes>=1048576){await new Promise<void>(resolve=>setTimeout(resolve,0));yieldBytes=0;}
        }
      }
      entry.push(new Uint8Array(),true);await flush();
      entries.push({name:table,filename:'tables/'+table+'.ndjson',columns:SCHEMA[table].columns.map(column=>column.name),rows:count,bytes,sha256:bytesToHex(hash.digest())});
    }
    const manifest:PortableManifest={format:'zenimport-portable',archive_version:2,financial_schema_version:1,
      archive_id:config.archiveId,created_at:config.createdAt,producer:{version:config.version,engine:'indexeddb',contract_revision:PORTABLE.revision},
      dataset_id:config.datasetId,export_session_id:config.sessionId,zenmoney_identity:{owner_ids:config.ownerIds,proof_version:1},
      tables:entries,dataset_digest:'',required_features:[...PORTABLE.features]};
    manifest.dataset_digest=datasetDigest(manifest);validateManifest(manifest);
    file('manifest.json').push(canonical(manifest),true);await flush();zip.end();await flush();
    requirePortable(done,'invalid_archive');return {manifest,archiveSha256:bytesToHex(hash.digest()),bytes:size};
  }catch(error){throw portableFailure(error,'archive_write_failed');}
}
