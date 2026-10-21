/** Single-use dispatch authority is private to this physical browser generation. */
import type {FinancialSnapshot} from './source-stamp.js';
import type {FinancialDatabase} from './database.js';
import {int64,requireStorage} from './types.js';
export interface OutboxItem{bank_id:string;zen_id:string;payload:string}
export interface OutboxBatch{id:string;deadline:string;source:FinancialSnapshot;items:OutboxItem[]}
export interface OutboxControl extends OutboxBatch{phase:'prepared'|'dispatching'|'settled'}
export const outboxScope=(generation:string)=>'outbox:'+generation;
export function outboxControl(input:unknown):OutboxControl{
  requireStorage(input!==null&&typeof input==='object'&&!Array.isArray(input),'storage_corrupt');const value=input as OutboxControl;
  requireStorage(Object.keys(value).sort().join(',')==='deadline,id,items,phase,source'&&typeof value.id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.id)&&
    ['prepared','dispatching','settled'].includes(value.phase)&&value.source!==null&&typeof value.source==='object'&&!Array.isArray(value.source)&&typeof value.deadline==='string'&&
    Array.isArray(value.items)&&value.items.length>0&&value.items.length<=20,'storage_corrupt');
  try{requireStorage(BigInt(int64(value.deadline))>=0n,'storage_corrupt');}catch{requireStorage(false,'storage_corrupt');}
  const banks=new Set<string>(),ids=new Set<string>();
  for(const item of value.items){
    requireStorage(item!==null&&typeof item==='object'&&!Array.isArray(item)&&Object.keys(item).sort().join(',')==='bank_id,payload,zen_id'&&
      typeof item.bank_id==='string'&&item.bank_id.length>0&&item.bank_id.length<=4096&&typeof item.zen_id==='string'&&item.zen_id.length>0&&item.zen_id.length<=1024&&typeof item.payload==='string'&&item.payload.length>0&&item.payload.length<=65536&&!banks.has(item.bank_id)&&!ids.has(item.zen_id),'storage_corrupt');
    banks.add(item.bank_id);ids.add(item.zen_id);
  }return value;
}
export async function readOutbox(db:FinancialDatabase,generation:string){const row=await db.applicationState.get(outboxScope(generation));if(row===undefined)return null;const control=outboxControl(row.value);requireStorage(control.source.generation===generation,'storage_corrupt');return control;}
export function outboxActive(control:OutboxControl|null,now:string){return control!==null&&control.phase!=='settled'&&BigInt(control.deadline)>BigInt(int64(now));}
export const outboxValue=(control:OutboxControl)=>({scope:outboxScope(control.source.generation),value:{...control}});
