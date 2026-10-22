/** Privileged service selection. A transport never selects its own dataset. */
import {StorageControls} from './storage-controls.js';
import {LocalArchives} from './local-archives.js';
import {RemoteArchiveRecovery} from './remote-archive-recovery.js';
import {RemoteArchiveBackup} from './remote-archive-backup.js';
import {LocalDatabase} from '../local/storage/bootstrap.js';
import {localApplication} from './local-service.js';
import type {LocalOptions} from './local-service.js';
import {RemoteParticipant} from '../local/migration/remote.js';
import {SyncError,serverAddress} from '../../extension/backend-client.js';
import type {RuntimeControl,SentinelPort} from '../control/types.js';
import {RemoteControl} from '../local/storage/remote-control.js';
import type {RemoteDescriptor} from '../local/storage/remote-control.js';
import {ScopedState} from './state.js';
import type {StorageArea} from './state.js';
import {remoteApplication} from './remote-runtime.js';
import type {ApplicationContext,ApplicationService} from './service.js';

export interface ControlPort{
  read():Promise<RuntimeControl>;selectCredential(expected:RuntimeControl,ref:string,switchDataset:boolean,context:RemoteDescriptor):Promise<RuntimeControl>;
  remoteContext(expected:RuntimeControl):Promise<RemoteDescriptor>;
  localContext?(expected:RuntimeControl):Promise<{datasetId:string;awaitingSync:boolean;owners:string[]}>;
  bindIdentity?(expected:RuntimeControl,installationId:string,datasetId:string):Promise<RemoteDescriptor>;
  close():void;
  readState(expected:RuntimeControl,scope:string):Promise<Record<string,unknown>|null>;
  patchState(expected:RuntimeControl,scope:string,patch:Record<string,unknown>,initialize?:boolean):Promise<Record<string,unknown>>;
}
export interface ControlFactory{
  exists(name:string,port:SentinelPort):Promise<boolean>;
  open(name:string,port:SentinelPort,initialCredentialRef?:string,initialContext?:RemoteDescriptor):Promise<ControlPort>;
}
interface Credential{version:1;ref:string;url:string;token:string;contextId:string;legacy:boolean}
export interface ResolvedApplication{
  local?:ReturnType<typeof localApplication>;awaitingSync?:boolean;
  root:RuntimeControl;context:ApplicationContext;config:{url:string;token:string};service:ApplicationService;state:ScopedState;
  assert(allowPending?:boolean):Promise<void>;
}
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const credentialKey=(ref:string)=>'remoteCredential:'+ref;
const configured=(value:unknown):value is {url:string;token:string}=>{
  if(value===null||typeof value!=='object')return false;const data=value as Record<string,unknown>;
  return typeof data.url==='string'&&typeof data.token==='string'&&data.token.length>0&&data.token.length<=4096;
};
export class ApplicationRuntime{
  private control:ControlPort|null=null;
  private opening:Promise<void>|null=null;
  constructor(private area:StorageArea,private sentinel:SentinelPort,private name='zenimport-financial',private factory:ControlFactory=RemoteControl,private localOptions?:LocalOptions&{serverPermission(url:string):Promise<boolean>}){}
  #remote(config:{url:string;token:string;installationId?:string;datasetId?:string}){
    const options=this.localOptions;
    const fetcher=options?async(input:RequestInfo|URL,init?:RequestInit)=>{
      if(!await options.serverPermission(config.url))throw new SyncError('permission_required');
      const response=await (options.fetch??globalThis.fetch)(input,init);
      if(!await options.serverPermission(config.url)){void response.body?.cancel().catch(()=>{});throw new SyncError('permission_required');}
      return response;
    }:undefined;
    return remoteApplication(config,fetcher);
  }
  async #save(config:{url:string;token:string},contextId:string,legacy=false){
    const ref=crypto.randomUUID(),value:Credential={version:1,ref,url:serverAddress(config.url),token:config.token,contextId,legacy};
    await this.area.set({[credentialKey(ref)]:value});
    const saved=(await this.area.get(credentialKey(ref)))[credentialKey(ref)];
    if(saved===null||typeof saved!=='object'||Object.keys(saved).length!==Object.keys(value).length||
      !Object.entries(value).every(([key,item])=>(saved as Record<string,unknown>)[key]===item))throw new SyncError('recovery_required');return value;
  }
  async #ensure(){
    if(this.control)return;
    if(!this.opening)this.opening=(async()=>{
      if(await this.factory.exists(this.name,this.sentinel))this.control=await this.factory.open(this.name,this.sentinel);
      else{
        await this.area.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
        const {config}=await this.area.get('config');
        if(!configured(config)){
          if(!this.localOptions)return;
          const values=await this.area.get(null);
          if(config!==undefined||Object.keys(values).some(key=>key.startsWith('remoteCredential:')))throw new SyncError('recovery_required');
          const local=await LocalDatabase.open(this.name,this.sentinel,String(Math.floor((this.localOptions.clock??(()=>Date.now()/1000))())));local.close();
          this.control=await this.factory.open(this.name,this.sentinel);return;
        }
        const saved=await this.#save(config,crypto.randomUUID(),true);
        this.control=await this.factory.open(this.name,this.sentinel,saved.ref,{url:saved.url,contextId:saved.contextId,legacy:true});
      }
    })().finally(()=>{this.opening=null;});
    await this.opening;
  }
  async #assert(root:RuntimeControl,allowPending=false){
    const now=await this.control!.read();
    if(now.installationId!==root.installationId||now.activeMode!==root.activeMode||now.activeGeneration!==root.activeGeneration||now.epoch!==root.epoch||
      now.credentialRef!==root.credentialRef||now.credentialEpoch!==root.credentialEpoch)throw new SyncError('stale_context');
    if(!allowPending&&now.pendingSwitchId!==null)throw new SyncError('migration_paused');
  }
  #fenced(service:ApplicationService,assert:(allowPending?:boolean)=>Promise<void>){
    const fenced={} as Record<string,unknown>;
    for(const [group,value]of Object.entries(service)){
      if(typeof value==='function')fenced[group]=async()=>{await assert();const result=await value();await assert();return result;};
      else fenced[group]=Object.fromEntries(Object.entries(value).map(([method,fn])=>[method,async(...args:unknown[])=>{
        const pending=group==='migration'&&method==='status';await assert(pending);
        const result=await (fn as (...args:unknown[])=>Promise<unknown>)(...args);await assert(pending);return result;
      }]));
    }return fenced as unknown as ApplicationService;
  }
  async current(operationId:string=crypto.randomUUID()):Promise<ResolvedApplication|null>{
    await this.#ensure();if(!this.control)return null;const root=await this.control.read();
    if(root.activeMode==='local'){
      if(!this.localOptions||!this.control.localContext)throw new SyncError('local_mode_disabled');
      const local=localApplication(this.name,this.sentinel,this.area,root,this.localOptions),selected=await this.control.localContext(root),assert=(allowPending=false)=>this.#assert(root,allowPending);
      const id=root.activeGeneration!,url='local:'+id;
      const context:ApplicationContext={operation_id:operationId,dataset_id:selected.datasetId,generation:id,mode:'local',mode_epoch:root.epoch,credential_epoch:root.credentialEpoch};
      const state=new ScopedState(this.area,id,url,false,()=>assert(true),{read:()=>this.control!.readState(root,id),patch:(values,initialize)=>this.control!.patchState(root,id,values,initialize)});
      await state.hydrate();await assert(true);
      return {root,context,config:{url,token:root.credentialRef?'local-configured':''},service:this.#fenced(local.service,assert),state,assert,local,awaitingSync:selected.awaitingSync};
    }
    if(!root.credentialRef)throw new SyncError('recovery_required');
    let descriptor=await this.control.remoteContext(root);
    if(!uuid(descriptor.contextId)||serverAddress(descriptor.url)!==descriptor.url||typeof descriptor.legacy!=='boolean')throw new SyncError('recovery_required');
    const raw=(await this.area.get(credentialKey(root.credentialRef)))[credentialKey(root.credentialRef)];
    if(raw!==undefined&&(!configured(raw)||(raw as Credential).version!==1||(raw as Credential).ref!==root.credentialRef||
      (raw as Credential).contextId!==descriptor.contextId||(raw as Credential).url!==descriptor.url))throw new SyncError('recovery_required');
    if((descriptor.installationId===undefined)!==(descriptor.datasetId===undefined))throw new SyncError('recovery_required');
    const secret={...descriptor,token:raw===undefined?'':(raw as Credential).token};
    const assert=(allowPending=false)=>this.#assert(root,allowPending);
    const context:ApplicationContext={operation_id:operationId,dataset_id:secret.datasetId??secret.contextId,generation:secret.contextId,mode:'remote',mode_epoch:root.epoch,credential_epoch:root.credentialEpoch};
    const state=new ScopedState(this.area,secret.contextId,secret.url,secret.legacy,()=>assert(true),{
      read:()=>this.control!.readState(root,secret.contextId),
      patch:(values,initialize)=>this.control!.patchState(root,secret.contextId,values,initialize),
    });
    await state.hydrate();await assert(true);
    const remote=this.#remote(secret);
    if(this.localOptions&&descriptor.installationId===undefined){
      for(const [group,value]of Object.entries(remote))if(typeof value!=='function'){
        (remote as unknown as Record<string,unknown>)[group]=Object.fromEntries(Object.keys(value).map(method=>[method,async()=>{throw new SyncError('server_verification_required');}]));
      }
    }
    const service=this.#fenced(remote,assert);
    return {root,context,config:{url:secret.url,token:secret.token},service,state,assert};
  }
  /** Status can strengthen a legacy binding; failure leaves token repair usable. */
  async verifySelected(app:ResolvedApplication|null){
    if(!this.localOptions||!app||app.context.mode!=='remote'||!app.config.token||app.root.pendingSwitchId!==null)return app;
    const descriptor=await this.control!.remoteContext(app.root);if(descriptor.installationId!==undefined)return this.current(app.context.operation_id);
    await app.assert();const info=await this.#remote(app.config).capabilities();
    if((info as {context_fencing?:number}).context_fencing!==1)throw new SyncError('unsupported_api_version');
    const identity=await new RemoteParticipant(app.config,()=>this.localOptions!.serverPermission(app.config.url),this.localOptions.fetch).identity();
    if(!this.control!.bindIdentity)throw new SyncError('recovery_required');
    await this.control!.bindIdentity(app.root,identity.installation_id,identity.dataset_id);return this.current(app.context.operation_id);
  }
  async configure(config:{url:string;token:string},expected:ResolvedApplication|null){
    config={url:serverAddress(config.url),token:config.token.trim()};
    if(!configured(config))throw new SyncError('unauthorized');
    if(expected)await expected.assert();
    if(this.localOptions&&expected&&(expected.context.mode!=='remote'||expected.config.url!==config.url))throw new SyncError('migration_required');
    const info=await this.#remote(config).capabilities();
    let binding:Partial<RemoteDescriptor>={};
    if(this.localOptions){
      if((info as {context_fencing?:number}).context_fencing!==1)throw new SyncError('unsupported_api_version');
      const identity=await new RemoteParticipant(config,()=>this.localOptions!.serverPermission(config.url),this.localOptions.fetch).identity();
      if(expected){const previous=await this.control!.remoteContext(expected.root);if(previous.installationId!==undefined&&(previous.installationId!==identity.installation_id||previous.datasetId!==identity.dataset_id))throw new SyncError('stale_context');}
      binding={installationId:identity.installation_id,datasetId:identity.dataset_id};
    }
    const changed=expected?.config.url!==config.url,saved=await this.#save(config,changed?crypto.randomUUID():expected!.context.generation);
    const previous=expected?.context.mode==='remote'?await this.control!.remoteContext(expected.root):null;
    const descriptor={url:saved.url,contextId:saved.contextId,legacy:false,...(previous?.installationId?{installationId:previous.installationId,datasetId:previous.datasetId}:{}),...binding};
    if(expected)await this.control!.selectCredential(expected.root,saved.ref,changed,descriptor);
    else{
      if(await this.factory.exists(this.name,this.sentinel))throw new SyncError('stale_context');
      this.control=await this.factory.open(this.name,this.sentinel,saved.ref,descriptor);
      if((await this.control.read()).credentialRef!==saved.ref)throw new SyncError('stale_context');
    }
    // The Root reference is authoritative if the worker dies before this legacy
    // projection is updated. Candidate credentials were acknowledged beforehand.
    await this.area.set({config});const selected=(await this.current())!;
    if(expected?.root.credentialRef&&expected.root.credentialRef!==saved.ref)await this.area.remove(credentialKey(expected.root.credentialRef));
    return selected;
  }
  #controlOptions(){
    if(!this.localOptions)throw new SyncError('local_mode_disabled');
    return {...this.localOptions,name:this.name,sentinel:this.sentinel,persistent:this.area,
      verifyServer:(config:{url:string;token:string})=>this.#remote(config).capabilities()};
  }
  controls(app:ResolvedApplication){return new StorageControls(this.#controlOptions(),app);}
  archives(app:ResolvedApplication){const options=this.#controlOptions();return {
    local:new LocalArchives(options,app),recovery:new RemoteArchiveRecovery(options),backup:new RemoteArchiveBackup(options,app),
  };}
  async configureLocal(token:string,expected:ResolvedApplication){
    if(!expected.local||expected.context.mode!=='local')throw new SyncError('stale_context');
    await expected.assert();await expected.local.verify(token);return this.current();
  }
  close(){this.control?.close();this.control=null;}
}
