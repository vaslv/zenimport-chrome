/** Disposable offline authority fixtures and fault injection, never distributed. */
import Dexie from 'dexie';
import {trustedSentinel} from '../../control/sentinel.js';
import {MigrationOwner} from './migration-owner.js';
import type {PeerStatus} from './migration-owner.js';
import {LocalDatabase} from './bootstrap.js';
import {FinancialDatabase,storeDefinitions} from './database.js';
import {packRow,unpackRow} from './cells.js';
import {AccountRepository} from './account-repository.js';
import {envelope} from './envelope.js';
import {TABLES,PortableError} from '../portable/format.js';
import type {TableName} from './schema.generated.js';
import type {TaggedRow} from './types.js';
import {storageFailure} from './types.js';
import {ParticipantError} from '../../control/participant-wire.js';
import type {ParticipantCommand} from './participant-model.js';
import {writeTransaction,writeSetupTransaction} from './kernel.js';
import {FirstSyncOwner} from './first-sync-owner.js';
import {MirrorRepository} from './mirror-repository.js';
import {SwitchRunner} from '../migration/runner.js';
import {NativeParticipant,ServerParticipant} from '../migration/participants.js';
import {RemoteParticipant} from '../migration/remote.js';
import {SwitchJournalRepository} from './switch-journal-repository.js';
import type {SwitchLease} from './switch-journal-repository.js';
import type {Side,SwitchPhase,JournalCommand} from '../migration/journal.js';

