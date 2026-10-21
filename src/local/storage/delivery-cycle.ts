/** Private expiring cycle lease; it never replaces the financial outbox grant. */
import type {FinancialDatabase} from './database.js';
import {int64,requireStorage} from './types.js';
export interface DeliveryCycle{id:string;deadline:string}
export const cycleScope=(generation:string)=>'delivery-cycle:'+generation;
export async function readCycle(db:FinancialDatabase,generation:string):Promise<DeliveryCycle|null>{
  const value=(await db.applicationState.get(cycleScope(generation)))?.value;
  if(value===undefined)return null;
  requireStorage(value!==null&&typeof value==='object'&&Object.keys(value).sort().join(',')==='deadline,id'&&typeof value.id==='string'&&/^[0-9a-f-]{36}$/.test(value.id)&&typeof value.deadline==='string','storage_corrupt');
  requireStorage(BigInt(int64(value.deadline))>=0n,'storage_corrupt');return value as unknown as DeliveryCycle;
}
