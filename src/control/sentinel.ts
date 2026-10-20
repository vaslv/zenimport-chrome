import type {DatasetSentinel,SentinelPort} from './types.js';
import {requireStorage} from '../local/storage/types.js';

const BASE='localDatasetSentinel';
const ACTIVITY='localDatasetSentinelActivity';

interface TrustedStorage{
  setAccessLevel(options:{accessLevel:'TRUSTED_CONTEXTS'}):Promise<void>;
  get(keys:readonly string[]):Promise<Record<string,unknown>>;
  set(values:Record<string,unknown>):Promise<void>;
}

function uuid(value:unknown):value is string{
  return typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

export function validateSentinel(value:unknown):DatasetSentinel{
  requireStorage(typeof value==='object' && value!==null && !Array.isArray(value),'storage_corrupt');
  const row=value as Record<string,unknown>;
  requireStorage(Object.keys(row).sort().join(',')==='datasetId,financialMayHaveStarted,generation,installationId,state,version','storage_corrupt');
  requireStorage(row.version==='1' && uuid(row.installationId) && uuid(row.datasetId) && uuid(row.generation),'storage_corrupt');
  requireStorage((row.state==='initializing'||row.state==='ready') && typeof row.financialMayHaveStarted==='boolean','storage_corrupt');
  return {...row} as unknown as DatasetSentinel;
}

/** Activity is a separate monotonic key, so stale scope writes cannot erase it. */
export function trustedSentinel(storage:TrustedStorage):SentinelPort{
  const protectedStorage=storage.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  async function read():Promise<DatasetSentinel|null>{
    await protectedStorage;
    const values=await storage.get([BASE,ACTIVITY]);
    if(!Object.hasOwn(values,BASE)){
      requireStorage(!Object.hasOwn(values,ACTIVITY),'recovery_required');return null;
    }
    const base=validateSentinel(values[BASE]);
    if(Object.hasOwn(values,ACTIVITY)){
      const activity=values[ACTIVITY] as Record<string,unknown>;
      requireStorage(typeof activity==='object' && activity!==null && !Array.isArray(activity) &&
        Object.keys(activity).sort().join(',')==='installationId,started' &&
        activity.installationId===base.installationId && activity.started===true,'storage_corrupt');
      return {...base,financialMayHaveStarted:true};
    }
    return base;
  }
  return {
    read,
    async create(value){
      value=validateSentinel(value);
      requireStorage(value.state==='initializing' && !value.financialMayHaveStarted,'storage_corrupt');
      requireStorage(await read()===null,'recovery_required');
      await storage.set({[BASE]:value});
      const acknowledged=await read();
      requireStorage(acknowledged!==null && Object.entries(value).every(([key,item])=>acknowledged[key as keyof DatasetSentinel]===item),'storage_corrupt');
    },
    async acknowledgeReady(value){
      value=validateSentinel(value);
      const previous=await read();
      requireStorage(previous!==null && previous.installationId===value.installationId && previous.generation===value.generation &&
        previous.datasetId===value.datasetId && previous.state==='initializing' && value.state==='ready','recovery_required');
      await storage.set({[BASE]:{...value,financialMayHaveStarted:previous.financialMayHaveStarted}});
      const acknowledged=await read();
      requireStorage(acknowledged?.state==='ready' && acknowledged.installationId===value.installationId,'storage_corrupt');
    },
    async markFinancialActivity(installationId){
      const previous=await read();
      requireStorage(previous!==null && previous.installationId===installationId && previous.state==='ready','recovery_required');
      await storage.set({[ACTIVITY]:{installationId,started:true}});
      const acknowledged=await read();
      requireStorage(acknowledged?.financialMayHaveStarted && acknowledged.installationId===installationId,'storage_corrupt');
    },
  };
}
