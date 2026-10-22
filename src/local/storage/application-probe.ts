/** Offline installed-worker fixtures; never included in the distributed ZIP. */
import {installBackground} from '../../../extension/background-runtime.js';
import type {ApplicationService} from '../../application/service.js';
import {controlCommand} from '../../application/control-api.js';
import {ApplicationRuntime} from '../../application/runtime.js';
import type {StorageArea} from '../../application/state.js';
import {trustedSentinel} from '../../control/sentinel.js';
import {AccountRepository} from './account-repository.js';
import {MirrorRepository} from './mirror-repository.js';
import {FirstSyncOwner} from './first-sync-owner.js';
import {FinancialDatabase} from './database.js';
import Dexie from 'dexie';
const native=()=> (globalThis as unknown as {chrome:{storage:{local:StorageArea}}}).chrome.storage.local;
const installedBackgrounds=new Set<string>();
const runtimes=new Map<string,ApplicationRuntime>();let reads=0,paused=false;let resume:(()=>void)|undefined;let pending:Promise<unknown>|undefined;const clocks=new Map<string,number>();
function area(name:string):StorageArea{
  const prefix='l5-runtime:'+name+':',source=native();return {
    setAccessLevel:options=>source.setAccessLevel(options),
    async get(keys){const list=typeof keys==='string'?[keys]:keys,values=await source.get(list===null?null:list.map(key=>prefix+key));
      return Object.fromEntries(Object.entries(values).filter(([key])=>key.startsWith(prefix)).map(([key,value])=>[key.slice(prefix.length),value]));},
    set:values=>source.set(Object.fromEntries(Object.entries(values).map(([key,value])=>[prefix+key,value]))),
    remove:keys=>source.remove((typeof keys==='string'?[keys]:keys).map(key=>prefix+key)),
  };
}
export async function run(action:string,args:{name:string;patch?:Record<string,unknown>;url?:string;mode?:string;token?:string;data?:unknown;id?:string;now?:number}){
  const name=args.name,storage=area(name);
  // This stub implements only application HTTP reads. A create/delete request
  // would fail the fixture rather than contact an external service.
  const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{
    reads++;
    if(args.mode==='standalone'&&String(url).startsWith('https://api.zenmoney.ru/')){
      const body=JSON.parse(String(options?.body));if(body.transaction||body.deletion)throw Error('financial_fixture_write_forbidden');
      return Response.json({serverTimestamp:Math.floor(Date.now()/1000),user:[{id:1}],instrument:[{id:2,shortTitle:'VND'}],account:[{id:'a',title:'Fixture',type:'checking',user:1,instrument:2}],tag:[],transaction:[]});
    }
    if(options?.method!=='GET')throw Error('financial_fixture_write_forbidden');
    if(args.mode==='offline')throw Error('private-fixture-response');
    return Response.json(String(url).endsWith('/info')?{api_version:1}:{accounts:[]});
  };
  try{
    if(action==='malformed-legacy')await storage.set({config:{url:'invalid'}});
    if(action==='legacy')await storage.set({config:{url:args.url??'https://fixture.invalid',token:'synthetic-only'},...args.patch});
    let runtime=runtimes.get(name);if(!runtime){runtime=new ApplicationRuntime(storage,trustedSentinel(storage),name,undefined,args.mode==='standalone'?{session:area(name+'-session'),clock:()=>clocks.get(name)??Date.now()/1000,permission:async()=>true,fetch:globalThis.fetch,serverPermission:async()=>true}:undefined);runtimes.set(name,runtime);}
    if(action==='close'){runtime.close();runtimes.delete(name);return {ok:true};}
    if(action==='delete-db'){runtime.close();runtimes.delete(name);await Dexie.delete(name);return {ok:true};}
    let app=await runtime.current();
    if(action==='install-background'){if(!installedBackgrounds.has(name)){installBackground({runtime,standalone:true});installedBackgrounds.add(name);}return {ok:true,context:app?.context};}
    if(action==='control'){
      const value=await controlCommand(args.data as Record<string,unknown>,runtime,app!);
      app=await runtime.current();return {ok:true,value,root:app?.root,context:app?.context};
    }
    if(action==='clock'){clocks.set(name,args.now!);return {ok:true};}
    if(action==='pause-sync-acceptance'){
      paused=false;const at=Math.floor(Date.now()/1000),put=IDBObjectStore.prototype.put,add=IDBObjectStore.prototype.add,transact=FinancialDatabase.prototype.transaction;let armed=false,intercepted=false;
      IDBObjectStore.prototype.put=function(...values:Parameters<IDBObjectStore['put']>){
        if(this.name==='application_state'&&String(values[0]?.scope).startsWith('local-import-setup:'))armed=true;
        if(armed&&args.token==='during-job-write'&&this.name==='f_capture_jobs')clocks.set(name,at+600);
        return put.apply(this,values);
      };
      IDBObjectStore.prototype.add=function(...values:Parameters<IDBObjectStore['add']>){
        if(armed&&args.token==='during-job-write'&&this.name==='f_capture_jobs'){paused=true;clocks.set(name,at+600);}
        return add.apply(this,values);
      };
      FinancialDatabase.prototype.transaction=new Proxy(transact,{apply(target,db,values){
        if(armed&&!intercepted&&args.token==='before-transaction'&&values[0]==='rw'&&Array.isArray(values[1])&&values[1].some((table:{name:string})=>table.name==='participant_controls')){
          intercepted=true;paused=true;return new Promise<void>(resolve=>{resume=resolve;}).then(()=>Reflect.apply(target,db,values));
        }return Reflect.apply(target,db,values);
      }});
      pending=app!.service.capture.start(args.data as Parameters<ApplicationService['capture']['start']>[0]).then(()=>({ok:true}),error=>({ok:false,code:error.code}))
        .finally(()=>{IDBObjectStore.prototype.put=put;IDBObjectStore.prototype.add=add;FinancialDatabase.prototype.transaction=transact;});return {ok:true,at};
    }
    if(action==='pause-local-operation'){
      paused=false;const wait=new Promise<void>(resolve=>{resume=resolve;});
      if(args.token==='sync'){
        const open=FirstSyncOwner.open;FirstSyncOwner.open=async(...values:Parameters<typeof open>)=>{FirstSyncOwner.open=open;paused=true;await wait;return open(...values);};
      }else if(['discover','rename'].includes(args.token??'')){
        const open=AccountRepository.open;AccountRepository.open=async(...values:Parameters<typeof open>)=>{AccountRepository.open=open;paused=true;await wait;return open(...values);};
      }else{
        const open=MirrorRepository.open;MirrorRepository.open=async(...values:Parameters<typeof open>)=>{MirrorRepository.open=open;paused=true;await wait;return open(...values);};
      }
      const operation=args.token==='sync'?app!.service.capture.start(args.data as Parameters<ApplicationService['capture']['start']>[0])
        :args.token==='discover'?app!.service.connections.discover(args.data as Parameters<ApplicationService['connections']['discover']>[0])
        :args.token==='rename'?app!.service.connections.rename(args.id!,{label:'stale-label-must-not-commit'})
        :runtime.configureLocal('synthetic-new-token',app!);
      pending=operation
        .then(()=>({ok:true}),error=>({ok:false,code:error.code}));return {ok:true};
    }
    if(action==='operation-checkpoint')return {ok:true,paused};
    if(action==='operation-release'){resume?.();return {ok:true};}
    if(action==='operation-result')return await pending;
    if(action==='verify-local')app=await runtime.configureLocal(args.token??'synthetic-local-only',app!);
    if(action==='local-discover')await app!.service.connections.discover(args.data as Parameters<ApplicationService['connections']['discover']>[0]);
    if(action==='local-settings')await app!.service.accounts.configure(args.id!,args.data as Parameters<ApplicationService['accounts']['configure']>[1]);
    if(action==='local-start'){
      const put=IDBObjectStore.prototype.put;
      if(args.token==='quota-first-sync')IDBObjectStore.prototype.put=function(...values:Parameters<IDBObjectStore['put']>){if(this.name==='application_state'&&String(values[0]?.scope).startsWith('local-first-sync:'))throw new DOMException('synthetic-first-sync-quota','QuotaExceededError');return put.apply(this,values);};
      try{await app!.service.capture.start(args.data as Parameters<ApplicationService['capture']['start']>[0]);}finally{IDBObjectStore.prototype.put=put;}
    }
    if(action==='configure')app=await runtime.configure({url:args.url!,token:'synthetic-replacement'},app);
    if(action==='patch')await app!.state.set(args.patch!);
    const db=new FinancialDatabase(name,false);await db.open();
    try{return {ok:true,configured:!!app?.config.token,context:app?.context,state:app?await app.state.get(['capture','view','profiles']):null,reads,
      root:await db.runtime.get('runtime'),datasets:await db.datasets.toArray(),financialRows:await Promise.all(db.tables.filter(table=>table.name.startsWith('f_')).map(table=>table.count())),
      catalog:action==='catalog'?await app!.service.accounts.catalog():null,owners:app?.local?(await app.local.readiness()).owners:null,
      states:await db.applicationState.toArray()};}finally{db.close();}
  }catch(error){return {ok:false,code:(error as {code?:string}).code??'fixture_error'};}
  finally{globalThis.fetch=original;}
}
