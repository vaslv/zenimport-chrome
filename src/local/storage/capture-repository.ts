import {stopJob} from './capture-policy.js';
/** Durable local bank capture. A committed page ACK never depends on API delivery. */
import type {ContextFence,SentinelPort} from '../../control/types.js';
import type {RepositorySession} from './kernel.js';
import type {RowByTable} from './schema.generated.js';
import {RepositoryOwner} from './repository-owner.js';
import {int64} from './types.js';
import {CaptureError,requireCapture} from '../capture/errors.js';
import type {CaptureCode} from '../capture/errors.js';
import {startCommand,leaseCommand,pageCommand,completeCommand,statusCommand,uuid} from '../capture/commands.js';
import {text,get,ACTIVE,aggregate,addError,refreshJob,connectionCapabilities} from './capture-policy.js';
import {canonicalDto,dtoDigest} from '../../domain/codec.js';
import {localDay} from '../../domain/dates.js';
import {plannedRanges,mergeRanges,chunks,frontier,subtractRange} from '../../domain/periods.js';
import type {DayRange} from '../../domain/periods.js';
import {knownBank,saveRecord,validateRecord} from './bank-records.js';
import {connectionView} from './account-views.js';

const messages:Partial<Record<CaptureCode,string>>={lease_expired:'Capture lease expired',settings_conflict:'Account settings have changed',
  capture_context_changed:'Capture context has changed',history_incomplete:'History capture is incomplete',bank_login_required:'Sign in to online banking',
  idempotency_conflict:'Repeated request content differs',zenmoney_unavailable:'No current ZenMoney catalog is available',
  zenmoney_account_unavailable:'The selected ZenMoney account is unavailable',delivery_uncertain:'Verify the previous delivery result first',
  existing_ownership_unknown:'Could not identify the account used by the previous match',account_disabled:'Account disabled'};
