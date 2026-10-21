/** Offline fixture API. Bundled only into the excluded storage probe. */
import Dexie from 'dexie';
import {FinancialDatabase,financialStoreName,storeDefinitions} from './database.js';
import {writeTransaction} from './kernel.js';
import type {RepositorySession} from './kernel.js';
import {storageFailure} from './types.js';
import type {Scalar} from './types.js';
import type {TableName,RowByTable} from './schema.generated.js';
import type {ContextFence,SentinelPort} from '../../control/types.js';

interface Operation{kind:'insert'|'replace'|'remove'|'get';table:TableName;fields:RowByTable[TableName];primary:Scalar[];catch?:boolean}
export interface KernelArguments{name:string;fence:ContextFence;operations?:Operation[];mode?:string;patch?:Record<string,unknown>;table?:TableName}
let escaped:RepositorySession|undefined;
let transactionCheckpoint=false;
export function kernelCheckpoint():boolean{return transactionCheckpoint;}

export async function kernelProbe(args:KernelArguments,sentinel:SentinelPort):Promise<unknown>{
  const db=new FinancialDatabase(args.name,false);
  try{
    await db.open();
    if(args.mode==='control'){
      await db.runtime.update('runtime',args.patch??{});return true;
    }
    if(args.mode==='escape'){
      await writeTransaction(db,sentinel,args.fence,async session=>{escaped=session;});
      await escaped!.insert('dataset_metadata',{key:'escaped',value:'forbidden'});return false;
    }
    if(args.mode==='pause-transaction'||args.mode==='quota-transaction'){
      await writeTransaction(db,sentinel,args.fence,async session=>{
        await session.insert('dataset_metadata',{key:'partial-write',value:'must never commit'});
        if(args.mode==='quota-transaction')throw new DOMException('synthetic-private-detail','QuotaExceededError');
        transactionCheckpoint=true;
        await Dexie.waitFor(new Promise<void>(()=>{}));
      });
      return false;
    }
    if(args.mode==='foreign-generation'){
      const row=(await db.financial(args.table!).toArray())[0];
      await db.financial(args.table!).delete([row.generation,row.key]);
      await db.financial(args.table!).add({...row,generation:crypto.randomUUID()});return true;
    }
    if(args.mode==='upgrade-stage-v3'||args.mode==='failed-upgrade-stage-v3'){
      const name=args.name+'-stage-v3';await Dexie.delete(name);
      const old=new Dexie(name,{autoOpen:false});
      old.version(3).stores({...storeDefinitions(true),portable_stages:'id,state,createdAt'});await old.open();
      try{
        // Copy the old layout only; new authority stores did not exist in v3.
        for(const table of old.tables){
          const values=await db.table(table.name).toArray();
          if(table.name==='portable_stages')for(const value of values){
            delete value.graphVersion;delete value.graphDigest;delete value.graphVerifiedAt;
            if(args.mode==='failed-upgrade-stage-v3')value.unexpected='reject';
          }
          await old.table(table.name).bulkAdd(values);
        }
      }finally{old.close();}
      const upgraded=new FinancialDatabase(name,false);let code:string|null=null;
      try{await upgraded.open();}catch(error){code=storageFailure(error).code;}finally{upgraded.close();}
      const inspect=new Dexie(name);await inspect.open();
      try{return {code,version:inspect.verno,stages:await inspect.table('portable_stages').toArray()};}
      finally{inspect.close();}
    }
    if(args.mode==='upgrade'||args.mode==='failed-upgrade'){
      const name=args.name+'-old';await Dexie.delete(name);
      const old=new Dexie(name,{autoOpen:false});old.version(1).stores(storeDefinitions());await old.open();
      try{
        await old.transaction('rw',old.tables,async()=>{
          for(const table of db.tables){
            if(!old.tables.some(value=>value.name===table.name))continue;
            const values=await Dexie.waitFor(table.toArray());
            for(const value of values){
              for(const key of Object.keys(value))if(key.startsWith('fk'))delete value[key];
              if(args.mode==='failed-upgrade'&&table.name===financialStoreName(args.table!))value.row[0]=['text',''];
            }
            await old.table(table.name).bulkAdd(values);
          }
        });
      }finally{old.close();}
      const upgraded=new FinancialDatabase(name,false);let code:string|null=null;
      try{await upgraded.open();}catch(error){code=storageFailure(error).code;}finally{upgraded.close();}
      const inspect=new Dexie(name);await inspect.open();
      try{return {code,version:inspect.verno,rows:await inspect.table(financialStoreName(args.table!)).toArray()};}
      finally{inspect.close();}
    }
    return await writeTransaction(db,sentinel,args.fence,async session=>{
      const replies:unknown[]=[];
      for(const operation of args.operations??[]){
        try{
          if(operation.kind==='insert')await session.insert(operation.table,operation.fields);
          else if(operation.kind==='replace')await session.replace(operation.table,operation.primary,operation.fields);
          else if(operation.kind==='remove')await session.remove(operation.table,operation.primary);
          else replies.push(await session.get(operation.table,operation.primary));
        }catch(error){if(operation.catch)replies.push(storageFailure(error).code);else throw error;}
      }
      return replies;
    });
  }finally{db.close();}
}
