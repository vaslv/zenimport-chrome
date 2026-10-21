import {DeliveryAuthorizationRepository} from './delivery-authorization-repository.js';
/** Private native fixture. Synthetic responses only; never bundled in product. */
import {LocalDatabase} from './bootstrap.js';
import {FinancialDatabase} from './database.js';
import type {FinancialEnvelope} from './database.js';
import {unpackRow,packRow,encodeKey} from './cells.js';
import {SCHEMA} from './schema.generated.js';
import type {TableName,RowByTable} from './schema.generated.js';
import {envelope} from './envelope.js';
import {int64} from './types.js';
import {MirrorRepository} from './mirror-repository.js';
import {trustedSentinel} from '../../control/sentinel.js';
import type {StorageArea} from '../../application/state.js';
import {LocalCredentials} from '../zenmoney/credentials.js';
import {mirrorReader} from '../zenmoney/reader.js';
import {LocalMirror} from '../zenmoney/mirror.js';
import {LocalCatalog} from '../zenmoney/catalog.js';
import type {MirrorLease} from './mirror-repository.js';
import type {RuntimeControl} from '../../control/types.js';
import {mirrorScope,isMirrorTable} from './mirror-scope.js';
import {MigrationOwner} from './migration-owner.js';
import {writeTransaction,writeMirrorTransaction} from './kernel.js';
import {AccountRepository} from './account-repository.js';
import {CategoryRepository} from './category-repository.js';
import {ReconciliationRepository} from './reconciliation-repository.js';
import type {ReconcileChoice} from '../reconciliation/plan.js';
import {ReportRepository} from './report-repository.js';
import type {ReportRequest} from '../reports/build.js';
import {readSource} from '../reconciliation/source.js';
import {sourceFacts} from '../reconciliation/facts.js';
import {RepositoryOwner} from './repository-owner.js';
import type {FinancialSnapshot} from './repository-owner.js';
import {CaptureRepository} from './capture-repository.js';
let releaseCategories:(()=>void)|undefined;
export const resumeCategories=()=>{releaseCategories?.();releaseCategories=undefined;};
let paused=false,releaseKnown:(()=>void)|undefined;
export const resumeKnown=()=>{releaseKnown?.();releaseKnown=undefined;};
export const checkpoint=()=>paused;
let networkSerial=0,releaseRead:(()=>void)|undefined;
export const networkCount=()=>networkSerial;
export const releaseNetwork=()=>{releaseRead?.();releaseRead=undefined;};

