/** Disposable offline authority fixtures and fault injection, never distributed. */
import Dexie from 'dexie';
import {trustedSentinel} from '../../control/sentinel.js';
import {MigrationOwner} from './migration-owner.js';
import type {PeerStatus} from './migration-owner.js';
import {LocalDatabase} from './bootstrap.js';
import {FinancialDatabase,storeDefinitions} from './database.js';
import {packRow} from './cells.js';
import {envelope} from './envelope.js';
import {TABLES,PortableError} from '../portable/format.js';
import type {TableName} from './schema.generated.js';
import type {TaggedRow} from './types.js';
import {storageFailure} from './types.js';
import {ParticipantError} from '../../control/participant-wire.js';
import type {ParticipantCommand} from './participant-model.js';
import {writeTransaction} from './kernel.js';

type Area=Parameters<typeof trustedSentinel>[0];
const native=()=> (globalThis as unknown as {chrome:{storage:{local:Area&{remove(keys:string[]):Promise<void>}}}}).chrome.storage.local;
const owners=new Map<string,MigrationOwner>(),peers=new Map<string,MigrationOwner>(),reads=new Map<string,number>();
const externalPeers=new Map<string,PeerStatus>();
const modes=new Map<string,string>();let checkpoint=false;
let release:(()=>void)|undefined;
function port(name:string){
  const prefix='l4-authority:'+name+':',area=native();
  return trustedSentinel({setAccessLevel:value=>area.setAccessLevel(value),
    async get(keys){const values=await area.get(keys.map(key=>prefix+key));return Object.fromEntries(Object.entries(values).map(([key,value])=>[key.slice(prefix.length),value]));},
    set:values=>area.set(Object.fromEntries(Object.entries(values).map(([key,value])=>[prefix+key,value])))});
}
async function open(name:string){
  owners.get(name)?.close();
  const owner=await MigrationOwner.open(name,port(name),{
    async readPeer(id,switchId){const peer=peers.get(id);if(peer)return peer.status(id,switchId);
      const fixture=externalPeers.get(id+':'+switchId);if(!fixture)throw new ParticipantError('migration_paused');return structuredClone(fixture);},
    async verifyOwner(){
      reads.set(name,(reads.get(name)??0)+1);const mode=modes.get(name);
      if(mode==='offline')throw Error('synthetic-secret-must-not-escape');
      if(mode==='pause-owner'){checkpoint=true;await new Promise<void>(()=>{});}
      if(mode==='rotate-owner')await owner.updateCredential(crypto.randomUUID());
      return {ownerIds:mode==='wrong-owner'?['another']:['1'],sourceHash:'f'.repeat(64)};
    },
  });
  owners.set(name,owner);const db=new FinancialDatabase(name,false);await db.open();
  try{for(const control of await db.participants.toArray())peers.set(control.id,owner);}finally{db.close();}
  return owner.current();
}
interface Arguments{
  name:string;participantId?:string;switchId?:string;peerId?:string;credentialRef?:string;command?:ParticipantCommand;request?:unknown;
  number?:number;base64?:string;checksum?:string;epoch?:string;mode?:string;generation?:string;
  fixture?:{rows:Record<TableName,TaggedRow[]>};count?:number;
  peerStatus?:PeerStatus;
}
export async function run(action:string,args:Arguments){
  try{
    let value:unknown;const now='1792540800';
    if(action==='create'){
      const db=await LocalDatabase.open(args.name,port(args.name),now);db.close();value=await open(args.name);
    }else if(action==='open')value=await open(args.name);
    else if(action==='checkpoint')value=checkpoint;
    else if(action==='release'){release?.();release=undefined;value=true;}
    else if(action==='peer-fixture'){externalPeers.set(args.peerStatus!.installation_id+':'+args.switchId!,structuredClone(args.peerStatus!));value=true;}
    else if(action==='drop-marker'){await native().remove(['l4-authority:'+args.name+':localDatasetSentinel']);value=true;}
    else{
      const owner=owners.get(args.name);if(!owner)throw Error('missing_fixture_owner');
      if(action==='reserve'){
        value=await owner.reserveDestination(args.switchId!,args.peerId!,args.credentialRef!,now);
        peers.set((value as {participantId:string}).participantId,owner);
      }else if(action==='status')value=await owner.status(args.participantId!,args.switchId!);
      else if(action==='current')value=await owner.current();
      else if(action==='credential'){await owner.updateCredential(args.credentialRef!);value=true;}
      else if(action==='mode'){modes.set(args.name,args.mode!);value=true;}
      else if(action==='reads')value=reads.get(args.name)??0;
      else if(action==='snapshot'){
        const original=FinancialDatabase.prototype.transaction;let intercepted=false;
        if(args.mode==='pause-chunk')FinancialDatabase.prototype.transaction=new Proxy(original,{
          apply(target,db,parameters){
            const pending=Reflect.apply(target,db,parameters) as Promise<unknown>;
            if(parameters[0]!=='rw'||!Array.isArray(parameters[1])||!parameters[1].some((table:{name:string})=>table.name==='participant_receipts')||intercepted)return pending;
            return pending.then(async result=>{
              const database=db as FinancialDatabase;
              if(!intercepted&&await database.migrationChunks.count()){
                intercepted=true;checkpoint=true;await new Promise<void>(resolve=>{release=resolve;});
              }return result;
            });
          },
        });
        try{value=await owner.snapshotSource(args.participantId!,args.switchId!,now);}
        finally{FinancialDatabase.prototype.transaction=original;}
      }
      else if(action==='select-remote'){await owner.selectRemote(args.participantId!,args.switchId!,args.credentialRef!);value=true;}
      else if(action==='chunk'){
        const data=Uint8Array.from(atob(args.base64!),char=>char.charCodeAt(0));
        value=await owner.putChunk(args.participantId!,args.switchId!,args.epoch!,args.number!,data,args.checksum!);
      }else if(action==='download'){
        const data=await owner.download(args.participantId!,args.switchId!,args.number!);let raw='';
        for(let i=0;i<data.length;i+=8192)raw+=String.fromCharCode(...data.subarray(i,i+8192));value=btoa(raw);
      }else if(action==='command'){
        const original=FinancialDatabase.prototype.transaction;
        if(args.mode)FinancialDatabase.prototype.transaction=new Proxy(original,{
          apply(target,db,parameters){
            const tables=parameters[1] as Array<{name:string}>;
            if(args.mode==='pause-erase-header'&&parameters[0]==='rw'&&Array.isArray(tables)&&tables.length===6){
              checkpoint=true;return new Promise<void>(resolve=>{release=resolve;}).then(()=>Reflect.apply(target,db,parameters));
            }
            if(args.mode==='quota-import'&&parameters[0]==='rw'&&Array.isArray(tables)&&tables.length===7&&tables.some(table=>table.name==='f_capture_jobs')){
              const callback=parameters[parameters.length-1] as ()=>Promise<unknown>;
              return Reflect.apply(target,db,[...parameters.slice(0,-1),async()=>{await callback();throw new DOMException('synthetic-import-quota','QuotaExceededError');}]);
            }
            const final=parameters[0]==='rw'&&Array.isArray(parameters[1])&&parameters[1].some((table:{name:string})=>table.name==='participant_receipts');
            if(!final)return Reflect.apply(target,db,parameters);
            if(args.mode==='lost-reply')return (Reflect.apply(target,db,parameters) as Promise<unknown>).then(result=>{checkpoint=true;return new Promise(()=>{});});
            const callback=parameters[parameters.length-1] as ()=>Promise<unknown>;
            return Reflect.apply(target,db,[...parameters.slice(0,-1),async()=>{
              const result=await callback();checkpoint=true;
              if(args.mode==='quota')throw new DOMException('synthetic-private-quota','QuotaExceededError');
              if(args.mode==='pause-commit')await Dexie.waitFor(new Promise(()=>{}));return result;
            }]);
          },
        });
        try{value=await owner.command(args.participantId!,args.command as Exclude<ParticipantCommand,'source_seal'>,args.request,now);}
        finally{FinancialDatabase.prototype.transaction=original;}
      }else if(action==='write'){
        const current=await owner.current(),db=new FinancialDatabase(args.name,false);await db.open();
        try{
          await writeTransaction(db,port(args.name),{installationId:current.root.installationId,generation:args.generation??current.root.activeGeneration!,epoch:current.root.epoch},
            async session=>{await session.insert('dataset_metadata',{key:'forbidden-probe-write',value:'never'});});value=true;
        }finally{db.close();}
      }else if(action==='inspect'){
        const current=await owner.current(),db=new FinancialDatabase(args.name,false);await db.open();
        try{
          const generation=args.generation??current.root.activeGeneration!,rows:Record<string,TaggedRow[]>={};
          for(const table of TABLES)rows[table]=(await db.financial(table).where('generation').equals(generation).toArray()).map(value=>value.row);
          value={rows,datasets:await db.datasets.toArray(),participants:await db.participants.toArray(),stages:await db.stages.toArray()};
        }finally{db.close();}
      }else if(action==='upgrade-authority'){
        const source=new FinancialDatabase(args.name,false);await source.open();
        const root=await source.runtime.get('runtime'),datasets=await source.datasets.toArray();source.close();
        if(args.mode==='unknown-hold')datasets[0]={...datasets[0],lifecycle:'held',holdId:crypto.randomUUID(),participantEpoch:'2' as typeof datasets[0]['participantEpoch']};
        const name=args.name+'-v4',old=new Dexie(name);
        old.version(4).stores({...storeDefinitions(true),portable_stages:'id,state,createdAt'});await old.open();
        await old.table('runtime').add(root!);await old.table('datasets').bulkAdd(datasets);old.close();
        const upgraded=new FinancialDatabase(name,false);let code:string|null=null;
        try{await upgraded.open();}catch(error){code=storageFailure(error).code;}finally{upgraded.close();}
        const check=new Dexie(name);await check.open();
        try{value={code,version:check.verno,datasets:await check.table('datasets').toArray(),
          participants:check.tables.some(table=>table.name==='participant_controls')?await check.table('participant_controls').toArray():null};}finally{check.close();}
      }else if(action==='seed'){
        const current=await owner.current(),db=new FinancialDatabase(args.name,false);await db.open();await port(args.name).markFinancialActivity(current.root.installationId);
        try{
          await db.transaction('rw',db.tables,async()=>{
            for(const table of TABLES){
              await db.financial(table).where('generation').equals(current.root.activeGeneration!).delete();
              for(const original of args.fixture!.rows[table]){
                const row=[...original];
                if(table==='dataset_metadata'&&row[0][0]==='text'&&row[0][1]==='instance_id')row[1]=['text',(await db.datasets.get(current.root.activeGeneration!))!.datasetId];
                await db.financial(table).add(envelope(current.root.activeGeneration!,table,row));
              }
            }
            await db.runtime.put({...current.root,financialMayHaveStarted:true});
          });value=true;
        }finally{db.close();}
      }else throw Error('unsupported_private_probe');
    }
    return {ok:true,value};
  }catch(error){return {ok:false,code:error instanceof ParticipantError||error instanceof PortableError?error.code:storageFailure(error).code};}
}
