/** Bounded source snapshot under an already durable hold. No executable leases. */
import Dexie from 'dexie';
import type {FinancialDatabase,FinancialEnvelope} from './database.js';
import type {GraphReader} from '../portable/relations.js';
import type {TableName,RowByTable} from './schema.generated.js';
import {SCHEMA} from './schema.generated.js';
import type {Scalar} from './types.js';
import {requireStorage} from './types.js';
import {unpackRow,encodeKey,rowKey} from './cells.js';
import {envelope} from './envelope.js';
import {requirePortable} from '../portable/format.js';

export class HeldReader implements GraphReader{
  constructor(private db:FinancialDatabase,private generation:string,private before:()=>Promise<void>,
    private guard:()=>Promise<void>){}
  #row<K extends TableName>(table:K,value:FinancialEnvelope):RowByTable[K]{
    const expected=envelope(this.generation,table,value.row);
    requireStorage(value.generation===this.generation&&rowKey(table,value.row)===value.key&&Object.keys(expected).length===Object.keys(value).length&&
      Object.keys(expected).every(key=>key==='row'||expected[key]===value[key]),'storage_corrupt');
    const row=unpackRow(table,value.row);
    if(table==='source_capture_leases')requirePortable(false,'capture_not_quiescent');
    if(table==='capture_jobs'){
      const job=row as RowByTable['capture_jobs'];requirePortable(!['planned','collecting','paused'].includes(job.capture_state),'capture_not_quiescent');
      return {...job,worker_id:null,lease_expires_at:null} as RowByTable[K];
    }
    if(table==='deliveries')requirePortable((row as RowByTable['deliveries']).state!=='attempting','delivery_not_quiescent');
    if(table==='source_schema_migrations')return {...row,backup_path:null};
    return row;
  }
  async *rows<K extends TableName>(table:K,prefix:readonly Scalar[]=[]):AsyncIterable<RowByTable[K]>{
    requireStorage(prefix.length<=SCHEMA[table].primary.length,'schema_unsupported');
    const key=prefix.length?encodeKey(prefix):null,whole=prefix.length===SCHEMA[table].primary.length;
    const lower=key===null?Dexie.minKey:key+(whole?'':'/'),upper=key===null?Dexie.maxKey:key+(whole?'':'/\uffff');let after:string|null=null;
    while(true){
      await this.before();const values=await this.db.transaction('r',this.db.tables,async()=>{
        await this.guard();return this.db.financial(table).where('[generation+key]').between([this.generation,after??lower],[this.generation,upper],after===null,true).limit(500).toArray();
      });
      if(!values.length)break;for(const value of values)yield this.#row(table,value);after=values[values.length-1].key;
    }
  }
  async find<K extends TableName>(table:K,columns:readonly string[],values:readonly Scalar[]):Promise<RowByTable[K]|null>{
    const same=(a:readonly string[],b:readonly string[])=>a.length===b.length&&a.every((value,i)=>value===b[i]);
    const definition=SCHEMA[table],primary=same(columns,definition.primary),index=definition.indexes.find(index=>index.unique&&!index.partial&&same(columns,index.columns));
    requireStorage(columns.length===values.length&&(primary||index!==undefined),'schema_unsupported');await this.before();
    return this.db.transaction('r',this.db.tables,async()=>{
      await this.guard();const key=encodeKey(values),value=primary?await this.db.financial(table).get([this.generation,key]):
        await this.db.financial(table).where('[generation+'+index!.key+']').equals([this.generation,key]).first();
      return value===undefined?null:this.#row(table,value);
    });
  }
}
