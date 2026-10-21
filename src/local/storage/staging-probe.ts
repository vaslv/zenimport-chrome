/** Offline fixture-only importer. Never exposed in a distributed message handler. */
import {Zip,ZipPassThrough,unzipSync} from 'fflate';
import {createArchive} from '../portable/zip.js';
import type {TableName} from './schema.generated.js';
import type {TaggedRow} from './types.js';
import type {ContextFence} from '../../control/types.js';
import type {LocalDatabase} from './bootstrap.js';
import {FinancialDatabase} from './database.js';

export interface StagingArguments{
  fence:ContextFence;mode?:string;count?:number;
  golden:{dataset_id:string;owner_ids:string[];rows:Record<TableName,TaggedRow[]>};
}

export async function stagingProbe(db:LocalDatabase,args:StagingArguments){
  const started=performance.now();
  const parts:ArrayBuffer[]=[];
  await createArchive({datasetId:args.golden.dataset_id,ownerIds:args.golden.owner_ids,
    archiveId:'00000000-0000-4000-8000-000000000003',sessionId:'00000000-0000-4000-8000-000000000002',
    createdAt:'2026-10-20T00:00:00.000Z',version:'format-only'},async function*(name){
      if(name==='zen_entities'&&args.count){
        if(![1000,10000,100000].includes(args.count))throw Error('unsupported_fixture_size');
        const complete=args.mode==='valid-graph';
        if(complete)for(const row of args.golden.rows.zen_entities)if(row[0][0]==='text'&&row[0][1]<'merchant')yield row;
        const payload='{"note":"'+'x'.repeat(1900)+'","id":9007199254740993,"exact":1.00000000000000000001}';
        for(let i=0;i<args.count;i++){
          const row=[...args.golden.rows.zen_entities[0]],id=String(i).padStart(12,'0');row[1]=['text',id];row[2]=['text',payload];
          if(complete){row[0]=['text','merchant'];row[2]=['text',JSON.stringify({id,note:'x'.repeat(1900)})];}yield row;
        }
        if(complete)for(const row of args.golden.rows.zen_entities)if(row[0][0]==='text'&&row[0][1]>='merchant')yield row;
      }else yield* args.golden.rows[name];
    },
    {async write(bytes){parts.push(new Uint8Array(bytes).buffer);}});
  let blob=new Blob(parts);
  if(args.mode==='bad-hash'){
    // Only tiny synthetic fixtures use the full-buffer rewrite helper.
    const files=unzipSync(new Uint8Array(await blob.arrayBuffer()));
    files['tables/zen_entities.ndjson']=new TextEncoder().encode('[]\n');
    const output:ArrayBuffer[]=[];const zip=new Zip((error,chunk)=>{if(error)throw error;output.push(new Uint8Array(chunk).buffer);});
    for(const [name,raw]of Object.entries(files)){const file=new ZipPassThrough(name);zip.add(file);file.push(raw,true);}zip.end();blob=new Blob(output);
  }
  const original=FinancialDatabase.prototype.financial;
  const originalTransaction=FinancialDatabase.prototype.transaction;
  const injected=new Set<object>(),cleanup:(()=>void)[]=[];
  let maxTransactionMs=0;
  if(args.count)FinancialDatabase.prototype.transaction=new Proxy(originalTransaction,{
    apply(target,owner,parameters){const start=performance.now();const result=Reflect.apply(target,owner,parameters) as Promise<unknown>;
      return result.finally(()=>{maxTransactionMs=Math.max(maxTransactionMs,performance.now()-start);});},
  });
  if(args.mode==='quota')FinancialDatabase.prototype.financial=function(table){
    const value=original.call(this,table);
    if(table==='source_schema_migrations'&&!injected.has(value)){
      const hook=()=>{throw new DOMException('synthetic-private-quota','QuotaExceededError');};
      value.hook('creating',hook);injected.add(value);cleanup.push(()=>value.hook('creating').unsubscribe(hook));
    }
    return value;
  };
  try{
    const value=await db.stageArchive(blob,args.fence,'1792540800');
    if(args.mode==='valid-graph'){
      const validationStart=performance.now(),validated=await db.validateStageGraph(value.id,args.fence,'1792540800');
      return {...validated,elapsedMs:performance.now()-started,validationMs:performance.now()-validationStart,maxTransactionMs};
    }
    return args.count?{...value,elapsedMs:performance.now()-started,maxTransactionMs}:value;
  }
  finally{for(const remove of cleanup)remove();FinancialDatabase.prototype.financial=original;FinancialDatabase.prototype.transaction=originalTransaction;}
}
