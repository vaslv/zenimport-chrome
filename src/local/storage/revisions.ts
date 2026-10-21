/** Private mutation revision: not a financial row and never portable evidence. */
import type {TableName} from './schema.generated.js';
import type {FinancialDatabase} from './database.js';
import {int64,requireStorage,StorageError} from './types.js';
export function isDerivedCache(table:TableName){return table==='category_evidence'||table==='category_payments'||table==='category_predictions';}
export async function financialRevision(db:FinancialDatabase,generation:string){
  const row=await db.applicationState.get('financial-revision:'+generation);if(row===undefined)return int64('0');
  requireStorage(row.value!==null&&typeof row.value==='object'&&!Array.isArray(row.value)&&Object.keys(row.value).join(',')==='revision'&&typeof row.value.revision==='string','storage_corrupt');
  let value;try{value=int64(row.value.revision);}catch{throw new StorageError('storage_corrupt');}
  requireStorage(BigInt(value)>=0n,'storage_corrupt');return value;
}
export async function advanceFinancialRevision(db:FinancialDatabase,generation:string){
  const revision=await financialRevision(db,generation);requireStorage(BigInt(revision)<9223372036854775807n,'storage_corrupt');
  await db.applicationState.put({scope:'financial-revision:'+generation,value:{revision:int64(String(BigInt(revision)+1n))}});
}
