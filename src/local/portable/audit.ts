/** Classified portable audit. Historical SQL is compared as inert text only. */
import {ExactDecimal} from 'zenmoney-typescript';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {canonicalDto} from '../../domain/codec.js';
import {SCHEMA} from '../storage/schema.generated.js';
import type {TableName} from '../storage/schema.generated.js';
import type {GraphReader} from './relations.js';
import {financialJson,metadataValue} from './inspect.js';
import {requirePortable,utf8} from './format.js';
import type {PortableManifest} from './format.js';
import {VALIDATION} from './validation.generated.js';

const text=(value:string)=>['text',value] as const;
const known=new Map<string,(typeof VALIDATION.legacy_objects)[number]>(VALIDATION.legacy_objects.map(value=>[value.type+'/'+value.name,value]));

/** Exactly the old snapshot's packed object/column header, including ASCII JSON. */
export function legacyHeader(values:readonly (string|null)[]):string{
  return canonicalDto(values.map(value=>value===null?['null',null]:['text',value]))+'\n';
}

function record(value:unknown,code:string):Record<string,unknown>{
  requirePortable(value!==null&&typeof value==='object'&&!Array.isArray(value)&&!(value instanceof ExactDecimal),code);
  return value as Record<string,unknown>;
}
function unsignedInteger(value:unknown):bigint{
  requirePortable(typeof value==='bigint'||typeof value==='number'&&Number.isSafeInteger(value),'invalid_legacy_manifest');
  const result=BigInt(value);requirePortable(result>=0n,'invalid_legacy_manifest');return result;
}

export function legacyCell(value:unknown):string|bigint|null{
  requirePortable(Array.isArray(value)&&value.length===2,'invalid_legacy_row');
  const [tag,cell]=value;
  if(tag==='null'){requirePortable(cell===null,'invalid_legacy_row');return null;}
  requirePortable((tag==='text'||tag==='integer')&&typeof cell==='string','invalid_legacy_row');
  if(tag==='text')return cell;
  requirePortable(cell.length-(cell.startsWith('-')?1:0)<=4300&&/^(?:0|-?[1-9][0-9]*)$/.test(cell),'invalid_legacy_row');return BigInt(cell);
}

async function verifyLegacyDigest(reader:GraphReader,digest:string,input:unknown):Promise<void>{
  const counts=record(input,'invalid_legacy_manifest'),expected=new Map(Object.entries(counts).map(([name,value])=>[name,unsignedInteger(value)]));
  const actual=new Map<string,bigint>(),hash=sha256.create();
  for await(const row of reader.rows('legacy_rows',[text(digest)]))actual.set(row.table_name,(actual.get(row.table_name)??0n)+1n);
  for await(const obj of reader.rows('legacy_objects',[text(digest)])){
    hash.update(utf8.encode(legacyHeader([obj.type,obj.name,obj.table_name,obj.sql])));
    if(obj.type!=='table')continue;
    const columns=financialJson(obj.columns_json!);requirePortable(Array.isArray(columns)&&columns.every(value=>typeof value==='string'),'unclassified_legacy_column');
    hash.update(utf8.encode(legacyHeader(columns as string[])));
    for await(const row of reader.rows('legacy_rows',[text(digest),text(obj.name)])){
      hash.update(utf8.encode(row.values_json+'\n'));
    }
  }
  // Match the reference: absent empty tables count as zero; extra row tables fail.
  for(const [name,value]of expected)requirePortable((actual.get(name)??0n)===value,'invalid_legacy_audit');
  for(const name of actual.keys())requirePortable(expected.has(name),'invalid_legacy_audit');
  requirePortable(bytesToHex(hash.digest())===digest,'invalid_legacy_audit');
}

export async function validateAudit(reader:GraphReader,manifest:PortableManifest):Promise<void>{
  for(const table of Object.keys(SCHEMA) as TableName[]){
    const columns=[...new Set(SCHEMA[table].checks.flatMap(check=>[...check.matchAll(/json_valid\((\w+)\)/g)].map(match=>match[1])))];
    if(!columns.length)continue;
    for await(const row of reader.rows(table))for(const column of columns){
      const value=(row as Record<string,unknown>)[column];if(value!==null){requirePortable(typeof value==='string','invalid_financial_json');financialJson(value);}
    }
  }
  let identity=false;
  for await(const row of reader.rows('dataset_metadata')){metadataValue(row.key,row.value,manifest.dataset_id);if(row.key==='instance_id')identity=true;}
  requirePortable(identity,'lineage_mismatch');
  for await(const row of reader.rows('source_schema_migrations'))requirePortable(BigInt(row.version)>=1n&&BigInt(row.applied_at)>=0n&&row.backup_path===null,'invalid_schema_audit');
  for await(const row of reader.rows('legacy_objects')){
    const reference=known.get(row.type+'/'+row.name);
    requirePortable(reference!==undefined&&row.table_name===reference.table_name&&row.sql===reference.sql,'unclassified_legacy_object');
    const names=row.columns_json===null?null:financialJson(row.columns_json);
    requirePortable(reference.columns===null?names===null:Array.isArray(names)&&names.length===reference.columns.length&&names.every((value,i)=>value===reference.columns![i]),'unclassified_legacy_column');
  }
  for await(const row of reader.rows('legacy_rows')){
    const reference=known.get('table/'+row.table_name);requirePortable(reference!==undefined,'unclassified_legacy_object');
    const values=financialJson(row.values_json);
    requirePortable(Array.isArray(values)&&values.length===reference.columns!.length,'invalid_legacy_row');
    if(row.table_name==='bank_transactions')for(const cell of values)legacyCell(cell);
    if(row.table_name==='meta'){
      requirePortable(values.length===2&&values.every(cell=>Array.isArray(cell)&&cell.length===2&&cell[0]==='text'),'unclassified_metadata');
      metadataValue('legacy:'+(values[0] as unknown[])[1],(values[1] as unknown[])[1],manifest.dataset_id);
    }
  }
  for await(const row of reader.rows('legacy_imports'))await verifyLegacyDigest(reader,row.digest,financialJson(row.manifest_json));
}
