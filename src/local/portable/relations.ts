/** Read-only relational proof. This result never grants activation rights. */
import type {RowByTable,TableName} from '../storage/schema.generated.js';
import {SCHEMA} from '../storage/schema.generated.js';
import type {Scalar} from '../storage/types.js';
import {packRow,rowKey} from '../storage/cells.js';
import {envelope,field} from '../storage/envelope.js';
import {requirePortable} from './format.js';
import {rowBytes} from './format.js';
import type {PortableManifest} from './format.js';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';

export interface GraphReader{
  rows<K extends TableName>(table:K,primaryPrefix?:readonly Scalar[]):AsyncIterable<RowByTable[K]>;
  /** Packaged primary/unique columns only. No query language or SQL input. */
  find<K extends TableName>(table:K,columns:readonly string[],values:readonly Scalar[]):Promise<RowByTable[K]|null>;
}

const text=(value:string):Scalar=>['text',value];

async function insertProof(reader:GraphReader,table:TableName,data:RowByTable[TableName]):Promise<void>{
  if(table==='capture_intervals'){
    const row=data as RowByTable['capture_intervals'];
    const snapshot=await reader.find('job_accounts',['job_id','account_id'],[text(row.job_id),text(row.account_id)]);
    requirePortable(snapshot!==null&&snapshot.settings_version===row.settings_version,'invalid_insert_proof');
  }else if(table==='captured_records'){
    const row=data as RowByTable['captured_records'];
    const interval=await reader.find('capture_intervals',['id'],[text(row.interval_id)]);
    const bank=await reader.find('bank_transactions',['id'],[text(row.bank_id)]);
    requirePortable(interval!==null&&bank!==null&&interval.account_id===bank.account_id,'invalid_insert_proof');
  }else if(table==='delivery_authorizations'){
    const row=data as RowByTable['delivery_authorizations'];
    const proof=await reader.find('captured_records',['interval_id','bank_id'],[text(row.interval_id),text(row.bank_id)]);
    const interval=await reader.find('capture_intervals',['id'],[text(row.interval_id)]);
    const bank=await reader.find('bank_transactions',['id'],[text(row.bank_id)]);
    const snapshot=bank===null?null:await reader.find('job_accounts',['job_id','account_id'],[text(row.job_id),text(bank.account_id)]);
    requirePortable(proof!==null&&interval!==null&&snapshot!==null&&proof.revision===row.revision&&
      interval.state==='complete'&&snapshot.settings_version===row.settings_version&&snapshot.target_id===row.target_id,'invalid_insert_proof');
  }
}

export async function validateRelations(reader:GraphReader,manifest?:PortableManifest):Promise<Readonly<Record<TableName,string>>>{
  const insertNames=Object.values(SCHEMA).flatMap(table=>table.triggers.filter(trigger=>/BEFORE\s+INSERT\s+ON/i.test(trigger.sql)).map(trigger=>trigger.name)).sort();
  requirePortable(insertNames.join(',')==='captured_record_scope,delivery_authorization_proof,interval_scope','unsupported_invariant');
  // Readers represent immutable staged/held graphs and recheck their authority
  // on each bounded page; final proof publication has its own nonce/Root CAS.
  // Repeated positive FK facts need not open another native transaction per row.
  const foreignFacts=new Set<string>();
  const counts={} as Record<TableName,string>;
  for(const table of Object.keys(SCHEMA).sort() as TableName[]){
    const definition=SCHEMA[table],seen=definition.indexes.filter(index=>index.unique).map(index=>({index,keys:new Set<string>()}));
    const expected=manifest?.tables.find(value=>value.name===table),hash=manifest?sha256.create():null;let bytes=0;
    requirePortable(manifest===undefined||expected!==undefined,'invalid_tables');
    let previous:string|null=null,count=0n;
    for await(const data of reader.rows(table)){
      const packed=packRow(table,data),value=envelope('relational-proof-only',table,packed),key=rowKey(table,packed);
      requirePortable(previous===null||previous<key,'duplicate_or_unordered_key');previous=key;count++;
      if(hash&&expected){
        const raw=rowBytes(table,packed).bytes;bytes+=raw.length;
        requirePortable(count<=BigInt(expected.rows)&&bytes<=expected.bytes,'table_integrity_mismatch');hash.update(raw);
      }
      for(const {index,keys}of seen){
        const candidate=value[index.key];if(candidate===undefined)continue;
        requirePortable(typeof candidate==='string'&&!keys.has(candidate),'invalid_relationship');keys.add(candidate);
      }
      for(const foreign of definition.foreignKeys){
        const values=foreign.columns.map(column=>field(table,packed,column));
        if(values.some(value=>value[0]==='null'))continue; // SQLite MATCH SIMPLE.
        const key=JSON.stringify([foreign.table,foreign.target,values]);
        if(!foreignFacts.has(key)){
          requirePortable(await reader.find(foreign.table,foreign.target,values)!==null,'invalid_relationship');
          if(foreignFacts.size>=1024)foreignFacts.clear();foreignFacts.add(key);
        }
      }
      await insertProof(reader,table,data);
    }
    counts[table]=count.toString();
    if(hash&&expected)requirePortable(count===BigInt(expected.rows)&&bytes===expected.bytes&&bytesToHex(hash.digest())===expected.sha256,'table_integrity_mismatch');
  }
  return counts;
}
