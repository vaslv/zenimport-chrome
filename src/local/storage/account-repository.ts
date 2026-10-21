/** Named connection/account owner; no HTTP emulation or raw handles escape. */
import type {ContextFence,SentinelPort} from '../../control/types.js';
import type {DiscoverConnection} from '../../application/dto.generated.js';
import type {RepositorySession} from './kernel.js';
import {RepositoryOwner} from './repository-owner.js';
import {int64} from './types.js';
import {discovery,name,text as validText} from '../capture/validation.js';
import {CaptureError,requireCapture} from '../capture/errors.js';
import {text,get,invalidateAccounts,canonicalSupport} from './capture-policy.js';
import {canonicalDto} from '../../domain/codec.js';
import {AccountSettingsOwner} from './account-settings.js';
import {connectionView} from './account-views.js';

export class AccountRepository{
  private constructor(private owner:RepositoryOwner,private name:string,private sentinel:SentinelPort,private fence:ContextFence){}
  static async open(name:string,sentinel:SentinelPort,fence:ContextFence){return new AccountRepository(await RepositoryOwner.open(name,sentinel,fence,true),name,sentinel,{...fence});}
  async list(bank:string){
    requireCapture(['bidv','vietinbank'].includes(bank),'unsupported_bank');
    return this.owner.read(async view=>{const connections=[];
      for(const row of await view.rows('connections'))if(row.bank===bank)connections.push(await connectionView(view,row.id));return {connections};
    });
  }
  async get(id:string){return this.owner.read(view=>connectionView(view,validText(id)));}
  async rename(id:string,label:unknown){
    const cleaned=name(label);validText(id);return this.owner.write(async view=>{
      await get(view,'connections',id);const key=[text(id)],row={connection_id:id,label:cleaned};
      if(await view.get('connection_labels',key))await view.replace('connection_labels',key,row);else await view.insert('connection_labels',row);
      return connectionView(view,id);
    });
  }
  async discover(input:unknown,now:string){
    const data=discovery(input),stamp=int64(now);requireCapture(BigInt(stamp)>=0n);
    return this.owner.write(async view=>this.#discover(view,data,stamp));
  }
  async #discover(view:RepositorySession,data:DiscoverConnection,now:string){
    const caps=canonicalDto(data.capabilities),old=await view.find('connections',['bank','profile_key'],[text(data.bank),text(data.profile_key)]),id=old?.id??crypto.randomUUID();
    requireCapture(!old||old.profile_identity===data.profile_identity,'settings_conflict');
    if(old&&(old.capabilities_json!==caps||old.connector_version!==data.connector_version)){
      const members=await view.rows('connection_accounts',[text(id)]);await invalidateAccounts(view,new Set(members.map(row=>row.account_id)),'capture_context_changed',now,id);
    }
    const row={id,bank:data.bank,profile_key:data.profile_key,profile_identity:data.profile_identity,connector_version:data.connector_version,
      timezone:data.capabilities.timezone,capabilities_json:caps,accounts_complete:int64(data.accounts_complete?'1':'0')};
    if(old)await view.replace('connections',[text(id)],row);else await view.insert('connections',row);
    if(data.label!=null){const value={connection_id:id,label:data.label};
      if(await view.get('connection_labels',[text(id)]))await view.replace('connection_labels',[text(id)],value);else await view.insert('connection_labels',value);
    }
    const previous=new Set<string>();
    for(const found of await view.rows('connection_discovery',[text(id)]))if(found.present==='1'){
      previous.add(found.account_id);if(data.accounts_complete)await view.replace('connection_discovery',[text(id),text(found.account_id)],{...found,present:int64('0')});
    }
    const seen=new Set<string>();
    for(const found of data.accounts){
      const profile=found.identity_scope==='profile'?data.profile_key:'';
      const existing=await view.find('bank_accounts',['bank','identity_scope','profile_key','source_key','currency'],[data.bank,found.identity_scope,profile,found.source_key,found.currency].map(text));
      requireCapture(!existing||existing.scale===String(found.scale),'unsupported_currency');const accountId=existing?.id??crypto.randomUUID();
      if(!existing)await view.insert('bank_accounts',{id:accountId,bank:data.bank,identity_scope:found.identity_scope,profile_key:profile,source_key:found.source_key,
        currency:found.currency,scale:int64(String(found.scale)),label:found.label,masked_number:found.masked_number,supported:int64(found.supported?'1':'0'),
        unsupported_reason:found.unsupported_reason??null,selection:'unconfigured',zenmoney_account_id:null,import_start:null,settings_version:int64('0'),last_complete_end:null});
      const key=[text(id),text(accountId)];if(!await view.get('connection_accounts',key))await view.insert('connection_accounts',{connection_id:id,account_id:accountId});
      const observed={connection_id:id,account_id:accountId,present:int64('1'),supported:int64(found.supported?'1':'0'),unsupported_reason:found.unsupported_reason??null,label:found.label,masked_number:found.masked_number};
      if(await view.get('connection_discovery',key))await view.replace('connection_discovery',key,observed);else await view.insert('connection_discovery',observed);
      seen.add(accountId);if(!found.supported)await invalidateAccounts(view,new Set([accountId]),'capture_context_changed',now,id);
    }
    if(data.accounts_complete)await invalidateAccounts(view,new Set([...previous].filter(id=>!seen.has(id))),'capture_context_changed',now,id);
    await canonicalSupport(view);return connectionView(view,id);
  }
  async unlink(id:string,accountId:string,now:string){
    validText(id);validText(accountId);int64(now);return this.owner.write(async view=>{
      await get(view,'connections',id);if(!await view.get('connection_accounts',[text(id),text(accountId)]))throw new CaptureError('not_found');
      const discovered=await view.get('connection_discovery',[text(id),text(accountId)]);
      if(discovered)await view.replace('connection_discovery',[text(id),text(accountId)],{...discovered,present:int64('0')});
      await invalidateAccounts(view,new Set([accountId]),'settings_conflict',now,id);await canonicalSupport(view);return connectionView(view,id);
    });
  }
  async configure(id:string,input:unknown,now:string){
    validText(id);const setup=await AccountSettingsOwner.open(this.name,this.sentinel,this.fence);
    try{return await setup.run(id,input,now);}finally{setup.close();}
  }
  async recoverSettings(){
    const setup=await AccountSettingsOwner.open(this.name,this.sentinel,this.fence);
    try{return await setup.recover();}finally{setup.close();}
  }
  close(){this.owner.close();}
}