type LeaseWrite={worker_id:string;lease_epoch:string};
export class CaptureRepository{
  private constructor(private owner:RepositoryOwner){}
  static async open(name:string,sentinel:SentinelPort,fence:ContextFence){return new CaptureRepository(await RepositoryOwner.open(name,sentinel,fence));}
  async #expire(view:RepositorySession,id:string,now:string){
    const row=await get(view,'capture_jobs',id);
    if(row.worker_id!==null&&row.lease_expires_at!==null&&BigInt(row.lease_expires_at)<=BigInt(now)&&ACTIVE.includes(row.capture_state)){
      for(const interval of await view.related('capture_intervals',['job_id'],[text(id)]))if(['planned','collecting'].includes(interval.state))await view.replace('capture_intervals',[text(interval.id)],{...interval,state:'paused'});
      await view.replace('capture_jobs',[text(id)],{...row,capture_state:'paused',worker_id:null,lease_expires_at:null});
      await addError(view,id,null,'lease_expired',now,true);return true;
    }return false;
  }
  async #resume(view:RepositorySession,id:string){
    for(const interval of await view.related('capture_intervals',['job_id'],[text(id)]))if(interval.state==='paused')await view.replace('capture_intervals',[text(interval.id)],{...interval,state:'planned'});
    for(const error of await view.related('capture_errors',['job_id'],[text(id)]))if(['bank_login_required','lease_expired'].includes(error.code))await view.replace('capture_errors',[text(error.id)],{...error,resolved:int64('1')});
    await refreshJob(view,id);
  }
  async #intervalView(view:RepositorySession,row:RowByTable['capture_intervals']){
    return {id:row.id,period:{start:row.start_date,end:row.end_date},state:row.state,
      received_pages:await view.count('capture_pages',[text(row.id)]),received_records:await view.count('captured_records',[text(row.id)])};
  }
  async #jobView(view:RepositorySession,id:string,now:string){
    await this.#expire(view,id,now);const job=await get(view,'capture_jobs',id),accounts=[],counts={pending:0,delivered:0,suppressed:0,uncertain:0};
    for(const snapshot of await view.rows('job_accounts',[text(id)])){
      const intervals=(await view.related('capture_intervals',['job_id','account_id','state'],[text(id),text(snapshot.account_id),text('planned')])) as RowByTable['capture_intervals'][];
      // The closed state set avoids an unbounded cross-job history scan.
      for(const state of ['collecting','paused','failed','cancelled','complete'])intervals.push(...await view.related('capture_intervals',['job_id','account_id','state'],[text(id),text(snapshot.account_id),text(state)]));
      intervals.sort((a,b)=>a.start_date<b.start_date?-1:a.start_date>b.start_date?1:a.id<b.id?-1:a.id>b.id?1:0);
      accounts.push({account_id:snapshot.account_id,settings_version:snapshot.settings_version,capture_state:aggregate(intervals.map(row=>row.state)),intervals:await Promise.all(intervals.map(row=>this.#intervalView(view,row)))});
      const observed=new Set<string>();for(const interval of intervals)for(const record of await view.rows('captured_records',[text(interval.id)]))observed.add(record.bank_id);
      const banks=(await view.related('bank_transactions',['account_id'],[text(snapshot.account_id)])).filter(row=>row.local_date>=snapshot.authorized_start&&row.local_date<=job.end_date||observed.has(row.id));
      for(let i=0;i<banks.length;i+=500)for(const processing of await view.getMany('bank_processing',banks.slice(i,i+500).map(row=>[text(row.id)]))){
        if(!processing)continue;const state=processing.state==='prepared'?'pending':processing.state;requireCapture(Object.hasOwn(counts,state),'capture_context_changed');counts[state as keyof typeof counts]++;
      }
    }
    if(counts.uncertain)await addError(view,id,null,'delivery_uncertain',now,true);
    else for(const error of await view.related('capture_errors',['job_id'],[text(id)]))if(error.code==='delivery_uncertain'&&error.resolved==='0')await view.replace('capture_errors',[text(error.id)],{...error,resolved:int64('1')});
    const blocking=new Set(['zenmoney_unavailable','zenmoney_account_unavailable','delivery_uncertain','existing_ownership_unknown','account_disabled','settings_conflict']);
    const blocked=(await view.related('capture_errors',['job_id'],[text(id)])).some(row=>row.resolved==='0'&&blocking.has(row.code));
    const active=(await view.related('deliveries',['authorized_job_id'],[text(id)])).some(row=>row.state==='attempting');
    const deliveryState=active?'running':!counts.pending&&!counts.uncertain&&job.capture_state==='complete'?'complete':blocked?'blocked':'waiting';
    await view.replace('capture_jobs',[text(id)],{...job,delivery_state:deliveryState});
    const errors=(await view.related('capture_errors',['job_id'],[text(id)])).filter(row=>row.resolved==='0').sort((a,b)=>BigInt(a.created_at)<BigInt(b.created_at)?-1:BigInt(a.created_at)>BigInt(b.created_at)?1:a.id<b.id?-1:1)
      .map(row=>({code:messages[row.code as CaptureCode]?row.code:'capture_context_changed',message:messages[row.code as CaptureCode]??messages.capture_context_changed!,retryable:row.retryable==='1',request_id:row.id}));
    return {id:job.id,connection_id:job.connection_id,capture_state:job.capture_state,delivery_state:deliveryState,end_date:job.end_date,accounts,delivery:counts,errors};
  }
  async get(id:string,now:string){id=uuid(id);int64(now);return this.owner.command(view=>this.#jobView(view,id,now));}
  async start(input:unknown,now:string){
    const data=startCommand(input),body=canonicalDto(data);int64(now);
    return this.owner.command(async view=>{
      const known=await view.get('job_requests',[text(data.request_id)]);
      if(known){requireCapture(known.request_json===body,'idempotency_conflict');await this.owner.queueAuthorization(view,known.job_id,now);return this.#jobView(view,known.job_id,now);}
      const connection=await get(view,'connections',data.connection_id);requireCapture(connection.timezone!==null,'capture_context_changed');
      const caps=connectionCapabilities(connection),end=localDay(new Date(Number(now)*1000).toISOString(),connection.timezone);
      requireCapture(data.reimport_from===null||data.reimport_from<=end&&(caps.earliest_date==null||data.reimport_from>=caps.earliest_date));
      const active=(await view.related('capture_jobs',['connection_id'],[text(connection.id)])).find(row=>ACTIVE.includes(row.capture_state));
      if(active){
        const original=JSON.parse(active.request_json);requireCapture(original.reimport_from===data.reimport_from,'account_busy');
        await this.#expire(view,active.id,now);await this.#resume(view,active.id);
        await view.insert('job_requests',{request_id:data.request_id,job_id:active.id,request_json:body});await this.owner.queueAuthorization(view,active.id,now);return this.#jobView(view,active.id,now);
      }
      const discovered=(await connectionView(view,connection.id)).accounts,selected=[];
      for(const row of discovered)if(row.selection==='enabled'&&row.supported)selected.push(await get(view,'bank_accounts',row.id));
      if(!selected.length)throw new CaptureError(discovered.some(row=>row.selection==='unconfigured')?'account_unconfigured':'account_disabled');
      for(const row of selected)requireCapture(await view.get('source_capture_leases',[text(row.id)])===null,'account_busy');
      const id=crypto.randomUUID(),plans:RowByTable['capture_intervals'][]=[];
      await view.insert('capture_jobs',{id,connection_id:connection.id,request_id:data.request_id,request_json:body,end_date:end,capture_state:'planned',delivery_state:'waiting',worker_id:null,lease_epoch:int64('0'),lease_expires_at:null,created_at:int64(now)});
      await view.insert('job_requests',{request_id:data.request_id,job_id:id,request_json:body});
      await view.insert('job_context',{job_id:id,connector_version:connection.connector_version,timezone:connection.timezone,capabilities_json:connection.capabilities_json});
      await this.owner.queueAuthorization(view,id,now);
      for(const account of selected){
        requireCapture(account.import_start!==null&&account.zenmoney_account_id!==null,'account_unconfigured');
        const coverage=(await view.rows('coverage',[text(account.id)])).map(row=>[row.start_date,row.end_date] as DayRange);
        const outstanding=(await view.related('reimport_ranges',['account_id'],[text(account.id)])).filter(row=>row.settings_version===account.settings_version).flatMap(row=>JSON.parse(row.remaining_json) as DayRange[]);
        const ranges=mergeRanges([...plannedRanges(account.import_start,end,coverage,data.reimport_from),...outstanding]);
        const authorized=[account.import_start,...ranges.map(([left])=>left)].sort()[0];
        await view.insert('job_accounts',{job_id:id,account_id:account.id,settings_version:account.settings_version,target_id:account.zenmoney_account_id,import_start:account.import_start,authorized_start:authorized});
        if(data.reimport_from)await view.insert('reimport_ranges',{id:crypto.randomUUID(),account_id:account.id,settings_version:account.settings_version,source_job_id:id,remaining_json:canonicalDto([[data.reimport_from,end]])});
        await view.insert('source_capture_leases',{account_id:account.id,job_id:id});
        for(const [start,finish]of chunks(ranges,caps.max_window_days)){
          requireCapture(plans.length<10000);plans.push({id:crypto.randomUUID(),job_id:id,account_id:account.id,settings_version:account.settings_version,start_date:start,end_date:finish,state:'planned',total_pages:null,total_records:null});
        }
      }
      for(let i=0;i<plans.length;i+=500)await view.insertCapturePlan(plans.slice(i,i+500));
      await refreshJob(view,id);return this.#jobView(view,id,now);
    });
  }
  async lease(id:string,input:unknown,now:string){
    id=uuid(id);const data=leaseCommand(input);int64(now);
    return this.owner.command(async view=>{
      await this.#expire(view,id,now);let row=await get(view,'capture_jobs',id);
      if(!ACTIVE.includes(row.capture_state))throw new CaptureError('capture_context_changed',false,true);
      if((await view.related('capture_errors',['job_id'],[text(id)])).some(row=>row.code==='bank_login_required'&&row.resolved==='0'))throw new CaptureError('bank_login_required',false,true);
      if(row.worker_id!==null&&row.worker_id!==data.worker_id)throw new CaptureError('capture_busy',true);
      const epoch=row.worker_id!==null?row.lease_epoch:int64(String(BigInt(row.lease_epoch)+1n));await this.#resume(view,id);row=await get(view,'capture_jobs',id);
      await view.replace('capture_jobs',[text(id)],{...row,worker_id:data.worker_id,lease_epoch:epoch,lease_expires_at:int64(String(BigInt(now)+120n)),capture_state:'collecting'});
      return {worker_id:data.worker_id,epoch,expires_at:new Date((Number(now)+120)*1000).toISOString()};
    });
  }
  async #guard(view:RepositorySession,id:string,data:LeaseWrite,now:string){
    const expired=await this.#expire(view,id,now),job=await get(view,'capture_jobs',id);
    if(expired||job.worker_id!==data.worker_id||job.lease_epoch!==data.lease_epoch||job.lease_expires_at===null||BigInt(job.lease_expires_at)<=BigInt(now))throw new CaptureError('lease_expired',true,expired);
    requireCapture(ACTIVE.includes(job.capture_state),'capture_context_changed');return job;
  }
  async #intervalGuard(view:RepositorySession,jobId:string,id:string){
    await get(view,'capture_jobs',jobId);const interval=await get(view,'capture_intervals',id);requireCapture(interval.job_id===jobId,'not_found');
    const account=await get(view,'bank_accounts',interval.account_id);requireCapture(account.selection==='enabled','account_disabled');
    requireCapture(account.settings_version===interval.settings_version,'settings_conflict');requireCapture(ACTIVE.includes(interval.state),'capture_context_changed');return {interval,account};
  }
  async #fail(view:RepositorySession,interval:RowByTable['capture_intervals'],code:CaptureCode,now:string):Promise<never>{
    await view.replace('capture_intervals',[text(interval.id)],{...interval,state:'failed'});await addError(view,interval.job_id,interval.account_id,code,now);await refreshJob(view,interval.job_id);throw new CaptureError(code,false,true);
  }
  async page(jobId:string,id:string,number:number,input:unknown,now:string){
    jobId=uuid(jobId);id=uuid(id);const data=pageCommand(input);requireCapture(number===data.page_number);int64(now);
    const payload={page_number:data.page_number,total_pages:data.total_pages,total_records:data.total_records,records:data.records},body=canonicalDto(payload),digest=await dtoDigest(payload);
    return this.owner.command(async view=>{
      await get(view,'capture_jobs',jobId);const any=await get(view,'capture_intervals',id);requireCapture(any.job_id===jobId,'not_found');
      const key=[text(id),['integer',int64(String(number))] as const],old=await view.get('capture_pages',key);
      if(old?.digest===digest&&old.payload_json===body)return {page_number:number,received_records:Number(old.records_count),repeated:true};
      const {interval,account}=await this.#intervalGuard(view,jobId,id);await this.#guard(view,jobId,data,now);
      if(data.total_records&&data.total_pages>data.total_records)return this.#fail(view,interval,'history_incomplete',now);
      if(old)return this.#fail(view,interval,'idempotency_conflict',now);
      if(interval.total_pages!==null&&(interval.total_pages!==String(data.total_pages)||interval.total_records!==String(data.total_records)))return this.#fail(view,interval,'history_incomplete',now);
      const context=await view.get('job_context',[text(jobId)]);requireCapture(context!==null,'capture_context_changed');
      const canonical=new Set<string>();
      for(const record of data.records){
        try{validateRecord(record,account,context.timezone,interval.start_date,interval.end_date,context.connector_version);}catch(error){if(error instanceof CaptureError&&error.code==='capture_context_changed')return this.#fail(view,interval,error.code,now);throw error;}
        const known=await knownBank(view,account.id,record.external_id);
        if(known){
          if(canonical.has(known.id)||await view.get('captured_records',[text(id),text(known.id)])!==null||known.raw_json!==JSON.stringify(record)&&BigInt(known.revision)===9223372036854775807n)return this.#fail(view,interval,'history_incomplete',now);
          canonical.add(known.id);
        }
      }
      if(await view.count('captured_records',[text(id)])+data.records.length>data.total_records)return this.#fail(view,interval,'history_incomplete',now);
      await view.insert('capture_pages',{interval_id:id,page_number:int64(String(number)),digest,records_count:int64(String(data.records.length)),payload_json:body});
      for(const record of data.records){const saved=await saveRecord(view,account.id,record,context.connector_version,now);await view.insert('captured_records',{interval_id:id,page_number:int64(String(number)),bank_id:saved.id,revision:saved.revision});}
      await view.replace('capture_intervals',[text(id)],{...interval,state:'collecting',total_pages:int64(String(data.total_pages)),total_records:int64(String(data.total_records))});
      await refreshJob(view,jobId);return {page_number:number,received_records:data.records.length,repeated:false};
    });
  }
  async complete(jobId:string,id:string,input:unknown,now:string){
    jobId=uuid(jobId);id=uuid(id);const data=completeCommand(input);int64(now);
    return this.owner.command(async view=>{
      let interval=await get(view,'capture_intervals',id);requireCapture(interval.job_id===jobId,'not_found');
      if(interval.state==='complete'){requireCapture(interval.total_pages===String(data.total_pages)&&interval.total_records===String(data.total_records),'idempotency_conflict');await this.owner.queueAuthorization(view,jobId,now);return this.#intervalView(view,interval);}
      const checked=await this.#intervalGuard(view,jobId,id);interval=checked.interval;await this.#guard(view,jobId,data,now);
      if(interval.total_pages!==null&&(interval.total_pages!==String(data.total_pages)||interval.total_records!==String(data.total_records)))return this.#fail(view,interval,'history_incomplete',now);
      // Page numbers are unique and constrained to 1..total_pages; each page and
      // its exact immutable captured-record set commit together. Count equality
      // proves the same complete sequence without loading all raw page bodies.
      if(interval.total_pages!==String(data.total_pages)||interval.total_records!==String(data.total_records)||await view.count('capture_pages',[text(id)])!==data.total_pages)throw new CaptureError('history_incomplete',true);
      if(await view.count('captured_records',[text(id)])!==data.total_records)return this.#fail(view,interval,'history_incomplete',now);
      interval={...interval,state:'complete'};await view.replace('capture_intervals',[text(id)],interval);
      await view.insert('coverage',{account_id:interval.account_id,start_date:interval.start_date,end_date:interval.end_date,interval_id:id});
      for(const obligation of await view.related('reimport_ranges',['account_id'],[text(interval.account_id)]))if(obligation.settings_version===checked.account.settings_version){
        const remaining=subtractRange(JSON.parse(obligation.remaining_json) as DayRange[],interval.start_date,interval.end_date);
        await view.replace('reimport_ranges',[text(obligation.id)],{...obligation,remaining_json:canonicalDto(remaining)});
      }
      const ranges=(await view.rows('coverage',[text(interval.account_id)])).map(row=>[row.start_date,row.end_date] as DayRange);
      const end=checked.account.import_start?frontier(checked.account.import_start,ranges):null;
      await view.replace('bank_accounts',[text(checked.account.id)],{...checked.account,last_complete_end:end});await refreshJob(view,jobId);await this.owner.queueAuthorization(view,jobId,now);return this.#intervalView(view,interval);
    });
  }
  async pause(id:string,input:unknown,now:string){
    id=uuid(id);const data=statusCommand(input);int64(now);
    return this.owner.command(async view=>{
      const job=await this.#guard(view,id,data,now),state=data.code==='bank_login_required'?data.state:'failed';
      for(const interval of await view.related('capture_intervals',['job_id'],[text(id)]))if(ACTIVE.includes(interval.state))await view.replace('capture_intervals',[text(interval.id)],{...interval,state});
      await view.replace('capture_jobs',[text(id)],{...job,worker_id:null,lease_expires_at:null});await addError(view,id,null,data.code,now,state==='paused');await refreshJob(view,id);return this.#jobView(view,id,now);
    });
  }
  async stop(id:string,now:string){
    id=uuid(id);int64(now);return this.owner.command(async view=>{
      await stopJob(view,id,now);return this.#jobView(view,id,now);
    });
  }
  close(){this.owner.close();}
}
