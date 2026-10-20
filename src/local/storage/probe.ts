/** Offline L4 test bridge. Never packaged or imported by product handlers. */
import Dexie from 'dexie';
import {trustedSentinel} from '../../control/sentinel.js';
import {LocalDatabase} from './bootstrap.js';
import {FinancialDatabase} from './database.js';
import {storageFailure} from './types.js';
import type {ContextFence} from '../../control/types.js';
import {kernelProbe,kernelCheckpoint} from './kernel-probe.js';
import type {KernelArguments} from './kernel-probe.js';
import {stagingProbe} from './staging-probe.js';
import type {StagingArguments} from './staging-probe.js';
import {PortableError} from '../portable/format.js';

type Area=Parameters<typeof trustedSentinel>[0];
const area=()=> (globalThis as unknown as {chrome:{storage:{local:Area}}}).chrome.storage.local;
const stores=new Map<string,LocalDatabase>();
let markerAcknowledged=false;

async function open(name:string,mode='normal'){
  const native=area();
  const port=trustedSentinel({setAccessLevel:options=>native.setAccessLevel(options),get:keys=>native.get(keys),
    set:async values=>{
      const base=values.localDatasetSentinel as {state?:string}|undefined;
      if(mode==='fail-ready' && base?.state==='ready')throw new DOMException('synthetic-private-error','QuotaExceededError');
      await native.set(values);
    }});
  const original=port.create.bind(port);
  if(mode==='pause-after-sentinel')port.create=async value=>{await original(value);markerAcknowledged=true;await new Promise<void>(()=>{});};
  stores.get(name)?.close();
  const db=await LocalDatabase.open(name,port,'1792540800');stores.set(name,db);
  return {context:await db.context(),state:await db.inspect()};
}

async function state(name:string){
  const marker=await trustedSentinel(area()).read();
  const exists=await Dexie.exists(name);
  if(!exists)return {exists,marker};
  const db=new FinancialDatabase(name,false);
  try{await db.open();return {exists,marker,runtime:await db.runtime.get('runtime'),datasets:await db.datasets.toArray(),tableCount:db.tables.length};}
  finally{db.close();}
}

export async function run(action:string,args:{name:string;mode?:string;fence?:ContextFence;stageId?:string}){
  try{
    let value:unknown;
    if(action==='open')value=await open(args.name,args.mode);
    else if(action==='kernel')value=await kernelProbe(args as KernelArguments,trustedSentinel(area()));
    else if(action==='kernel-checkpoint')value=kernelCheckpoint();
    else if(action==='stage'){
      const db=stores.get(args.name);if(!db)throw Error('missing_test_handle');
      value=await stagingProbe(db,args as unknown as StagingArguments);
    }else if(action==='stages'){
      const db=stores.get(args.name);if(!db)throw Error('missing_test_handle');value=await db.stages();
    }else if(action==='relations'){
      const db=stores.get(args.name);if(!db||!args.fence||!args.stageId)throw Error('missing_test_handle');
      if(args.mode==='poison-index'){
        const raw=new FinancialDatabase(args.name,false);await raw.open();
        try{
          const table=raw.financial('bank_transactions'),row=await table.where('generation').equals(args.stageId).first();
          if(!row)throw Error('missing_test_row');await table.update([row.generation,row.key],{i0:'poisoned-derived-index'});
        }finally{raw.close();}
      }
      value=await db.checkStageRelations(args.stageId,args.fence);
    }else if(action==='audit'){
      const db=stores.get(args.name);if(!db||!args.fence||!args.stageId)throw Error('missing_test_handle');
      await db.checkStageAudit(args.stageId,args.fence);value=true;
    }else if(action==='history'){
      const db=stores.get(args.name);if(!db||!args.fence||!args.stageId)throw Error('missing_test_handle');
      await db.checkStageHistory(args.stageId,args.fence);value=true;
    }
    else if(action==='checkpoint')value=markerAcknowledged;
    else if(action==='state')value=await state(args.name);
    else if(action==='concurrent')value=await Promise.all([open(args.name),open(args.name)]);
    else if(action==='close'){stores.get(args.name)?.close();stores.delete(args.name);value=true;}
    else if(action==='delete'){
      stores.get(args.name)?.close();stores.delete(args.name);await Dexie.delete(args.name);value=true;
    }else if(action==='mark'){
      const db=stores.get(args.name);if(!db)throw Error('missing_test_handle');
      await db.markFinancialActivity(args.fence??await db.context());value=await db.inspect();
    }else throw Error('unsupported_test_action');
    return {ok:true,value};
  }catch(error){return {ok:false,code:error instanceof PortableError?error.code:storageFailure(error).code};}
}
