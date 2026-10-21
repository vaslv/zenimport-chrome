/** Privileged service selection. A transport never selects its own dataset. */
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
  constructor(private area:StorageArea,private sentinel:SentinelPort,private name='zenimport-financial',private factory:ControlFactory=RemoteControl){}
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
        const {config}=await this.area.get('config');if(!configured(config))return;
        const saved=await this.#save(config,crypto.randomUUID(),true);
        this.control=await this.factory.open(this.name,this.sentinel,saved.ref,{url:saved.url,contextId:saved.contextId,legacy:true});
      }
    })().finally(()=>{this.opening=null;});
    await this.opening;
  }
  async current(operationId:string=crypto.randomUUID()):Promise<ResolvedApplication|null>{
    await this.#ensure();if(!this.control)return null;const root=await this.control.read();
    if(root.activeMode!=='remote')throw new SyncError('local_mode_disabled');
    if(!root.credentialRef)throw new SyncError('recovery_required');
    const descriptor=await this.control.remoteContext(root);
    if(!uuid(descriptor.contextId)||serverAddress(descriptor.url)!==descriptor.url||typeof descriptor.legacy!=='boolean')throw new SyncError('recovery_required');
    const raw=(await this.area.get(credentialKey(root.credentialRef)))[credentialKey(root.credentialRef)];
    if(raw!==undefined&&(!configured(raw)||(raw as Credential).version!==1||(raw as Credential).ref!==root.credentialRef||
      (raw as Credential).contextId!==descriptor.contextId||(raw as Credential).url!==descriptor.url))throw new SyncError('recovery_required');
    const secret={...descriptor,token:raw===undefined?'':(raw as Credential).token};
    const assert=async(allowPending=false)=>{
      const now=await this.control!.read();
      if(now.installationId!==root.installationId||now.activeMode!==root.activeMode||now.activeGeneration!==root.activeGeneration||now.epoch!==root.epoch||
        now.credentialRef!==root.credentialRef||now.credentialEpoch!==root.credentialEpoch)throw new SyncError('stale_context');
      if(!allowPending&&now.pendingSwitchId!==null)throw new SyncError('migration_paused');
    };
    const context:ApplicationContext={operation_id:operationId,dataset_id:secret.contextId,generation:secret.contextId,mode:'remote',mode_epoch:root.epoch,credential_epoch:root.credentialEpoch};
    const state=new ScopedState(this.area,secret.contextId,secret.url,secret.legacy,()=>assert(true),{
      read:()=>this.control!.readState(root,secret.contextId),
      patch:(values,initialize)=>this.control!.patchState(root,secret.contextId,values,initialize),
    });
    await state.hydrate();await assert(true);
    const service=remoteApplication(secret),fenced={} as Record<string,unknown>;
    for(const [group,value]of Object.entries(service)){
      if(typeof value==='function')fenced[group]=async()=>{await assert(true);const result=await value();await assert(true);return result;};
      else fenced[group]=Object.fromEntries(Object.entries(value).map(([method,fn])=>[method,async(...args:unknown[])=>{
        const pending=group==='migration'&&method==='status';await assert(pending);
        const result=await (fn as (...args:unknown[])=>Promise<unknown>)(...args);await assert(pending);return result;
      }]));
    }
    return {root,context,config:{url:secret.url,token:secret.token},service:fenced as unknown as ApplicationService,state,assert};
  }
  async configure(config:{url:string;token:string},expected:ResolvedApplication|null){
    config={url:serverAddress(config.url),token:config.token.trim()};
    if(!configured(config))throw new SyncError('unauthorized');
    if(expected)await expected.assert();await remoteApplication(config).capabilities();
    const changed=expected?.config.url!==config.url,saved=await this.#save(config,changed?crypto.randomUUID():expected!.context.dataset_id);
    const descriptor={url:saved.url,contextId:saved.contextId,legacy:false};
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
  close(){this.control?.close();this.control=null;}
}
