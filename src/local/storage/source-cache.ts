/** Disposable worker-local acceleration. Native snapshots and guards remain authority. */
import {SOURCE_TABLES} from '../reconciliation/source-tables.js';
import type {SourceRows,SourceTable} from '../reconciliation/source-tables.js';
import type {FinancialSnapshot} from './source-stamp.js';
import type {RowByTable,TableName} from './schema.generated.js';
import {packRow,unpackRow,rowKey,encodeKey} from './cells.js';
import type {PreparedMirror} from '../zenmoney/projection.js';
type Row=RowByTable[SourceTable];
type Change={table:SourceTable;key:string;row:Row|null;onlyAbsent?:boolean}|{table:'zen_entities';kinds:readonly string[]};
const tables=new Set<string>(SOURCE_TABLES),MAX_ROWS=2000000,MAX_BYTES=256*1024*1024,MAX_CHANGES=10000,MAX_DELTA=8*1024*1024;
const equal=(a:FinancialSnapshot,b:FinancialSnapshot)=>JSON.stringify(a)===JSON.stringify(b);
const size=(row:Row)=>JSON.stringify(row).length*2;
interface Entry{key:string;stamp:FinancialSnapshot;tables:Map<SourceTable,Map<string,Row>>;arrays:Partial<SourceRows>;count:number;bytes:number}
let entry:Entry|null=null;
export function forgetSource(){entry=null;}
export function hasSource(key:string){return entry?.key===key;}
export function cachedSource(key:string,stamp:FinancialSnapshot):SourceRows|null{
 if(!entry||entry.key!==key||!equal(entry.stamp,stamp))return null;
 const arrays=entry.arrays as Record<SourceTable,readonly Row[]>;
 for(const table of SOURCE_TABLES)if(!arrays[table])arrays[table]=Object.freeze([...entry.tables.get(table)!].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,row])=>row));
 return {...arrays} as SourceRows;
}
export function rememberSource(key:string,stamp:FinancialSnapshot,rows:SourceRows){
 // Cache failures must never change the outcome of a successful financial read.
 try{
  const next:Entry={key,stamp:{...stamp},tables:new Map(),arrays:{},count:0,bytes:0};
  for(const table of SOURCE_TABLES){const values=new Map<string,Row>();next.tables.set(table,values);
   for(const row of rows[table]){next.count++;next.bytes+=size(row);if(next.count>MAX_ROWS||next.bytes>MAX_BYTES){entry=null;return;}
    values.set(rowKey(table,packRow(table,row)),Object.freeze({...row}) as Row);}
  }
  entry=next;
 }catch{entry=null;}
}
/** Changes are collected only for a warm entry; aborted native writes publish nothing. */
export class SourceChanges{
 enabled=false;invalid=false;items:Change[]=[];bytes=0;
 #add(change:Change){
  if(!this.enabled||this.invalid)return;
  this.bytes+=JSON.stringify(change).length*2;
  if(this.items.length>=MAX_CHANGES||this.bytes>MAX_DELTA){this.invalid=true;this.items=[];return;}
  this.items.push(change);
 }
 upsert<K extends TableName>(table:K,key:string,row:RowByTable[K],onlyAbsent=false){
  if(this.enabled&&!this.invalid&&tables.has(table))this.#add({table:table as SourceTable,key,row:Object.freeze(unpackRow(table,packRow(table,row))) as unknown as Row,onlyAbsent});
 }
 remove(table:TableName,key:string){if(tables.has(table))this.#add({table:table as SourceTable,key,row:null});}
 mirror(batch:PreparedMirror){
  if(!this.enabled||this.invalid)return;
  if(this.items.length+batch.entities.length+batch.tombstones.length+batch.deletions.length+(batch.full?1:0)>MAX_CHANGES){this.invalid=true;this.items=[];return;}
  if(batch.full)this.#add({table:'zen_entities',kinds:[...batch.kinds]});
  for(const row of batch.entities){if(this.invalid)return;this.upsert('zen_entities',rowKey('zen_entities',packRow('zen_entities',row)),row);}
  for(const row of batch.tombstones){if(this.invalid)return;this.upsert('zen_tombstones',rowKey('zen_tombstones',packRow('zen_tombstones',row)),row,true);}
  for(const row of batch.deletions)this.remove('zen_entities',encodeKey([['text',row.kind],['text',row.entity_id]]));
 }
}
/** Call only after the enclosing native transaction has committed. */
export function publishSource(key:string,before:FinancialSnapshot,after:FinancialSnapshot,changes:SourceChanges){
 try{
  if(!entry||entry.key!==key)return;
  const authority=['generation','epoch','credentialEpoch','credentialRef','participantId','participantEpoch'] as const;
  if(changes.invalid||authority.some(field=>before[field]!==after[field])||!equal(entry.stamp,before)){entry=null;return;}
  for(const change of changes.items){
   const values=entry.tables.get(change.table)!;
   const apply=(key:string,row:Row|null,onlyAbsent=false)=>{const old=values.get(key);if(onlyAbsent&&old)return;
    if(old){entry!.count--;entry!.bytes-=size(old);}if(row){values.set(key,row);entry!.count++;entry!.bytes+=size(row);}else values.delete(key);
   };
   if('kinds' in change){const kinds=new Set(change.kinds);for(const [key,row] of values)if(kinds.has((row as RowByTable['zen_entities']).kind))apply(key,null);}
   else apply(change.key,change.row,change.onlyAbsent);
   delete entry.arrays[change.table];
   if(entry.count>MAX_ROWS||entry.bytes>MAX_BYTES){entry=null;return;}
  }
  entry.stamp={...after};
 }catch{entry=null;}
}