const native=()=> (globalThis as unknown as {chrome:{storage:{local:StorageArea;session:StorageArea}}}).chrome.storage;
function area(name:string,session=false):StorageArea{
  const prefix='l6:'+name+':',source=native()[session?'session':'local'];return {
    setAccessLevel:value=>source.setAccessLevel(value),
    async get(keys){const list=typeof keys==='string'?[keys]:keys,values=await source.get(list===null?null:list.map(key=>prefix+key));return Object.fromEntries(Object.entries(values).filter(([key])=>key.startsWith(prefix)).map(([key,value])=>[key.slice(prefix.length),value]));},
    set:values=>source.set(Object.fromEntries(Object.entries(values).map(([key,value])=>[prefix+key,value]))),
    remove:keys=>source.remove((typeof keys==='string'?[keys]:keys).map(key=>prefix+key)),
  };
}
export async function run(action:string,args:{name:string;now?:number;raw?:string;token?:string;status?:number;permission?:boolean;lease?:MirrorLease;root?:RuntimeControl;force?:boolean;quota?:boolean;delay?:number;summary?:boolean;mode?:string;size?:number;data?:unknown;id?:string;accountId?:string;label?:string;version?:string;intervalId?:string;number?:number}){
  const storage=area(args.name),sentinel=trustedSentinel(storage),now=args.now??1000;let store:MirrorRepository|undefined,calls=0,maxTransactionMs=0;
  const nativeTransaction=IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction=function(...values:Parameters<IDBDatabase['transaction']>){
    const start=performance.now(),tx=nativeTransaction.apply(this,values);
    const finished=()=>{maxTransactionMs=Math.max(maxTransactionMs,performance.now()-start);};
    tx.addEventListener('complete',finished,{once:true});tx.addEventListener('abort',finished,{once:true});return tx;
  };
  try{
    if(action==='init'){const db=await LocalDatabase.open(args.name,sentinel,String(now));db.close();}
    store=await MirrorRepository.open(args.name,sentinel,()=>now);
    const reader=mirrorReader({clock:()=>now,permission:async()=>args.permission!==false,fetch:async(_,options)=>{
      calls++;const body=JSON.parse(String(options?.body));if(body.transaction||body.deletion)throw Error('fixture_write_forbidden');
      networkSerial++;
      if(args.mode==='pause-network')await new Promise<void>(resolve=>{releaseRead=resolve;});
      if(args.delay)await new Promise(resolve=>setTimeout(resolve,args.delay));
      return new Response(args.raw??'{"serverTimestamp":100,"user":[{"id":1}],"instrument":[{"id":2,"shortTitle":"VND"}],"account":[{"id":"a","title":"Fixture","type":"checking","instrument":2}],"tag":[],"transaction":[]}',{status:args.status??200});
    }}),credentials=new LocalCredentials(storage,area(args.name,true),store,reader,()=>now),mirror=new LocalMirror(store,credentials,reader,()=>now);
    let result:unknown;
    if(action==='authorize-job'){
      const {root}=await store.context(),repository=await DeliveryAuthorizationRepository.open(args.name,sentinel,{installationId:root.installationId,generation:root.activeGeneration!,epoch:root.epoch});
      try{result=await repository.authorize(args.id!,String(now));}finally{repository.close();}
    }
    if(action==='authorization-state'){
      const {root}=await store.context(),owner=await RepositoryOwner.open(args.name,sentinel,{installationId:root.installationId,generation:root.activeGeneration!,epoch:root.epoch});
      try{result=await owner.read(async view=>({authorizations:await view.rows('delivery_authorizations'),schedule:await view.rows('delivery_schedule')}));}finally{owner.close();}
    }
    if(action==='categories-build'){
      const {root}=await store.context(),repository=await CategoryRepository.open(args.name,sentinel,{installationId:root.installationId,generation:root.activeGeneration!,epoch:root.epoch});
      const add=IDBObjectStore.prototype.add,put=IDBObjectStore.prototype.put,native=FinancialDatabase.prototype.transaction;let wrotePrediction=false,armed=true;
      const intercept=function(store:IDBObjectStore){if(store.name==='f_category_predictions'){wrotePrediction=true;if(armed&&args.mode==='quota-category'){armed=false;throw new DOMException('private-category-fixture','QuotaExceededError');}}};
      if(['quota-category','pause-category'].includes(args.mode??'')){
        IDBObjectStore.prototype.add=function(...values:Parameters<IDBObjectStore['add']>){intercept(this);return add.apply(this,values);};
        IDBObjectStore.prototype.put=function(...values:Parameters<IDBObjectStore['put']>){intercept(this);return put.apply(this,values);};
      }
      if(args.mode==='pause-category')FinancialDatabase.prototype.transaction=new Proxy(native,{apply(target,db,parameters){return (Reflect.apply(target,db,parameters) as Promise<unknown>).then(value=>{if(wrotePrediction&&!paused){paused=true;return new Promise(resolve=>{releaseCategories=()=>resolve(value);});}return value;});}});
      try{result=await repository.build(String(now));}finally{repository.close();IDBObjectStore.prototype.add=add;IDBObjectStore.prototype.put=put;FinancialDatabase.prototype.transaction=native;}
    }
    if(action==='categories-state'){
      const {root}=await store.context(),owner=await RepositoryOwner.open(args.name,sentinel,{installationId:root.installationId,generation:root.activeGeneration!,epoch:root.epoch});
      try{const stamp=await owner.snapshot();result={ready:await owner.categoriesReady(stamp),stamp,...await owner.read(async view=>({evidence:await view.rows('category_evidence'),payments:await view.rows('category_payments'),predictions:await view.rows('category_predictions')}))};}finally{owner.close();}
    }
    if(action==='seed-reconcile-group'){
      const {root}=await store.context(),owner=await RepositoryOwner.open(args.name,sentinel,{installationId:root.installationId,generation:root.activeGeneration!,epoch:root.epoch});
      try{await owner.write(async view=>{
        const bank=(await view.get('bank_transactions',[['text',args.id!]]))!,id=crypto.randomUUID();
        await view.insert('link_groups',{id,kind:'split',account_id:bank.account_id,created_at:int64(String(now)),origin:'manual'});
        await view.insert('link_bank_members',{group_id:id,bank_id:bank.id});
        for(let i=0;i<args.size!;i++)await view.insert('link_zen_members',{group_id:id,zen_id:'known-'+i});
        const state=(await view.get('bank_processing',[['text',bank.id]]))!;await view.replace('bank_processing',[['text',bank.id]],{...state,state:'delivered'});
      });result=true;}finally{owner.close();}
    }
    if(action==='seed-reconcile-intent'){
      const {root}=await store.context(),owner=await RepositoryOwner.open(args.name,sentinel,{installationId:root.installationId,generation:root.activeGeneration!,epoch:root.epoch});
      try{await owner.write(async view=>{
        const bank=await view.get('bank_transactions',[['text',args.id!]]);if(!bank)throw Error('fixture_bank');
        await view.insert('deliveries',{bank_id:bank.id,zen_id:args.label??'known-intent',payload:JSON.stringify({id:args.label??'known-intent',incomeAccount:'a',outcomeAccount:'a'}),state:'prepared',ever_attempted:int64('0'),origin:'created',authorized_job_id:null,updated_at:int64(String(now)),needs_rebuild:int64(args.mode==='needs-rebuild'?'1':'0')});
        const state=(await view.get('bank_processing',[['text',bank.id]]))!;await view.replace('bank_processing',[['text',bank.id]],{...state,state:'prepared'});
      });result=true;}finally{owner.close();}
    }
    if(action==='reconcile-run'){
      const {root}=await store.context(),repository=await ReconciliationRepository.open(args.name,sentinel,{installationId:root.installationId,generation:root.activeGeneration!,epoch:root.epoch});
      const add=IDBObjectStore.prototype.add,native=FinancialDatabase.prototype.transaction;let armed=true,wroteReceipt=false;
      if(['quota-reconcile','pause-known'].includes(args.mode??''))IDBObjectStore.prototype.add=function(...values:Parameters<IDBObjectStore['add']>){if(this.name==='f_processing_receipts'){wroteReceipt=true;if(armed&&args.mode==='quota-reconcile'){armed=false;throw new DOMException('private-reconciliation-fixture','QuotaExceededError');}}return add.apply(this,values);};
      if(args.mode==='pause-known')FinancialDatabase.prototype.transaction=new Proxy(native,{apply(target,db,parameters){return (Reflect.apply(target,db,parameters) as Promise<unknown>).then(value=>{if(wroteReceipt&&!paused){paused=true;return new Promise(resolve=>{releaseKnown=()=>resolve(value);});}return value;});}});
      try{result=await repository.run(args.data as ReconcileChoice[],String(now));}finally{repository.close();IDBObjectStore.prototype.add=add;FinancialDatabase.prototype.transaction=native;}
    }
    if(action==='reconcile-state'){
      const {root}=await store.context(),owner=await RepositoryOwner.open(args.name,sentinel,{installationId:root.installationId,generation:root.activeGeneration!,epoch:root.epoch});
      try{result=await owner.read(async view=>({receipts:await view.rows('processing_receipts'),targets:await view.rows('processing_targets'),groups:await view.rows('link_groups'),banks:await view.rows('link_bank_members'),zens:await view.rows('link_zen_members'),processing:await view.rows('bank_processing')}));}finally{owner.close();}
    }
    if(action==='report-build'){
      const {root}=await store.context(),reports=await ReportRepository.open(args.name,sentinel,{installationId:root.installationId,generation:root.activeGeneration!,epoch:root.epoch});
      try{result=await reports.build(args.data as ReportRequest,String(now));}finally{reports.close();}
    }
    if(action==='source-facts'){
      const {root}=await store.context(),owner=await RepositoryOwner.open(args.name,sentinel,{installationId:root.installationId,generation:root.activeGeneration!,epoch:root.epoch});
      try{const source=await readSource(owner),facts=sourceFacts(source);result={stamp:source.stamp,banks:[...facts.banks],revisions:[...facts.revisions],transactions:[...facts.transactions],blockingTransactions:[...facts.blockingTransactions],reviewed:[...facts.reviewed],tags:[...facts.tags],instruments:[...facts.instruments]};}finally{owner.close();}
    }
    if(action.startsWith('snapshot-')){
      const {root}=await store.context(),owner=await RepositoryOwner.open(args.name,sentinel,{installationId:root.installationId,generation:root.activeGeneration!,epoch:root.epoch});
      const input=args.data as {stamp:FinancialSnapshot;table:TableName;after?:string|null};const put=IDBObjectStore.prototype.put;let armed=true;
      if(args.mode==='quota-snapshot')IDBObjectStore.prototype.put=function(...values:Parameters<IDBObjectStore['put']>){if(armed&&this.name==='f_bank_accounts'){armed=false;throw new DOMException('private-snapshot-fixture','QuotaExceededError');}return put.apply(this,values);};
      try{
        if(action==='snapshot-begin')result=await owner.snapshot();
        else if(action==='snapshot-scan')result=await owner.scan(input.table,input.stamp,input.after??null);
        else if(action==='snapshot-check'){await owner.check(input.stamp);result=true;}
        else if(action==='snapshot-write')result=await owner.apply(input.stamp,async view=>{
          const row=await view.get('bank_accounts',[['text',args.id!]]);if(!row)throw Error('fixture_account');
          await view.replace('bank_accounts',[['text',args.id!]],{...row,label:args.label??row.label});return true;
        });
        else if(action==='snapshot-cache')result=await owner.apply(input.stamp,async view=>{
          const bank=await view.get('bank_transactions',[['text',args.id!]]),state=await view.get('zen_mirror_state',[['integer',int64('1')]]);if(!bank||!state)throw Error('fixture_record');
          await view.insert('category_predictions',{bank_id:bank.id,bank_revision:bank.revision,category_id:null,source:'unknown',reason:'fixture',candidates_json:'[]',mirror_generation:state.generation,updated_at:int64(String(now))});return true;
        });
      }finally{owner.close();IDBObjectStore.prototype.put=put;}
    }
    if(action.startsWith('capture-')&&action!=='capture-state'){
      const {root}=await store.context(),capture=await CaptureRepository.open(args.name,sentinel,{installationId:root.installationId,generation:root.activeGeneration!,epoch:root.epoch});
      const add=IDBObjectStore.prototype.add,put=IDBObjectStore.prototype.put;let armed=true;
      if(args.mode==='quota-capture')IDBObjectStore.prototype.add=function(...values:Parameters<IDBObjectStore['add']>){if(armed&&this.name==='f_captured_records'){armed=false;throw new DOMException('private-capture-fixture','QuotaExceededError');}return add.apply(this,values);};
      if(args.mode==='quota-complete')IDBObjectStore.prototype.put=function(...values:Parameters<IDBObjectStore['put']>){if(armed&&this.name==='f_bank_accounts'){armed=false;throw new DOMException('private-capture-fixture','QuotaExceededError');}return put.apply(this,values);};
      try{
        if(action==='capture-start')result=await capture.start(args.data,String(now));
        else if(action==='capture-get')result=await capture.get(args.id!,String(now));
        else if(action==='capture-lease')result=await capture.lease(args.id!,args.data,String(now));
        else if(action==='capture-page')result=await capture.page(args.id!,args.intervalId!,args.number!,args.data,String(now));
        else if(action==='capture-complete')result=await capture.complete(args.id!,args.intervalId!,args.data,String(now));
        else if(action==='capture-pause')result=await capture.pause(args.id!,args.data,String(now));
        else if(action==='capture-stop')result=await capture.stop(args.id!,String(now));
        if(args.mode==='lost-capture-reply'){paused=true;await new Promise(()=>{});}
      }finally{capture.close();IDBObjectStore.prototype.add=add;IDBObjectStore.prototype.put=put;}
    }
    if(action==='accounts-state'||action==='seed-account-version'){
      const db=new FinancialDatabase(args.name,false);await db.open();try{const root=(await db.runtime.get('runtime'))!,generation=root.activeGeneration!,dataset=(await db.datasets.get(generation))!;
        if(action==='seed-account-version'){
          const key=encodeKey([['text',args.id!]]),old=(await db.financial('bank_accounts').get([generation,key]))!;
          await db.financial('bank_accounts').put(envelope(generation,'bank_accounts',packRow('bank_accounts',{...unpackRow('bank_accounts',old.row),settings_version:int64(args.version!)})));
        }
        return {ok:true,result:{root,dataset,operation:dataset.holdId?(await db.applicationState.get('account-settings:'+dataset.holdId))?.value:null}};
      }finally{db.close();}
    }
    if(action.startsWith('connections-')||action.startsWith('accounts-')){
      const raw=new FinancialDatabase(args.name,false);await raw.open();const root=(await raw.runtime.get('runtime'))!;raw.close();
      const accounts=await AccountRepository.open(args.name,sentinel,{installationId:root.installationId,generation:root.activeGeneration!,epoch:root.epoch});
      const put=IDBObjectStore.prototype.put,transaction=FinancialDatabase.prototype.transaction;let advanced=false;
      if(['pause-settings','quota-settings'].includes(args.mode??'')){
        IDBObjectStore.prototype.put=function(...values:Parameters<IDBObjectStore['put']>){const row=values[0] as {scope?:string;value?:{phase?:string;after?:string|null}};
          if(this.name==='application_state'&&row.scope?.startsWith('account-settings:')&&row.value?.phase==='invalidate'&&row.value.after!=null){
            advanced=true;if(args.mode==='quota-settings')throw new DOMException('private-settings-fixture','QuotaExceededError');
          }return put.apply(this,values);
        };
        if(args.mode==='pause-settings')FinancialDatabase.prototype.transaction=new Proxy(transaction,{apply(target,db,parameters){
          return (Reflect.apply(target,db,parameters) as Promise<unknown>).then(value=>{if(advanced&&!paused){paused=true;return new Promise(()=>{});}return value;});
        }});
      }
      try{
        if(action==='connections-discover')result=await accounts.discover(args.data,String(now));
        else if(action==='connections-list')result=await accounts.list(args.id??'bidv');
        else if(action==='connections-get')result=await accounts.get(args.id!);
        else if(action==='connections-rename')result=await accounts.rename(args.id!,args.label);
        else if(action==='connections-unlink')result=await accounts.unlink(args.id!,args.accountId!,String(now));
        else if(action==='accounts-configure')result=await accounts.configure(args.id!,args.data,String(now));
        else if(action==='accounts-recover')result=await accounts.recoverSettings();
        else if(action==='accounts-concurrent')result=await Promise.allSettled([accounts.configure(args.id!,args.data,String(now)),args.mode==='recover'?accounts.recoverSettings():accounts.configure(args.id!,args.data,String(now))])
          .then(rows=>rows.map(row=>row.status==='fulfilled'?{status:'fulfilled',value:row.value}:{status:'rejected',code:(row.reason as {code?:string}).code}));
      }finally{accounts.close();IDBObjectStore.prototype.put=put;FinancialDatabase.prototype.transaction=transaction;}
    }
    if(action==='verify'){
      const original=MirrorRepository.prototype.adopt;
      if(args.mode==='pause-adopt')MirrorRepository.prototype.adopt=new Proxy(original,{apply(){paused=true;return new Promise(()=>{});}});
      try{result=await credentials.verify(args.token??'synthetic-token');}finally{MirrorRepository.prototype.adopt=original;}
    }
    if(action==='remove')await credentials.remove();
    if(action==='cleanup-credentials')await credentials.cleanupCandidates();
    if(action==='collect')result=await store.collect(String(now));
    if(action==='prediction')result=await store.prediction((await store.context()).root,args.id??'b-0',args.version??'1');
    if(action==='seed-predictions'){
      const db=new FinancialDatabase(args.name,false);await db.open();
      try{const {root}=await store.context(),generation=root.activeGeneration!,state=await db.financial('zen_mirror_state').where('generation').equals(generation).first();
        const mirrorGeneration=unpackRow('zen_mirror_state',state!.row).generation;
        function row<K extends TableName>(table:K,changes:Record<string,unknown>){
          const fields=Object.fromEntries(SCHEMA[table].columns.map(column=>[column.name,column.required?column.type==='INTEGER'?'0':'':null]));
          return envelope(generation,table,packRow(table,{...fields,...changes} as RowByTable[K]));
        }
        if(!args.accountId)await db.financial('bank_accounts').add(row('bank_accounts',{id:'pred-account',bank:'fixture',identity_scope:'bank',source_key:'primary',currency:'VND',scale:'0',supported:'1',selection:'enabled',zenmoney_account_id:'a',import_start:'2026-10-01'}));
        for(let start=0;start<(args.size??10000);start+=500){
          const banks:FinancialEnvelope[]=[],versions:FinancialEnvelope[]=[],predictions:FinancialEnvelope[]=[],deliveries:FinancialEnvelope[]=[],processing:FinancialEnvelope[]=[];
          for(let i=start;i<Math.min(start+500,args.size??10000);i++){
            const id='b-'+i;banks.push(row('bank_transactions',{id,account_id:args.accountId??'pred-account',external_id:id,identity_kind:'bank',identity_version:'v1',local_date:'2026-10-20',direction:'expense',amount:'1',currency:'VND',raw_json:'{}',revision:'1'}));
            versions.push(row('bank_versions',{bank_id:id,revision:'1',data_json:'{}',raw_json:'{}'}));
            predictions.push(row('category_predictions',{bank_id:id,bank_revision:'1',category_id:null,source:'unknown',reason:'fixture',candidates_json:'[]',mirror_generation:mirrorGeneration}));
            if(args.mode==='pending')processing.push(row('bank_processing',{bank_id:id,state:'pending',reason:'fixture',updated_at:String(now)}));
            if(args.mode==='prepared'){
              deliveries.push(row('deliveries',{bank_id:id,zen_id:crypto.randomUUID(),payload:'{}',state:'prepared',ever_attempted:'0',origin:'created',authorized_job_id:null,updated_at:String(now),needs_rebuild:'0'}));
              processing.push(row('bank_processing',{bank_id:id,state:'prepared',reason:'fixture',updated_at:String(now)}));
            }
          }
          await db.transaction('rw',db.tables,async()=>{await db.financial('bank_transactions').bulkAdd(banks);await db.financial('bank_versions').bulkAdd(versions);await db.financial('category_predictions').bulkAdd(predictions);if(deliveries.length)await db.financial('deliveries').bulkAdd(deliveries);if(processing.length)await db.financial('bank_processing').bulkAdd(processing);});
        }
      }finally{db.close();}
      if(args.mode==='published-cache'){
        // Volume-only fixture: publish the preseeded null-category rows so this
        // old mirror test measures invalidation/GC, not model-building behavior.
        const {root}=await store.context(),owner=await RepositoryOwner.open(args.name,sentinel,{installationId:root.installationId,generation:root.activeGeneration!,epoch:root.epoch});
        try{const stamp=await owner.snapshot(),id=crypto.randomUUID();await owner.beginCategories(stamp,id,{category_evidence:0,category_payments:0,category_predictions:args.size??10000});await owner.completeCategories(stamp,id);}finally{owner.close();}
      }
    }
    if(action==='seed-delivery'){
      const db=new FinancialDatabase(args.name,false);await db.open();try{const {root}=await store.context();
        await writeTransaction(db,sentinel,{installationId:root.installationId,generation:root.activeGeneration!,epoch:root.epoch},async view=>{
          await view.insert('bank_processing',{bank_id:'b-0',state:args.mode==='uncertain'?'uncertain':'pending',reason:'fixture',updated_at:String(now) as RowByTable['bank_processing']['updated_at']});
          await view.insert('deliveries',{bank_id:'b-0',zen_id:crypto.randomUUID(),payload:'{}',state:args.mode==='uncertain'?'uncertain':'prepared',ever_attempted:(['uncertain','attempted-prepared'].includes(args.mode??'')?'1':'0') as RowByTable['deliveries']['ever_attempted'],origin:'created',authorized_job_id:null,updated_at:String(now) as RowByTable['deliveries']['updated_at'],needs_rebuild:'0' as RowByTable['deliveries']['needs_rebuild']});
        });
      }finally{db.close();}
    }
    if(action==='awaiting'){
      const db=new FinancialDatabase(args.name,false);await db.open();try{const {root}=await store.context();
        const dataset=await db.datasets.get(root.activeGeneration!);await db.participants.update(dataset!.participantId,{awaitingSync:true,everActivated:true});
      }finally{db.close();}
    }
    if(action==='write-fences'){
      const db=new FinancialDatabase(args.name,false);await db.open();try{const {root}=await store.context(),fence={installationId:root.installationId,generation:root.activeGeneration!,epoch:root.epoch};
        result=await Promise.all([
          writeTransaction(db,sentinel,fence,view=>view.insert('dataset_metadata',{key:'must-not-write',value:'blocked'})).then(()=> 'unexpected',error=>(error as {code:string}).code),
          writeMirrorTransaction(db,sentinel,fence,view=>view.remove('deliveries',[['text','absent']])).then(()=> 'unexpected',error=>(error as {code:string}).code),
        ]);
      }finally{db.close();}
    }
    if(action==='inspect'){const db=await LocalDatabase.open(args.name,sentinel,String(now));try{result=await db.inspect();}finally{db.close();}}
    if(action==='draft')await credentials.saveDraft(args.token??'synthetic-draft');
    if(action==='draft-read')result=await credentials.draft();
    if(action==='claim'){const credential=await credentials.current();result={root:credential.root,lease:await store.claim(credential.root,credential.hash,String(now),true)};}
    if(action==='apply')await store.apply(args.root!,args.lease!,args.raw!,String(now));
    if(action==='refresh'||action==='concurrent'){
      const original=IDBObjectStore.prototype.put,native=FinancialDatabase.prototype.transaction;let armed=!!args.quota,stageWritten=false,published=false;
      const root=(await store.context()).root;
      if(armed||args.mode)IDBObjectStore.prototype.put=function(...values:Parameters<IDBObjectStore['put']>){
        const value=values[0] as {generation?:string;scope?:string;value?:{state?:string}};
        if(this.name==='f_zen_entities'&&value.generation!==root.activeGeneration)stageWritten=true;
        if(this.name==='application_state'&&value.scope?.startsWith('mirror-view:')&&value.value?.state==='active'){
          published=true;if(args.mode==='quota-publish')throw new DOMException('private-fixture','QuotaExceededError');
        }
        if(armed&&this.name==='f_zen_entities'){armed=false;throw new DOMException('private-fixture','QuotaExceededError');}return original.apply(this,values);
      };
      if(args.mode==='pause-stage'||args.mode==='lost-reply')FinancialDatabase.prototype.transaction=new Proxy(native,{
        apply(target,db,parameters){const result=Reflect.apply(target,db,parameters) as Promise<unknown>;
          return result.then(value=>{if(!paused&&(args.mode==='pause-stage'?stageWritten:published)){paused=true;return new Promise(()=>{});}return value;});},
      });
      try{result=action==='concurrent'?await Promise.allSettled([mirror.refresh({force:true}),mirror.refresh({force:true})]).then(rows=>rows.map(row=>row.status==='fulfilled'?'ok':(row.reason as {code:string}).code)):
        await mirror.refresh({force:args.force??true});}finally{IDBObjectStore.prototype.put=original;FinancialDatabase.prototype.transaction=native;}
    }
    if(action==='catalog')result=await new LocalCatalog(store,credentials,mirror,()=>now).get();
    if(action==='export'){
      const owner=await MigrationOwner.open(args.name,sentinel,{readPeer:async()=>{throw Error('No peer read in a source export');},verifyOwner:async()=>({ownerIds:['1'],sourceHash:'f'.repeat(64)})});
      try{const current=await owner.current(),switchId=crypto.randomUUID();
        await owner.command(current.participantId!,'source_start',{request_id:crypto.randomUUID(),switch_id:switchId,expected_epoch:'1',peer_id:crypto.randomUUID()},String(now));
        result=await owner.snapshotSource(current.participantId!,switchId,String(now));
      }finally{owner.close();}
      return {ok:true,result,calls};
    }
    const db=new FinancialDatabase(args.name,false);await db.open();
    try{
      const root=await db.runtime.get('runtime'),generation=root!.activeGeneration!,projection=await mirrorScope(db,generation);
      if(action==='capture-state'){
        const result:Record<string,unknown>={};for(const table of ['connections','bank_accounts','account_bindings','bank_transactions','bank_versions','bank_aliases','bank_processing','capture_jobs','job_accounts','job_context','job_requests','capture_intervals','capture_pages','captured_records','coverage','reimport_ranges','source_capture_leases','capture_errors'] as TableName[])
          result[table]=args.summary?await db.financial(table).where('generation').equals(generation).count():(await db.financial(table).where('generation').equals(generation).toArray()).map(row=>unpackRow(table,row.row));
        return {ok:true,result,maxTransactionMs};
      }
      if(action==='delivery-state')result=(await db.financial('deliveries').where('generation').equals(generation).toArray()).map(row=>unpackRow('deliveries',row.row));
      const tables:Record<string,unknown>={};for(const name of ['zen_mirror_state','zen_entities','zen_movements','zen_sync_runs','zen_tags','zen_tombstones','zen_deletions'] as TableName[])
        tables[name]=args.summary?await db.financial(name).where('generation').equals(isMirrorTable(name)?projection:generation).count():
          (await db.financial(name).where('generation').equals(isMirrorTable(name)?projection:generation).toArray()).map(row=>unpackRow(name,row.row));
      return {ok:true,result,root,projection,readiness:await mirror.readiness(),tables,calls,maxTransactionMs,sentinel:await sentinel.read(),
        participants:await db.participants.toArray(),predictionCount:await db.financial('category_predictions').where('generation').equals(generation).count(),
        versions:(await db.applicationState.toArray()).filter(row=>row.scope.startsWith('mirror-view:')).map(row=>({scope:row.scope,state:row.value.state})),
        credentialCount:Object.keys(await storage.get(null)).filter(key=>key.startsWith('localCredential:')).length};
    }finally{db.close();}
  }catch(error){return {ok:false,code:(error as {code?:string}).code??'fixture_failure',calls};}finally{store?.close();IDBDatabase.prototype.transaction=nativeTransaction;}
}
