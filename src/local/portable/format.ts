/** Format/integrity only. No graph verification or financial activation rights. */
import {decodeJson} from 'zenmoney-typescript';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {SCHEMA} from '../storage/schema.generated.js';
import type {TableName} from '../storage/schema.generated.js';
import {validateCells,rowKey} from '../storage/cells.js';
import type {TaggedRow} from '../storage/types.js';
import {StorageError} from '../storage/types.js';
import {PORTABLE} from './contract.generated.js';

export const LIMITS=PORTABLE.limits;
export const TABLES=Object.keys(SCHEMA).sort() as TableName[];
export class PortableError extends Error{
  constructor(readonly code:string){super(code);this.name='PortableError';}
}
export function requirePortable(value:unknown,code='invalid_archive'):asserts value{if(!value)throw new PortableError(code);}
export function portableFailure(error:unknown,fallback:string):PortableError{
  if(error instanceof PortableError)return error;
  if(error instanceof StorageError)return new PortableError(error.code);
  if(error instanceof Error&&error.name==='QuotaExceededError')return new PortableError('quota_exceeded');
  return new PortableError(fallback);
}
export const utf8=new TextEncoder();
export function canonical(value:unknown):Uint8Array{
  // Only validated tagged scalars and bounded manifest primitives reach here.
  return utf8.encode(JSON.stringify(value)+'\n');
}
export function digest(raw:Uint8Array):string{return bytesToHex(sha256(raw));}
export function parseJson(raw:Uint8Array):unknown{
  requirePortable(!(raw[0]===239&&raw[1]===187&&raw[2]===191),'invalid_utf8');
  try{return decodeJson(raw);}catch{throw new PortableError('invalid_json');}
}
export function object(value:unknown,keys:readonly string[],code='invalid_manifest'):Record<string,unknown>{
  requirePortable(typeof value==='object'&&value!==null&&!Array.isArray(value),code);
  requirePortable(Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)),code);
  return value as Record<string,unknown>;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hex=/^[0-9a-f]{64}$/;
export function uuidValue(value:unknown):value is string{return typeof value==='string'&&uuid.test(value);}
const equalList=(a:unknown,b:readonly string[])=>Array.isArray(a)&&a.length===b.length&&a.every((item,i)=>item===b[i]);
const textOrder=(a:string,b:string)=>{
  const x=utf8.encode(a),y=utf8.encode(b);
  for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];
  return x.length-y.length;
};

export interface TableDescriptor{
  name:TableName;filename:string;columns:string[];rows:number;bytes:number;sha256:string;
}
export interface PortableManifest{
  format:'zenimport-portable';archive_version:2;financial_schema_version:1;
  archive_id:string;dataset_id:string;export_session_id:string;created_at:string;
  producer:{version:string;engine:'sqlite'|'indexeddb';contract_revision:string};
  zenmoney_identity:{owner_ids:string[];proof_version:1};required_features:string[];
  tables:TableDescriptor[];dataset_digest:string;
}

export function datasetDigest(manifest:PortableManifest):string{
  return digest(canonical({financial_schema_version:1,dataset_id:manifest.dataset_id,
    zenmoney_identity:{owner_ids:manifest.zenmoney_identity.owner_ids,proof_version:1},
    required_features:manifest.required_features,tables:manifest.tables.map(item=>({name:item.name,filename:item.filename,
      columns:item.columns,rows:item.rows,bytes:item.bytes,sha256:item.sha256}))}));
}

function timestamp(value:unknown):boolean{
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value))return false;
  const [year,month,day,hour,minute,second]=value.match(/^\d{4}|\d\d/g)!.slice(0,6).map(Number);
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  return year>=1&&month>=1&&month<=12&&day>=1&&day<=days[month-1]&&hour<24&&minute<60&&second<60;
}

