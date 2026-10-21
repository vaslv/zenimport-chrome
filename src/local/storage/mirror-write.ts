/** Fixed mirror subgraph replacement, never a generic application mutation API. */
import Dexie from 'dexie';
import type {FinancialDatabase,FinancialEnvelope} from './database.js';
import {envelope} from './envelope.js';
import {encodeKey,packRow} from './cells.js';
import type {TableName} from './schema.generated.js';
import {requireStorage} from './types.js';
import type {PreparedMirror} from '../zenmoney/projection.js';
type MirrorTable='zen_entities'|'zen_movements'|'zen_tags'|'zen_tombstones'|'zen_deletions';
export interface MirrorWrites{batch:PreparedMirror;rows:Record<MirrorTable,FinancialEnvelope[]>}
export function prepareMirrorWrites(generation:string,batch:PreparedMirror):MirrorWrites{
  const rows:MirrorWrites['rows']={zen_entities:[],zen_movements:[],zen_tags:[],zen_tombstones:[],zen_deletions:[]};
  for(const row of batch.entities)rows.zen_entities.push(envelope(generation,'zen_entities',packRow('zen_entities',row)));
  for(const row of batch.movements)rows.zen_movements.push(envelope(generation,'zen_movements',packRow('zen_movements',row)));
  for(const row of batch.tags)rows.zen_tags.push(envelope(generation,'zen_tags',packRow('zen_tags',row)));
  const tombstones=new Set<string>();
  for(const row of batch.tombstones){const value=envelope(generation,'zen_tombstones',packRow('zen_tombstones',row));
    if(!tombstones.has(value.key)){rows.zen_tombstones.push(value);tombstones.add(value.key);}}
  for(const row of batch.deletions)rows.zen_deletions.push(envelope(generation,'zen_deletions',packRow('zen_deletions',row)));
  return {batch,rows};
}
export async function writeMirror(db:FinancialDatabase,generation:string,writes:MirrorWrites){
  requireStorage(!!Dexie.currentTransaction&&Dexie.currentTransaction.mode==='readwrite','stale_epoch');
  const {batch,rows}=writes;
  async function removePrefix(table:TableName,parts:string[]){
    const prefix=encodeKey(parts.map(value=>['text',value] as const))+'/';
    await db.financial(table).where('[generation+key]').between([generation,prefix],[generation,prefix+'\uffff'],true,true).delete();
  }
  // These are the only two children of zen_entities. Mirror replacement does
  // not delete receipts, tombstones or any bank/delivery fact. All new children
  // reference an entity from this validated batch, whose run was inserted first.
  if(batch.full)for(const kind of batch.kinds)for(const table of ['zen_tags','zen_movements','zen_entities'] as const)await removePrefix(table,[kind]);
  else for(const row of batch.entities)await removePrefix('zen_tags',[row.kind,row.id]);
  for(const table of ['zen_entities','zen_movements','zen_tags'] as const)
    for(let i=0;i<rows[table].length;i+=500)await db.financial(table).bulkPut(rows[table].slice(i,i+500));
  for(let i=0;i<rows.zen_deletions.length;i+=500)await db.financial('zen_deletions').bulkAdd(rows.zen_deletions.slice(i,i+500));
  // Permanent first-observed deletion evidence is append-only, even when the
  // remote object later reappears or soft deletion is followed by hard deletion.
  for(let i=0;i<rows.zen_tombstones.length;i+=500){
    const chunk=rows.zen_tombstones.slice(i,i+500),old=await db.financial('zen_tombstones').bulkGet(chunk.map(row=>[generation,row.key]));
    const fresh=chunk.filter((_,index)=>old[index]===undefined);if(fresh.length)await db.financial('zen_tombstones').bulkAdd(fresh);
  }
  for(const row of batch.deletions){
    await removePrefix('zen_tags',[row.kind,row.entity_id]);const key=encodeKey([['text',row.kind],['text',row.entity_id]]);
    await db.financial('zen_movements').delete([generation,key]);await db.financial('zen_entities').delete([generation,key]);
  }
}
