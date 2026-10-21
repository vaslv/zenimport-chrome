/** Offline installed-worker fixtures; never included in the distributed ZIP. */
import {ApplicationRuntime} from '../../application/runtime.js';
import type {StorageArea} from '../../application/state.js';
import {trustedSentinel} from '../../control/sentinel.js';
import {FinancialDatabase} from './database.js';
import Dexie from 'dexie';
const native=()=> (globalThis as unknown as {chrome:{storage:{local:StorageArea}}}).chrome.storage.local;
const runtimes=new Map<string,ApplicationRuntime>();let reads=0;
function area(name:string):StorageArea{
  const prefix='l5-runtime:'+name+':',source=native();return {
    setAccessLevel:options=>source.setAccessLevel(options),
    async get(keys){const list=typeof keys==='string'?[keys]:keys,values=await source.get(list.map(key=>prefix+key));
      return Object.fromEntries(Object.entries(values).map(([key,value])=>[key.slice(prefix.length),value]));},
    set:values=>source.set(Object.fromEntries(Object.entries(values).map(([key,value])=>[prefix+key,value]))),
    remove:keys=>source.remove((typeof keys==='string'?[keys]:keys).map(key=>prefix+key)),
  };
}
export async function run(action:string,args:{name:string;patch?:Record<string,unknown>;url?:string;mode?:string}){
  const name=args.name,storage=area(name);
  // This stub implements only application HTTP reads. A create/delete request
  // would fail the fixture rather than contact an external service.
  const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{
    reads++;if(options?.method!=='GET')throw Error('financial_fixture_write_forbidden');
    if(args.mode==='offline')throw Error('private-fixture-response');
    return Response.json(String(url).endsWith('/info')?{api_version:1}:{accounts:[]});
  };
  try{
    if(action==='legacy')await storage.set({config:{url:args.url??'https://fixture.invalid',token:'synthetic-only'},...args.patch});
    let runtime=runtimes.get(name);if(!runtime){runtime=new ApplicationRuntime(storage,trustedSentinel(storage),name);runtimes.set(name,runtime);}
    if(action==='close'){runtime.close();runtimes.delete(name);return {ok:true};}
    if(action==='delete-db'){runtime.close();runtimes.delete(name);await Dexie.delete(name);return {ok:true};}
    let app=await runtime.current();
    if(action==='configure')app=await runtime.configure({url:args.url!,token:'synthetic-replacement'},app);
    if(action==='patch')await app!.state.set(args.patch!);
    if(action==='catalog')await app!.service.accounts.catalog();
    const db=new FinancialDatabase(name,false);await db.open();
    try{return {ok:true,configured:!!app?.config.token,context:app?.context,state:app?await app.state.get(['capture','view','profiles']):null,reads,
      root:await db.runtime.get('runtime'),datasets:await db.datasets.toArray(),financialRows:await Promise.all(db.tables.filter(table=>table.name.startsWith('f_')).map(table=>table.count())),
      states:await db.applicationState.toArray()};}finally{db.close();}
  }catch(error){return {ok:false,code:(error as {code?:string}).code??'fixture_error'};}
  finally{globalThis.fetch=original;}
}