type Area=Parameters<typeof trustedSentinel>[0];
const native=()=> (globalThis as unknown as {chrome:{storage:{local:Area&{remove(keys:string[]):Promise<void>}}}}).chrome.storage.local;
const owners=new Map<string,MigrationOwner>(),peers=new Map<string,MigrationOwner>(),reads=new Map<string,number>();
const externalPeers=new Map<string,PeerStatus>();
const remotePeers=new Map<string,{client:RemoteParticipant;adapter:ServerParticipant}>();
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
    async readPeer(id,switchId){const remote=remotePeers.get(id);if(remote)return remote.adapter.status(switchId);const peer=peers.get(id);if(peer)return peer.status(id,switchId);
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
  peerStatus?:PeerStatus;requestId?:string;url?:string;token?:string;now?:string;lease?:SwitchLease;side?:Side;phase?:SwitchPhase;journalCommand?:JournalCommand['command'];
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
      if(action==='remote-peer'){
        const client=new RemoteParticipant({url:args.url!,token:args.token!},async()=>{
          const chrome=(globalThis as unknown as {chrome:{permissions:{contains(value:{origins:string[]}):Promise<boolean>}}}).chrome;
          return chrome.permissions.contains({origins:[new URL(args.url!).origin+'/*']});
        });
        const identity=await client.identity();remotePeers.set(identity.installation_id,{client,adapter:new ServerParticipant(client,identity.installation_id)});value=identity;
      }else if(action.startsWith('journal-')){
        const journal=await SwitchJournalRepository.open(args.name,port(args.name)),time=args.now??'1000';
        const put=IDBObjectStore.prototype.put;
        if(args.mode==='quota')IDBObjectStore.prototype.put=function(...values:Parameters<IDBObjectStore['put']>){
          if(this.name==='application_state'&&String(values[0]?.scope).startsWith('mode-switch:'))throw new DOMException('synthetic-journal-quota','QuotaExceededError');
          return put.apply(this,values);
        };
        try{
          if(action==='journal-create'){
            const current=await owner.current(),local=args.mode==='remote-to-local';
            value=await journal.create(current.root,{id:args.switchId!,direction:local?'remote-to-local':'local-to-remote',sourceId:local?args.peerId!:current.participantId!,destinationId:local?null:args.peerId!,remoteCredentialRef:local?current.root.credentialRef!:args.credentialRef!,localCredentialRef:local?args.credentialRef!:current.root.credentialRef!,ownerIds:['1']});
          }else if(action==='journal-current')value=await journal.current();
          else if(action==='journal-claim')value=await journal.claim(args.switchId!,time);
          else if(action==='journal-run'){
            const record=(await journal.current())!,target=peers.get(record.plan.direction==='local-to-remote'?record.plan.destinationId!:record.plan.sourceId)!;
            const sourceLocal=record.plan.direction==='local-to-remote',server=remotePeers.get(sourceLocal?record.plan.destinationId!:record.plan.sourceId);
            const decorated=(participant:NativeParticipant)=>{
              const execute=participant.command.bind(participant);
              participant.command=async(command,request)=>{
                const result=await execute(command,request),drop={source_start:'drop-start',source_handoff:'drop-handoff',destination_activate:'drop-activate'};
                if(args.mode&&args.mode===drop[command as keyof typeof drop])throw new ParticipantError('backend_unavailable');
                if(args.mode==='pause-handoff'&&command==='source_handoff'){checkpoint=true;await new Promise(()=>{});}
                return result;
              };return participant;
            };
            const runner=new SwitchRunner(journal,{
              async prepare(plan){
                if(server){const identity=await server.client.identity();
                  if(JSON.stringify(identity.owner_ids)!==JSON.stringify(plan.ownerIds))throw new ParticipantError('migration_wrong_account');
                  if(sourceLocal){if(!identity.can_import)throw new ParticipantError('migration_not_empty');return null;}
                }
                if(sourceLocal)return null;const slot=await owner.reserveDestination(plan.id,plan.sourceId,plan.localCredentialRef,time);peers.set(slot.participantId,owner);return {id:slot.participantId,generation:slot.generation};},
              async quiesce(){return true;},
              source:plan=>!sourceLocal&&server?server.adapter:decorated(new NativeParticipant(sourceLocal?owner:target,plan.sourceId)),
              destination:plan=>sourceLocal&&server?server.adapter:decorated(new NativeParticipant(sourceLocal?target:owner,plan.destinationId!)),
              selectRemote:plan=>owner.selectRemote(plan.sourceId,plan.id,plan.remoteCredentialRef),
            },()=>Number(time));value=await runner.run();
          }
          else if(action==='journal-reserve')value=await journal.reserve(args.lease!,args.participantId!,args.generation!,time);
          else if(action==='journal-command')value=await journal.command(args.lease!,args.side??'source',args.journalCommand??'source_start',args.epoch??'1',time);
          else if(action==='journal-accept')value=await journal.accept(args.lease!,args.request,time);
          else if(action==='journal-advance')value=await journal.advance(args.lease!,args.phase!,time);
          else if(action==='journal-release')value=await journal.release(args.lease!,time);
          else throw Error('unknown_journal_fixture');
        }finally{IDBObjectStore.prototype.put=put;journal.close();}
      }else if(action==='reserve'){
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
      }else if(action==='capture-for-migration'){
        const current=await owner.current(),db=new FinancialDatabase(args.name,false);await db.open();
        try{const entry=(await db.financial('capture_jobs').where('generation').equals(current.root.activeGeneration!).first())!,row=unpackRow('capture_jobs',entry.row);
          await db.financial('capture_jobs').put(envelope(current.root.activeGeneration!,'capture_jobs',packRow('capture_jobs',{...row,capture_state:args.mode==='complete'?'complete':'paused'})));value=true;
        }finally{db.close();}
      }else if(action==='refresh-for-setup'){
        const time=Math.floor(Date.now()/1000)-(args.mode==='stale'?301:0),mirror=await MirrorRepository.open(args.name,port(args.name),()=>time);
        try{const {root}=await mirror.context(),lease=await mirror.claim(root,args.mode==='wrong-token'?'e'.repeat(64):'f'.repeat(64),String(time),true);
          value=await mirror.apply(root,lease!,JSON.stringify({serverTimestamp:time,user:[{id:1}],instrument:[{id:2,shortTitle:'VND'}],account:[{id:'a',title:'Fixture',type:'checking',user:1,instrument:2}],tag:[],transaction:[]}),String(time));
        }finally{mirror.close();}
      }else if(action==='rotate-for-setup'){
        const mirror=await MirrorRepository.open(args.name,port(args.name));
        try{const {root}=await mirror.context();value=await mirror.adopt(root,args.credentialRef!,['1']);}finally{mirror.close();}
      }else if(action==='prepare-setup'||action==='first-sync'){
        const setup=await FirstSyncOwner.open(args.name,port(args.name),async()=>({ownerIds:args.mode==='wrong-owner'?['2']:['1'],sourceHash:'f'.repeat(64)}));
        const put=IDBObjectStore.prototype.put;
        if(args.mode==='quota')IDBObjectStore.prototype.put=function(...values:Parameters<IDBObjectStore['put']>){
          if(this.name==='application_state'&&String(values[0]?.scope).startsWith('local-first-sync:'))throw new DOMException('synthetic-first-sync-quota','QuotaExceededError');
          return put.apply(this,values);
        };
        try{value=action==='prepare-setup'?await setup.prepare():await setup.acknowledge(args.requestId!);}
        finally{IDBObjectStore.prototype.put=put;setup.close();}
      }else if(action==='setup-configure'){
        const current=await owner.current(),db=new FinancialDatabase(args.name,false);await db.open();
        let account:ReturnType<typeof unpackRow<'bank_accounts'>>;
        try{account=unpackRow('bank_accounts',(await db.financial('bank_accounts').where('generation').equals(current.root.activeGeneration!).first())!.row);}finally{db.close();}
        const repository=await AccountRepository.open(args.name,port(args.name),{installationId:current.root.installationId,generation:current.root.activeGeneration!,epoch:current.root.epoch});
        try{value=await repository.configure(account!.id,{expected_version:account!.settings_version,selection:'ignored',zenmoney_account_id:null,import_start:null},String(Math.floor(Date.now()/1000)));}finally{repository.close();}
      }else if(action==='setup-write'){
        const current=await owner.current(),db=new FinancialDatabase(args.name,false);await db.open();
        try{await writeSetupTransaction(db,port(args.name),{installationId:current.root.installationId,generation:current.root.activeGeneration!,epoch:current.root.epoch},async session=>{
          if(args.mode==='forbidden')await session.insert('dataset_metadata',{key:'forbidden-probe-write',value:'never'});
          else{const connection=(await session.rows('connections'))[0],key=[['text',connection.id]] as const;
            if(await session.get('connection_labels',key))await session.replace('connection_labels',key,{connection_id:connection.id,label:'Imported setup'});
            else await session.insert('connection_labels',{connection_id:connection.id,label:'Imported setup'});}
        });value=true;}finally{db.close();}
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