export function validateManifest(input:unknown):PortableManifest{
  const value=object(input,PORTABLE.manifestKeys);
  requirePortable(value.format==='zenimport-portable'&&value.archive_version===2,'unsupported_format');
  requirePortable(value.financial_schema_version===1,'unsupported_schema');
  for(const field of ['archive_id','dataset_id','export_session_id'])requirePortable(uuidValue(value[field]),'invalid_manifest');
  requirePortable(timestamp(value.created_at),'invalid_timestamp');
  const producer=object(value.producer,['version','engine','contract_revision']);
  requirePortable(typeof producer.version==='string'&&['sqlite','indexeddb'].includes(producer.engine as string)&&
    typeof producer.contract_revision==='string'&&hex.test(producer.contract_revision));
  const identity=object(value.zenmoney_identity,['owner_ids','proof_version'],'invalid_identity');
  const owners=identity.owner_ids;
  requirePortable(identity.proof_version===1&&Array.isArray(owners)&&owners.length>=1&&owners.length<=200&&
    owners.every(owner=>typeof owner==='string'&&owner.length>0),'invalid_identity');
  const sorted=[...new Set(owners as string[])].sort(textOrder);
  requirePortable(equalList(owners,sorted),'invalid_identity');
  requirePortable(equalList(value.required_features,PORTABLE.features),'unsupported_features');
  requirePortable(Array.isArray(value.tables)&&value.tables.length===TABLES.length,'invalid_tables');
  let total=0;
  for(let i=0;i<TABLES.length;i++){
    const name=TABLES[i],item=object(value.tables[i],['name','filename','columns','rows','bytes','sha256'],'invalid_tables');
    requirePortable(item.name===name&&item.filename==='tables/'+name+'.ndjson'&&
      equalList(item.columns,SCHEMA[name].columns.map(column=>column.name)),'invalid_tables');
    for(const field of ['rows','bytes'])requirePortable(typeof item[field]==='number'&&Number.isInteger(item[field])&&
      (item[field] as number)>=0&&(item[field] as number)<=LIMITS.uncompressed_bytes,'invalid_tables');
    requirePortable(typeof item.sha256==='string'&&hex.test(item.sha256),'invalid_tables');total+=item.bytes as number;
  }
  const manifest=value as unknown as PortableManifest,bytes=canonical(manifest);
  // decodeJson rejects lone Unicode surrogates; validate generated manifests too.
  parseJson(bytes);
  requirePortable(bytes.length<=LIMITS.manifest_bytes,'manifest_too_large');
  requirePortable(total+bytes.length<=LIMITS.uncompressed_bytes,'dataset_too_large');
  requirePortable(typeof value.dataset_digest==='string'&&value.dataset_digest===datasetDigest(manifest),'digest_mismatch');
  return manifest;
}

export function rowBytes(table:TableName,input:unknown):{row:TaggedRow;key:string;bytes:Uint8Array}{
  try{
    const row=validateCells(table,input),bytes=canonical(row);
    requirePortable(bytes.length<=LIMITS.row_bytes,'row_too_large');return {row,key:rowKey(table,row),bytes};
  }catch(error){if(error instanceof PortableError)throw error;throw new PortableError('invalid_row');}
}

/** Stream LF-terminated canonical rows without assembling an entire table. */
export class TableScanner{
  #parts:Uint8Array[]=[];#pending=0;#previous:string|null=null;
  #count=0;#size=0;#hash=sha256.create();#closed=false;
  constructor(readonly table:TableName,readonly accept:(row:TaggedRow)=>Promise<void>){}
  async push(chunk:Uint8Array):Promise<void>{
    requirePortable(!this.#closed);
    this.#hash.update(chunk);this.#size+=chunk.length;
    requirePortable(this.#size<=LIMITS.uncompressed_bytes,'dataset_too_large');
    let start=0;
    for(let i=0;i<chunk.length;i++)if(chunk[i]===10){
      const end=chunk.subarray(start,i+1),size=this.#pending+end.length;
      requirePortable(size<=LIMITS.row_bytes,'row_too_large');
      let raw=end;
      if(this.#parts.length){raw=new Uint8Array(size);let offset=0;for(const part of this.#parts){raw.set(part,offset);offset+=part.length;}raw.set(end,offset);}
      const {row,key,bytes}=rowBytes(this.table,parseJson(raw));
      requirePortable(this.#previous===null||this.#previous<key,'duplicate_or_unordered_key');
      requirePortable(bytes.length===raw.length&&bytes.every((byte,index)=>byte===raw[index]),'noncanonical_row');
      this.#previous=key;this.#count++;this.#parts=[];this.#pending=0;
      await this.accept(row);start=i+1;
    }
    if(start<chunk.length){const part=chunk.slice(start);this.#parts.push(part);this.#pending+=part.length;requirePortable(this.#pending<LIMITS.row_bytes,'row_too_large');}
  }
  finish(expected?:TableDescriptor):TableDescriptor{
    requirePortable(!this.#closed&&this.#pending===0,'invalid_row');this.#closed=true;
    const item:TableDescriptor={name:this.table,filename:'tables/'+this.table+'.ndjson',columns:SCHEMA[this.table].columns.map(column=>column.name),
      rows:this.#count,bytes:this.#size,sha256:bytesToHex(this.#hash.digest())};
    requirePortable(expected===undefined||(item.name===expected.name&&item.filename===expected.filename&&
      equalList(expected.columns,item.columns)&&item.rows===expected.rows&&item.bytes===expected.bytes&&item.sha256===expected.sha256),
    'table_integrity_mismatch');return item;
  }
}
