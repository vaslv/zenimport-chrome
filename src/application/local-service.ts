/** Named local facade. Only the durable delivery worker can construct a writer. */
import {SyncError} from '../../extension/backend-client.js';
import type {SentinelPort,RuntimeControl} from '../control/types.js';
import type {StorageArea} from './state.js';
import type {ApplicationService} from './service.js';
import {MirrorRepository} from '../local/storage/mirror-repository.js';
import {AccountRepository} from '../local/storage/account-repository.js';
import {CaptureRepository} from '../local/storage/capture-repository.js';
import {ReportRepository} from '../local/storage/report-repository.js';
import {FirstSyncOwner} from '../local/storage/first-sync-owner.js';
import {DeliveryAuthorizationRepository} from '../local/storage/delivery-authorization-repository.js';
import {DeliveryScheduleRepository} from '../local/storage/delivery-schedule-repository.js';
import {OutboxRepository} from '../local/storage/outbox-repository.js';
import {ReconciliationRepository} from '../local/storage/reconciliation-repository.js';
import {LocalCredentials} from '../local/zenmoney/credentials.js';
import {CredentialCandidates} from '../local/zenmoney/candidates.js';
import {LocalMirror} from '../local/zenmoney/mirror.js';
import {LocalCatalog} from '../local/zenmoney/catalog.js';
import {mirrorReader} from '../local/zenmoney/reader.js';
import {DeliverySender} from '../local/delivery/sender.js';
import {DeliveryWorker} from '../local/delivery/worker.js';
export interface LocalOptions{
  session:StorageArea;permission():Promise<boolean>;fetch?:typeof fetch;clock?:()=>number;
}
export function localApplication(name:string,sentinel:SentinelPort,area:StorageArea,root:RuntimeControl,options:LocalOptions){
  const clock=options.clock??(()=>Date.now()/1000),now=()=>String(Math.floor(clock())),fence={installationId:root.installationId,generation:root.activeGeneration!,epoch:root.epoch,credentialEpoch:root.credentialEpoch};
  const reader=mirrorReader(options),candidates=new CredentialCandidates(area,reader,clock);
  async function unit<T>(work:(value:{store:MirrorRepository;credentials:LocalCredentials;mirror:LocalMirror})=>Promise<T>){
    const store=await MirrorRepository.open(name,sentinel,clock,root);
    try{const credentials=new LocalCredentials(area,options.session,store,reader,clock);return await work({store,credentials,mirror:new LocalMirror(store,credentials,reader,clock)});}
    finally{store.close();}
  }
  async function accounts<T>(work:(value:AccountRepository)=>Promise<T>){
    const value=await AccountRepository.open(name,sentinel,fence);try{return await work(value);}finally{value.close();}
  }
  async function capture<T>(work:(value:CaptureRepository)=>Promise<T>){
    const value=await CaptureRepository.open(name,sentinel,fence);try{return await work(value);}finally{value.close();}
  }
  async function setup(explicitRequestId?:string,refresh=false){
    const first=await FirstSyncOwner.open(name,sentinel,ref=>candidates.verifyReference(ref),clock,root);
    try{
      const {awaitingSync}=await first.status();
      if(awaitingSync||explicitRequestId||refresh)await unit(({mirror})=>mirror.refresh());
      if(awaitingSync)await first.prepare();
    }finally{first.close();}
  }
  // Named repositories validate every DTO. The public facade widens exact
  // counters only; it does not convert an int64/instrument to an unsafe number.
  const service={
    capabilities:()=>unit(async({mirror})=>{const state=await mirror.readiness();return {api_version:1,service_version:'local',max_body_bytes:1048576,max_page_records:500,
      zenmoney_state:state.ready?'ready':state.configured?'unavailable':'not_configured',last_zenmoney_refresh:state.lastRefresh===null?null:new Date(Number(state.lastRefresh)*1000).toISOString()};}),
    connections:{list:(bank:string)=>accounts(value=>value.list(bank)),get:(id:string)=>accounts(value=>value.get(id)),
      discover:async(data:unknown)=>{await setup();return accounts(value=>value.discover(data,now()));},
      rename:(id:string,data:{label:string})=>accounts(value=>value.rename(id,data.label)),
      unlink:(id:string,account:string)=>accounts(value=>value.unlink(id,account,now()))},
    accounts:{catalog:()=>unit(({store,credentials,mirror})=>new LocalCatalog(store,credentials,mirror,clock).get()),
      configure:async(id:string,data:unknown)=>{await setup(undefined,true);return accounts(value=>value.configure(id,data,now()));}},
    capture:{start:async(data:{request_id:string})=>{await setup(data.request_id);return capture(value=>value.start(data,now(),true,clock));},
      get:(id:string)=>capture(value=>value.get(id,now())),lease:(id:string,data:unknown)=>capture(value=>value.lease(id,data,now())),
      page:(id:string,interval:string,number:number,data:unknown)=>capture(value=>value.page(id,interval,number,data,now())),
      complete:(id:string,interval:string,data:unknown)=>capture(value=>value.complete(id,interval,data,now())),
      pause:(id:string,data:unknown)=>capture(value=>value.pause(id,data,now())),stop:(id:string)=>capture(value=>value.stop(id,now()))},
    reports:{discrepancies:async(id:string,query:{refresh?:boolean;from_date?:string;to_date?:string;account_id?:string})=>{
      if(query.refresh)await unit(({mirror})=>mirror.refresh({force:true,transactions:true}));
      const value=await ReportRepository.open(name,sentinel,fence);try{return await value.build({connection_id:id,...query},now());}finally{value.close();}}},
    // Legacy format-1 transport has no local authority. The popup uses the
    // separate, explicit control owners for verified portable transfers.
    migration:{status:async()=>{throw new SyncError('unsupported_migration_version');},
      resume:async()=>{throw new SyncError('unsupported_migration_version');},export:async()=>{throw new SyncError('unsupported_migration_version');},import:async()=>{throw new SyncError('unsupported_migration_version');}},
  } as unknown as ApplicationService;
  async function delivery<T>(work:(worker:DeliveryWorker)=>Promise<T>){
    return unit(async({store,credentials,mirror})=>{
      const opened:{close():void}[]=[];
      const open=async<T extends {close():void}>(promise:Promise<T>)=>{const value=await promise;opened.push(value);return value;};
      try{
        const authorization=await open(DeliveryAuthorizationRepository.open(name,sentinel,fence)),schedule=await open(DeliveryScheduleRepository.open(name,sentinel,fence)),
          outbox=await open(OutboxRepository.open(name,sentinel,fence)),reconciliation=await open(ReconciliationRepository.open(name,sentinel,fence)),jobs=await open(CaptureRepository.open(name,sentinel,fence));
        return await work(new DeliveryWorker(authorization,schedule,outbox,mirror,reconciliation,jobs,new DeliverySender(outbox,store,credentials,{...options,clock}),clock));
      }finally{for(const owner of opened.reverse())owner.close();}
    });
  }
  return {service,recoverSettings:()=>accounts(value=>value.recoverSettings()),readiness:()=>unit(({mirror})=>mirror.readiness()),verify:(token:string)=>unit(({credentials})=>credentials.verify(token)),
    remove:()=>unit(({credentials})=>credentials.remove()),saveDraft:(token:string)=>unit(({credentials})=>token===''?credentials.cancelDraft():credentials.saveDraft(token)),
    draft:()=>unit(({credentials})=>credentials.draft()),delivery:{next:()=>delivery(value=>value.next()),run:()=>delivery(value=>value.run())}};
}
