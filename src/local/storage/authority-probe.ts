/** Disposable offline authority fixtures and fault injection, never distributed. */
import Dexie from 'dexie';
import {SyncError} from '../../../extension/backend-client.js';
import {LocalArchives} from '../../application/local-archives.js';
import {ApplicationRuntime} from '../../application/runtime.js';
import {RemoteArchiveRecovery} from '../../application/remote-archive-recovery.js';
import {RemoteRecoverySelection} from './remote-recovery-selection.js';
import {ArchiveFileOwner} from './archive-file-owner.js';
import {BackupOwner} from './backup-owner.js';
import {RestoreOwner} from './restore-owner.js';
import {fixtureArchive} from './staging-probe.js';
import {ModeTransfers} from '../migration/controller.js';
import {mirrorReader} from '../zenmoney/reader.js';
import type {StorageArea} from '../../application/state.js';
import type {RuntimeControl} from '../../control/types.js';
import {trustedSentinel} from '../../control/sentinel.js';
import {MigrationOwner} from './migration-owner.js';
import type {PeerStatus} from './migration-owner.js';
import {LocalDatabase} from './bootstrap.js';
import {RemoteControl} from './remote-control.js';
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
const modes=new Map<string,string>(),restoreClocks=new Map<string,string>();let checkpoint=false;
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
    }else if(action==='create-remote'){
      const control=await RemoteControl.open(args.name,port(args.name),args.credentialRef!,{url:args.url!,contextId:args.peerId!,legacy:false});control.close();value=await open(args.name);
    }else if(action==='open')value=await open(args.name);
    else if(action==='checkpoint')value=checkpoint;
    else if(action==='release'){release?.();release=undefined;value=true;}
    else if(action==='peer-fixture'){externalPeers.set(args.peerStatus!.installation_id+':'+args.switchId!,structuredClone(args.peerStatus!));value=true;}
    else if(action==='drop-marker'){await native().remove(['l4-authority:'+args.name+':localDatasetSentinel']);value=true;}
    else{
      const owner=owners.get(args.name);if(!owner)throw Error('missing_fixture_owner');
      if(action.startsWith('local-archive-')){
        const options={name:args.name,sentinel:port(args.name),persistent:native() as StorageArea,session:native() as StorageArea,
          permission:async()=>true,serverPermission:async()=>false,clock:()=>Number(args.now??now),
          fetch:async(_input:RequestInfo|URL,init?:RequestInit)=>{
            const body=JSON.parse(String(init?.body));if(body.transaction||body.deletion)throw Error('fixture_financial_write_forbidden');
            const raw=args.fixture?.rows.zen_sync_runs[0].at(-1)?.[1] as string|undefined;
            return raw?new Response(raw,{headers:{'Content-Type':'application/json'}}):Response.json({serverTimestamp:1792540800,user:[{id:args.mode==='wrong-owner'?2:1}],instrument:[{id:2,shortTitle:'VND'}],account:[],tag:[],transaction:[]});
          }};
        const runtime=new ApplicationRuntime(native() as StorageArea,port(args.name),args.name,undefined,options);
        try{const app=(await runtime.current())!,files=new LocalArchives(options,app);
          if(action==='local-archive-status')value=await files.status();
          else if(action==='local-archive-upload-begin')value=await files.uploadBegin(args.requestId!,args.count!,args.checksum!);
          else if(action==='local-archive-upload-chunk')value=await files.uploadChunk(args.requestId!,args.peerId!,args.number!,Uint8Array.from(atob(args.base64!),c=>c.charCodeAt(0)));
          else if(action==='local-archive-upload-seal')value=await files.uploadSeal(args.requestId!);
          else if(action==='local-archive-discard')value=await files.discardUpload(args.requestId!);
          else if(action==='local-archive-backup-begin')value=await files.backupBegin(args.requestId!,args.generation!);
          else if(action==='local-archive-backup-step')value=await files.backupStep(args.requestId!);
          else if(action==='local-archive-backup-chunk'){let raw='';for(const byte of await files.backupChunk(args.requestId!,args.number!))raw+=String.fromCharCode(byte);value=btoa(raw);}
          else if(action==='local-archive-backup-ack')value=await files.backupAcknowledge(args.requestId!,args.checksum!);
          else if(action==='local-archive-backup-clean')value=await files.backupClean(args.requestId!);
          else if(action==='local-archive-backup-cancel')value=await files.backupCancel(args.requestId!);
          else if(action==='local-archive-restore-begin')value=await files.restoreBegin(args.requestId!,args.token??null,{formerWritersRetired:true,acceptPostSnapshotEvidenceLoss:true});
          else if(action==='local-archive-restore-step')value=await files.restoreStep(args.requestId!);
          else if(action==='local-archive-restore-preview')value=await files.restorePreview(args.requestId!);
          else if(action==='local-archive-restore-accept')value=await files.restoreAccept(args.requestId!,args.peerId!);
          else if(action==='local-archive-restore-cancel')value=await files.restoreCancel(args.requestId!);
          else if(action==='local-archive-restore-clean')value=await files.restoreClean(args.requestId!);
          else throw Error('unknown_local_archive_fixture');
        }finally{runtime.close();}
      }else if(action.startsWith('remote-recovery-')){
        const chrome=(globalThis as unknown as {chrome:{permissions:{contains(value:{origins:string[]}):Promise<boolean>}}}).chrome;
        const controller=new RemoteArchiveRecovery({name:args.name,sentinel:port(args.name),persistent:native() as StorageArea,
          fetch:async(input,init)=>{
            if(args.mode==='fail-withdraw'&&String(input).endsWith('/archives/recoveries/withdraw'))throw Error('synthetic-offline-withdraw');
            if(args.mode==='fail-finalize'&&String(input).endsWith('/finalize'))throw Error('synthetic-offline-finalize');
            const reply=await globalThis.fetch(input,init);
            if(args.mode==='pause-preview-status'&&String(input).endsWith('/archives/'+args.requestId)&&
              (await reply.clone().json()).phase==='preview'){checkpoint=true;await new Promise<void>(resolve=>{release=resolve;});}
            if(args.mode==='lose-activate'&&String(input).endsWith('/activate')){await reply.arrayBuffer();throw Error('synthetic-lost-activation');}
            if(args.mode==='lose-begin'&&String(input).endsWith('/archives/recoveries')){await reply.arrayBuffer();throw Error('synthetic-lost-recovery-begin');}
            return reply;},
          serverPermission:url=>chrome.permissions.contains({origins:[new URL(url).origin+'/*']})});
        if(action==='remote-recovery-current')value=await controller.current();
        else if(action==='remote-recovery-step'){
          const put=IDBObjectStore.prototype.put;
          if(args.mode==='quota-selection')IDBObjectStore.prototype.put=function(...values:Parameters<IDBObjectStore['put']>){if(this.name==='runtime')throw new DOMException('synthetic-recovery-selection-quota','QuotaExceededError');return put.apply(this,values);};
          try{value=await controller.step(args.requestId!);}finally{IDBObjectStore.prototype.put=put;}
        }
        else if(action==='remote-recovery-accept')value=await controller.accept(args.requestId!,args.peerId!);
        else if(action==='remote-recovery-retry')value=await controller.retry(args.requestId!,['refresh-preview','fail-finalize'].includes(args.mode??''));
        else if(action==='remote-recovery-cancel')value=await controller.cancel(args.requestId!);
        else if(action==='remote-recovery-ordinary'){
          const runtime=new ApplicationRuntime(native() as StorageArea,port(args.name),args.name);
          try{value=await (await runtime.current())!.service.accounts.catalog();}finally{runtime.close();}
        }else if(action==='remote-recovery-begin'){
          const runtime=new ApplicationRuntime(native() as StorageArea,port(args.name),args.name);
          try{const app=(await runtime.current())!;value=await controller.begin(app,args.requestId!,{formerWritersRetired:true,acceptPostSnapshotEvidenceLoss:true});}
          finally{runtime.close();}
        }else throw Error('unknown_remote_recovery_fixture');
      }else if(action==='bind-remote'){
        const control=await RemoteControl.open(args.name,port(args.name));
        const data=args.request as {installationId:string;datasetId:string};
        try{value=await control.bindIdentity(await control.read(),data.installationId,data.datasetId);}finally{control.close();}
      }else if(action.startsWith('recovery-select-')){
        const selection=await RemoteRecoverySelection.open(args.name,port(args.name));
        const input=args.request as Record<string,unknown>,put=IDBObjectStore.prototype.put;
        if(args.mode==='quota-selection')IDBObjectStore.prototype.put=function(...values:Parameters<IDBObjectStore['put']>){
          if(this.name==='runtime')throw new DOMException('synthetic-selection-quota','QuotaExceededError');return put.apply(this,values);
        };
        try{
          if(action==='recovery-select-current')value=await selection.current();
          else if(action==='recovery-select-begin')value=await selection.begin(input.root as Parameters<typeof selection.begin>[0],input.request as Parameters<typeof selection.begin>[1]);
          else if(action==='recovery-select-activated')value=await selection.activated(args.switchId!,input.status as Parameters<typeof selection.activated>[1],input.identity as Parameters<typeof selection.activated>[2],args.credentialRef!,args.peerId!);
          else if(action==='recovery-select-withdrawn')value=await selection.withdrawn(args.switchId!,input.proof as Parameters<typeof selection.withdrawn>[1],input.identity as Parameters<typeof selection.withdrawn>[2]);
          else if(action==='recovery-select-cancelled')value=await selection.cancelled(args.switchId!,input.status as Parameters<typeof selection.cancelled>[1],input.identity as Parameters<typeof selection.cancelled>[2]);
          else throw Error('unknown_recovery_selection_fixture');
        }finally{IDBObjectStore.prototype.put=put;selection.close();}
      }else if(action.startsWith('file-')){
        const marker=port(args.name);let fileReads=0;
        const file=await ArchiveFileOwner.open(args.name,{...marker,async read(){if(++fileReads===(args.mode==='pause-bound-file'?2:args.mode==='pause-file-read'?3:-1)){checkpoint=true;await new Promise<void>(resolve=>{release=resolve;});}return marker.read();}},(args.request as {root?:RuntimeControl}|undefined)?.root);
        try{
          if(action==='file-current')value=await file.current();
          else if(action==='file-begin')value=await file.begin(args.requestId!,args.count!,args.checksum!);
          else if(action==='file-status')value=await file.status(args.requestId!);
          else if(action==='file-put'){
            const add=IDBObjectStore.prototype.add;
            if(args.mode==='quota')IDBObjectStore.prototype.add=function(...values:Parameters<IDBObjectStore['add']>){if(this.name==='archive_file_chunks')throw new DOMException('synthetic-file-quota','QuotaExceededError');return add.apply(this,values);};
            try{value=await file.put(args.requestId!,args.peerId!,args.number!,Uint8Array.from(atob(args.base64!),c=>c.charCodeAt(0)));}finally{IDBObjectStore.prototype.add=add;}
          }else if(action==='file-seal')value=await file.seal(args.requestId!);
          else if(action==='file-blob'){const blob=await file.blob(args.requestId!);value={bytes:blob.size,checksum:await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()).then(bytes=>Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join(''))};}
          else if(action==='file-cancel')value=await file.cancel(args.requestId!);
          else if(action==='file-clean')value=await file.clean(args.requestId!);
        }finally{file.close();}
      }else if(action.startsWith('restore-')){
        const raw=args.fixture?.rows.zen_sync_runs[0].at(-1)?.[1] as string??JSON.stringify({serverTimestamp:1792540800,user:[{id:1}],instrument:[{id:2,shortTitle:'VND'}],account:[],tag:[],transaction:[]});
        const proof={ownerIds:args.mode==='wrong-owner'?['2']:['1'],sourceHash:'f'.repeat(64)};
        const restoreMarker=port(args.name);let restoreReads=0;
        const restore=await RestoreOwner.open(args.name,{...restoreMarker,async read(){if(++restoreReads===(args.mode==='pause-restore-begin'?2:args.mode==='pause-restore-activate'?3:-1)){checkpoint=true;await new Promise<void>(resolve=>{release=resolve;});}return restoreMarker.read();}},{
          async verify(){if(args.mode==='expire-during-restore-preview')restoreClocks.set(args.name,String(BigInt(restoreClocks.get(args.name)??args.now??now)+301n));if(args.mode==='offline')throw new ParticipantError('zenmoney_unavailable');if(args.mode==='pause-restore-preview'){checkpoint=true;await new Promise<void>(resolve=>{release=resolve;});}return {...proof,raw};},
          async credential(){return proof;},async permission(){return args.mode!=='permission-denied';},
        },()=>Number(restoreClocks.get(args.name)??args.now??now),(args.request as {root?:RuntimeControl}|undefined)?.root);
        const put=IDBObjectStore.prototype.put;
        if(args.mode==='quota-activate'||args.mode==='quota-validated')IDBObjectStore.prototype.put=function(...values:Parameters<IDBObjectStore['put']>){if(this.name==='application_state'&&String(values[0]?.scope).startsWith('archive-restore:')&&values[0]?.value?.phase===(args.mode==='quota-activate'?'activated':'validated'))throw new DOMException('synthetic-restore-quota','QuotaExceededError');return put.apply(this,values);};
        if(args.mode==='expire-after-restore-write')IDBObjectStore.prototype.put=function(...values:Parameters<IDBObjectStore['put']>){if(this.name==='application_state'&&values[0]?.value?.phase==='activated')restoreClocks.set(args.name,String(BigInt(values[0].value.preview.checkedAt)+301n));return put.apply(this,values);};
        const blob=async()=>args.count?fixtureArchive({golden:args.fixture! as Parameters<typeof fixtureArchive>[0]['golden'],count:args.count,mode:'valid-graph'}):new Blob([Uint8Array.from(atob(args.base64!),char=>char.charCodeAt(0))]);
        try{
          if(action==='restore-begin')value=await restore.begin(args.requestId!,await blob(),args.credentialRef!,{formerWritersRetired:args.mode!=='no-retirement',acceptPostSnapshotEvidenceLoss:args.mode!=='no-loss-consent',replaceInactiveLocalCopy:args.mode==='replace-copy'});
          else if(action==='restore-current')value=await restore.current();
          else if(action==='restore-clock'){restoreClocks.set(args.name,args.now!);value=true;}
          else if(action==='restore-load')value=await restore.load(args.requestId!,await blob());
          else if(action==='restore-preview')value=await restore.preview(args.requestId!);
          else if(action==='restore-activate')value=await restore.activate(args.requestId!,args.peerId!,args.mode!=='no-summary');
          else if(action==='restore-cancel')value=await restore.cancel(args.requestId!);
          else if(action==='restore-clean')value=await restore.cleanCancelled(args.requestId!,args.mode!=='no-retention');
        }finally{IDBObjectStore.prototype.put=put;restore.close();}
      }else if(action.startsWith('backup-')){
        const marker=port(args.name);let count=0;
        const backup=await BackupOwner.open(args.name,{...marker,async read(){if(args.mode==='pause-backup'&&++count===3){checkpoint=true;await new Promise<void>(resolve=>{release=resolve;});}return marker.read();}});
        try{
          if(action==='backup-begin'){const {root}=await owner.current();value=await backup.begin(args.requestId!,args.generation??root.activeGeneration!,root,args.now??now);}
          else if(action==='backup-build'){
            const add=IDBObjectStore.prototype.add,put=IDBObjectStore.prototype.put;
            if(args.mode==='quota')IDBObjectStore.prototype.add=function(...values:Parameters<IDBObjectStore['add']>){if(this.name==='local_backup_chunks')throw new DOMException('synthetic-backup-quota','QuotaExceededError');return add.apply(this,values);};
            if(args.mode==='quota-ready')IDBObjectStore.prototype.put=function(...values:Parameters<IDBObjectStore['put']>){if(this.name==='application_state'&&String(values[0]?.scope).startsWith('local-backup:')&&values[0]?.value?.phase==='ready')throw new DOMException('synthetic-backup-ready-quota','QuotaExceededError');return put.apply(this,values);};
            try{value=await backup.build(args.requestId!);}finally{IDBObjectStore.prototype.add=add;IDBObjectStore.prototype.put=put;}
          }else if(action==='backup-cancel')value=await backup.cancel(args.requestId!);
          else if(action==='backup-list')value=await backup.list();
          else if(action==='backup-chunk'){const part=await backup.chunk(args.requestId!,args.number!);let raw='';for(const byte of part.data)raw+=String.fromCharCode(byte);value=btoa(raw);}
          else if(action==='backup-ack')value=await backup.acknowledge(args.requestId!,args.checksum!,args.now??now);
          else if(action==='backup-clean')value=await backup.clean(args.requestId!);
        }finally{backup.close();}
      }else if(action.startsWith('transfer-')){
        const chrome=(globalThis as unknown as {chrome:{permissions:{contains(value:{origins:string[]}):Promise<boolean>}}}).chrome;
        const transfer=await ModeTransfers.open({name:args.name,sentinel:port(args.name),persistent:native() as StorageArea,clock:()=>Number(args.now??now),...(args.request?{expectedRoot:args.request as Parameters<MigrationOwner['quiesceLocal']>[0]}:{}),
          serverPermission:url=>chrome.permissions.contains({origins:[new URL(url).origin+'/*']}),
          reader:mirrorReader({permission:async()=>true,fetch:async(_url,options)=>{
            const body=JSON.parse(String(options?.body));if(body.transaction||body.deletion)throw Error('fixture_financial_write_forbidden');
            return Response.json({serverTimestamp:1792540800,user:[{id:1}],instrument:[{id:2,shortTitle:'VND'}],account:[],tag:[],transaction:[]});
          }}),
        });
        try{
          if(action==='transfer-credential'){
            const candidate=await transfer.localCredentials.verifyToken('synthetic-local-sdk-token'),mirror=await MirrorRepository.open(args.name,port(args.name));
            try{const {root}=await mirror.context();await mirror.adopt(root,candidate.ref,candidate.owners);}finally{mirror.close();}value=candidate;
          }else if(action==='transfer-candidate'){const candidate=await transfer.serverCredentials.verify({url:args.url!,token:args.token!},['1']);value={...candidate,contextId:(await transfer.serverCredentials.read(candidate.ref)).contextId};}
          else if(action==='transfer-to-server')value=await transfer.toServer(args.credentialRef!);
          else if(action==='transfer-to-browser'){
            const candidate=await transfer.localCredentials.verifyToken('synthetic-local-sdk-token');value=await transfer.toBrowser(candidate.ref,{pauseSharedServer:args.mode!=='no-consent',replaceInactiveLocalCopy:args.mode==='replace-copy'});
          }else if(action==='transfer-join')value=await transfer.joinServer(args.requestId!,args.credentialRef!,{retainLocalCopy:args.mode!=='no-consent',withoutImport:true,acceptMissingDedupEvidence:true});
          else if(action==='transfer-join-current')value=await transfer.joinCurrent();
          else if(action==='transfer-join-cancel')value=await transfer.cancelJoin(args.requestId!);
          else if(action==='transfer-step'){
            const put=IDBObjectStore.prototype.put;
            if(args.mode==='quota-route')IDBObjectStore.prototype.put=function(...values:Parameters<IDBObjectStore['put']>){if(this.name==='application_state'&&String(values[0]?.scope).startsWith('mode-join:')&&values[0]?.value?.phase==='complete')throw new DOMException('synthetic-route-quota','QuotaExceededError');return put.apply(this,values);};
            try{value=await transfer.run(args.switchId);if(args.mode==='drop-join-reply'&&(value as {state:string}).state==='complete')throw new ParticipantError('backend_unavailable');}finally{IDBObjectStore.prototype.put=put;}
          }
          else if(action==='transfer-current')value=await transfer.current();
          else if(action==='transfer-cancel'){
            const add=IDBObjectStore.prototype.add;
            if(args.mode==='quota-cancel')IDBObjectStore.prototype.add=function(...values:Parameters<IDBObjectStore['add']>){if(this.name==='application_state'&&String(values[0]?.scope).startsWith('mode-switch-rejected:'))throw new DOMException('synthetic-cancel-audit-quota','QuotaExceededError');return add.apply(this,values);};
            try{value=await transfer.cancel(args.switchId!,args.requestId!);}finally{IDBObjectStore.prototype.add=add;}
          }
          else throw Error('unknown_transfer_fixture');
        }finally{transfer.close();}
      }else if(action==='quiesce-local'){
        const original=FinancialDatabase.prototype.transaction;checkpoint=false;
        if(args.mode==='pause-quiesce-write')FinancialDatabase.prototype.transaction=new Proxy(original,{apply(target,db,parameters){
          if(parameters[0]==='rw'&&Array.isArray(parameters[1])&&parameters[1].some((table:{name:string})=>table.name==='f_capture_jobs')){
            FinancialDatabase.prototype.transaction=original;checkpoint=true;
            return new Promise<void>(resolve=>{release=resolve;}).then(()=>Reflect.apply(target,db,parameters));
          }return Reflect.apply(target,db,parameters);
        }});
        try{value=await owner.quiesceLocal(args.request as Parameters<MigrationOwner['quiesceLocal']>[0],args.now??now,args.mode==='join'?{kind:'join',id:args.requestId!}:undefined);}
        finally{FinancialDatabase.prototype.transaction=original;}
      }

      else if(action==='remote-context'){
        const control=await RemoteControl.open(args.name,port(args.name));try{value=await control.remoteContext(await control.read());}finally{control.close();}
      }else if(action==='remote-peer'){
        const client=new RemoteParticipant({url:args.url!,token:args.token!},async()=>{
          const chrome=(globalThis as unknown as {chrome:{permissions:{contains(value:{origins:string[]}):Promise<boolean>}}}).chrome;
          return chrome.permissions.contains({origins:[new URL(args.url!).origin+'/*']});
        });
        const identity=await client.identity();remotePeers.set(identity.installation_id,{client,adapter:new ServerParticipant(client,identity.installation_id)});value=identity;
      }else if(action.startsWith('journal-')){
        const journal=await SwitchJournalRepository.open(args.name,port(args.name)),time=args.now??'1000';
        const put=IDBObjectStore.prototype.put,add=IDBObjectStore.prototype.add;
        if(args.mode==='quota-rejected')IDBObjectStore.prototype.add=function(...values:Parameters<IDBObjectStore['add']>){if(this.name==='application_state'&&String(values[0]?.scope).startsWith('mode-switch-rejected:'))throw new DOMException('synthetic-rejected-quota','QuotaExceededError');return add.apply(this,values);};
        if(args.mode==='quota')IDBObjectStore.prototype.put=function(...values:Parameters<IDBObjectStore['put']>){
          if(this.name==='application_state'&&String(values[0]?.scope).startsWith('mode-switch:'))throw new DOMException('synthetic-journal-quota','QuotaExceededError');
          return put.apply(this,values);
        };
        try{
          if(action==='journal-create'){
            const current=await owner.current(),local=args.mode?.startsWith('remote-to-local')===true;
            value=await journal.create(current.root,{id:args.switchId!,direction:local?'remote-to-local':'local-to-remote',sourceId:local?args.peerId!:current.participantId!,destinationId:local?null:args.peerId!,remoteCredentialRef:local?current.root.credentialRef!:args.credentialRef!,localCredentialRef:local?args.credentialRef!:current.root.credentialRef!,ownerIds:['1']},args.mode==='remote-to-local-replace');
          }else if(action==='journal-current')value=await journal.current();
          else if(action==='journal-claim')value=await journal.claim(args.switchId!,time);
          else if(action==='journal-run'){
            const record=(await journal.current())!,target=peers.get(record.plan.direction==='local-to-remote'?record.plan.destinationId!:record.plan.sourceId)!;
            const sourceLocal=record.plan.direction==='local-to-remote',server=remotePeers.get(sourceLocal?record.plan.destinationId!:record.plan.sourceId);
            const decorated=(participant:NativeParticipant)=>{
              const execute=participant.command.bind(participant);
              participant.command=async(command,request)=>{
                if(args.mode==='seal-before-cancel'&&command==='source_cancel')await participant.seal(String(request.switch_id));
                if(args.mode==='arm-before-discard'&&command==='destination_discard'){
                  const arm=(await journal.current())!.commands.find(row=>row.command==='destination_arm')!;await execute('destination_arm',arm.request);
                }
                const result=await execute(command,request),drop={source_start:'drop-start',source_handoff:'drop-handoff',destination_activate:'drop-activate',source_cancel:'drop-cancel',destination_discard:'drop-discard',source_resume:'drop-resume'};
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
          else if(action==='journal-rejected'){
            const db=new FinancialDatabase(args.name,false);await db.open();
            try{value=(await db.applicationState.toArray()).filter(row=>row.scope.startsWith('mode-switch-rejected:'+args.switchId+':'));}finally{db.close();}
          }
          else if(action==='journal-cancel')value=await journal.requestCancel(args.switchId!,args.requestId!);
          else if(action==='journal-cancellation')value=await journal.cancellation(args.switchId!);
          else if(action==='journal-accept')value=await journal.accept(args.lease!,args.request,time);
          else if(action==='journal-advance')value=await journal.advance(args.lease!,args.phase!,time);
          else if(action==='journal-release')value=await journal.release(args.lease!,time);
          else throw Error('unknown_journal_fixture');
        }finally{IDBObjectStore.prototype.put=put;IDBObjectStore.prototype.add=add;journal.close();}
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
            if(args.mode==='pause-erase-header'&&parameters[0]==='rw'&&Array.isArray(tables)&&tables.some(table=>table.name==='portable_stages')&&!tables.some(table=>table.name.startsWith('f_'))){
              checkpoint=true;return new Promise<void>(resolve=>{release=resolve;}).then(()=>Reflect.apply(target,db,parameters));
            }
            if(args.mode==='quota-import'&&parameters[0]==='rw'&&Array.isArray(tables)&&tables.filter(table=>table.name.startsWith('f_')).length===1&&tables.some(table=>table.name==='f_capture_jobs')){
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
  }catch(error){return {ok:false,code:error instanceof ParticipantError||error instanceof PortableError||error instanceof SyncError?error.code:storageFailure(error).code};}
}
