/** Bounded construction of an unpublished mirror view; publication is separate. */
import Dexie from 'dexie';
import type {FinancialDatabase,FinancialEnvelope} from './database.js';
import {MIRROR_TABLES} from './mirror-scope.js';
import {envelope} from './envelope.js';
import {rowKey} from './cells.js';
import {requireStorage} from './types.js';
import type {MirrorWrites} from './mirror-write.js';
export type OwnedMirrorUnit=<T>(operation:()=>Promise<T>)=>Promise<T>;
export async function stageMirror(db:FinancialDatabase,source:string,destination:string,writes:MirrorWrites,run:FinancialEnvelope,owned:OwnedMirrorUnit){
  const {batch,rows}=writes,changed=new Set(batch.entities.map(row=>JSON.stringify([row.kind,row.id]))),deleted=new Set(batch.deletions.map(row=>JSON.stringify([row.kind,row.entity_id])));
  const removed=(value:FinancialEnvelope)=>value.row[0][0]==='text'&&value.row[1][0]==='text'&&deleted.has(JSON.stringify([value.row[0][1],value.row[1][1]]));
  for(const table of MIRROR_TABLES){
    let after:string|null=null;
    while(true){
      const values:FinancialEnvelope[]=await owned(()=>db.financial(table).where('[generation+key]')
        .between([source,after??Dexie.minKey],[source,Dexie.maxKey],after===null,true).limit(table==='zen_sync_runs'?1:500).toArray());
      if(!values.length)break;after=values[values.length-1].key;
      const copied:FinancialEnvelope[]=[];
      for(const value of values){
        requireStorage(value.generation===source&&value.key===rowKey(table,value.row),'storage_corrupt');
        const kind=value.row[0][0]==='text'?value.row[0][1]:null;
        if(['zen_entities','zen_movements','zen_tags'].includes(table)&&removed(value))continue;
        // Only these three tables have a kind-leading primary key. Raw runs,
        // deletion audit and permanent tombstones always survive replacement.
        if(['zen_entities','zen_movements','zen_tags'].includes(table)&&batch.full&&batch.kinds.includes(kind!))continue;
        if(table==='zen_tags'&&!batch.full&&value.row[1][0]==='text'&&changed.has(JSON.stringify([kind,value.row[1][1]])))continue;
        copied.push(envelope(destination,table,value.row));
      }
      if(copied.length)await owned(()=>db.financial(table).bulkAdd(copied));
    }
  }
  await owned(()=>db.financial('zen_sync_runs').add(run));
  for(const table of ['zen_entities','zen_movements','zen_tags','zen_deletions'] as const)
    for(let i=0;i<rows[table].length;i+=500){const chunk=rows[table].slice(i,i+500).filter(row=>table==='zen_deletions'||!removed(row));
      if(chunk.length)await owned(()=>table==='zen_deletions'?db.financial(table).bulkAdd(chunk):db.financial(table).bulkPut(chunk));}
  for(let i=0;i<rows.zen_tombstones.length;i+=500){const chunk=rows.zen_tombstones.slice(i,i+500);await owned(async()=>{
    const old=await db.financial('zen_tombstones').bulkGet(chunk.map(row=>[destination,row.key]));
    const fresh=chunk.filter((_,index)=>old[index]===undefined);if(fresh.length)await db.financial('zen_tombstones').bulkAdd(fresh);
  });}
  // Deleted identities were excluded during construction, so a deletion with a
  // very large old tag collection never becomes an unbounded range erase.
}
