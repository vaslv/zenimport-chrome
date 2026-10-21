/** Read-only comparison of current mobile movements and proved bank versions. */
import {calendarDate,localDay} from '../../domain/dates.js';
import {shiftDays,mergeRanges} from '../../domain/periods.js';
import {ExactMoney} from '../../domain/money.js';
import {unmatchedSides} from '../../domain/reconciliation/subsets.js';
import {signedBank,compareText} from '../../domain/reconciliation/matching.js';
import type {RemoteMovement} from '../../domain/reconciliation/matching.js';
import {revisionKey} from '../../domain/reconciliation/ownership.js';
import {CaptureError,requireCapture} from '../capture/errors.js';
import {requireStorage,int64} from '../storage/types.js';
import {scalarText} from '../portable/json-values.js';
import {sourceFresh} from '../reconciliation/freshness.js';
import type {SourceSnapshot} from '../reconciliation/source.js';
import type {Facts,BankFact} from '../reconciliation/facts.js';
export interface ReportOperation{id:string;amount:string;payee:string;comment:string;categories:string[];created:string|null}
export interface ReportDay{date:string;account_id:string;bank_total:string;zenmoney_total:string;difference:string;operations:ReportOperation[];bank_operations:ReportOperation[]}
export interface ReportAccount{id:string;title:string;currency:string;zenmoney_title:string;status:string;checked_days:number;unchecked_days:number}
export interface DiscrepancyReport{connection_id:string;bank:string;from_date:string;to_date:string;refreshed_at:string;accounts:ReportAccount[];days:ReportDay[]}
export interface ReportRequest{connection_id:string;from_date?:string;to_date?:string;account_id?:string}
const zero=()=>ExactMoney.parse('0');
const text=(value:unknown)=>{requireStorage(value==null||typeof value==='string','storage_corrupt');return value??'';};
function signed(tx:RemoteMovement,target:string){
  return (tx.incomeAccount===target?ExactMoney.parse(tx.income??'0'):zero()).subtract(tx.outcomeAccount===target?ExactMoney.parse(tx.outcome??'0'):zero());
}
const created=(tx:RemoteMovement)=>BigInt(tx.created??'0');
const timeCompare=(a:RemoteMovement,b:RemoteMovement)=>created(a)<created(b)?-1:created(a)>created(b)?1:compareText(a.id,b.id);
export function buildReport(source:SourceSnapshot,facts:Facts,request:ReportRequest,now:string):DiscrepancyReport{
  int64(now);const rows=source.rows,connection=rows.connections.find(row=>row.id===request.connection_id);requireCapture(connection,'not_found');
  requireCapture(connection.timezone!==null,'capture_context_changed');
  const today=localDay(new Date(Number(now)*1000).toISOString(),connection.timezone),discovery=new Map(rows.connection_discovery.filter(row=>row.connection_id===connection.id&&row.present==='1').map(row=>[row.account_id,row]));
  let selected=rows.bank_accounts.filter(row=>discovery.get(row.id)?.supported==='1'&&row.selection==='enabled');
  if(request.account_id!==undefined){requireCapture(selected.some(row=>row.id===request.account_id),'not_found');selected=selected.filter(row=>row.id===request.account_id);}
  const end=calendarDate(request.to_date??today),start=calendarDate(request.from_date??selected.map(row=>row.import_start!).sort(compareText)[0]??end);
  requireCapture(start<=end&&end<=today&&Number(new Date(end+'T12:00Z'))-Number(new Date(start+'T12:00Z'))<=3660*86400000);
  if(!sourceFresh(source,now))throw new CaptureError('zenmoney_unavailable',true);
  const state=rows.zen_mirror_state[0],result:DiscrepancyReport={connection_id:connection.id,bank:connection.bank,from_date:start,to_date:end,
    refreshed_at:new Date(Number(state.refreshed_at)*1000).toISOString(),accounts:[],days:[]};
  const targets=new Map<string|null,Set<string>>();for(const a of rows.bank_accounts)if(a.selection==='enabled'){
    const set=targets.get(a.zenmoney_account_id)??new Set<string>();set.add(a.id);targets.set(a.zenmoney_account_id,set);
  }
  const completed=new Set(rows.capture_intervals.filter(row=>row.state==='complete').map(row=>row.id)),versions=new Map<string,string>();
  for(const record of rows.captured_records)if(completed.has(record.interval_id)&&BigInt(record.revision)>BigInt(versions.get(record.bank_id)??'0'))versions.set(record.bank_id,record.revision);
  const banksByAccount=new Map<string,BankFact[]>();for(const [id,revision]of [...versions].sort(([a],[b])=>compareText(a,b))){
    const bank=facts.revisions.get(revisionKey(id,revision));requireStorage(bank,'storage_corrupt');
    const bucket=banksByAccount.get(bank.account_id)??[];bucket.push(bank);banksByAccount.set(bank.account_id,bucket);
  }
  const edges=new Map<string,Set<string>>();function edge(bank:string,zen:string){const set=edges.get(bank)??new Set<string>();set.add(zen);edges.set(bank,set);}
  for(const row of [...rows.processing_receipts,...rows.deliveries])edge(row.bank_id,row.zen_id);
  // Share a group's membership set instead of expanding bank×ZenMoney pairs.
  const groupZens=new Map<string,Set<string>>();for(const row of rows.link_zen_members){const set=groupZens.get(row.group_id)??new Set<string>();set.add(row.zen_id);groupZens.set(row.group_id,set);}
  const bankGroups=new Map(rows.link_bank_members.map(row=>[row.bank_id,row.group_id]));
  const remoteByTarget=new Map<string,RemoteMovement[]>();for(const tx of [...facts.transactions.values()].sort(timeCompare))if(!tx.hold)for(const target of new Set([tx.incomeAccount,tx.outcomeAccount]))if(target!=null){
    const bucket=remoteByTarget.get(target)??[];bucket.push(tx);remoteByTarget.set(target,bucket);
  }
  const coverageByAccount=new Map<string,(readonly [string,string])[]>();for(const row of rows.coverage){const list=coverageByAccount.get(row.account_id)??[];list.push([row.start_date,row.end_date]);coverageByAccount.set(row.account_id,list);}
  const remoteAccounts=facts.entities.get('account')??new Map();
  for(const account of selected){
    const target=account.zenmoney_account_id!,remoteAccount=remoteAccounts.get(target),instrument=remoteAccount?.instrument;
    const info:ReportAccount={id:account.id,title:discovery.get(account.id)!.label,currency:account.currency,zenmoney_title:text(remoteAccount?.title),status:'ready',checked_days:0,unchecked_days:0};result.accounts.push(info);
    if((targets.get(target)?.size??0)>1)info.status='shared_target';
    else if(!remoteAccount||facts.instruments.get(scalarText(instrument,'invalid_instrument'))!==account.currency)info.status='account_unavailable';
    const eligible=new Set<string>(),coverage=mergeRanges(coverageByAccount.get(account.id)??[]);let index=0;
    for(let day=start;day<=end;){
      while(index<coverage.length&&coverage[index][1]<day)index++;
      if(info.status==='ready'&&day>=account.import_start!&&index<coverage.length&&coverage[index][0]<=day)eligible.add(day);
      if(day===end)break;day=shiftDays(day,1);
    }
    info.checked_days=eligible.size;info.unchecked_days=Math.round((Number(new Date(end+'T12:00Z'))-Number(new Date(start+'T12:00Z')))/86400000)+1-eligible.size;
    if(info.status!=='ready')continue;
    const days=new Map<string,{banks:BankFact[];zens:Map<string,ExactMoney>}>();
    const bucket=(day:string)=>{let value=days.get(day);if(!value){value={banks:[],zens:new Map()};days.set(day,value);}return value;};
    for(const bank of banksByAccount.get(account.id)??[])if(eligible.has(bank.local_date))bucket(bank.local_date).banks.push(bank);
    const remote=new Map((remoteByTarget.get(target)??[]).map(tx=>[tx.id,tx]));
    for(const tx of remote.values()){
      if(tx.date===undefined||!eligible.has(tx.date))continue;const amount=signed(tx,target);if(!amount.sign())continue;
      // The read-only Python report resolves currency by scalar display; matching
      // separately requires correct numeric API types before adopting a UUID.
      const raw=facts.entities.get('transaction')!.get(tx.id)!,instrument=raw[amount.sign()>0?'incomeInstrument':'outcomeInstrument'];
      if(instrument==null||facts.instruments.get(scalarText(instrument,'invalid_instrument'))!==account.currency){info.status='unsupported_movement';continue;}
      bucket(tx.date).zens.set(tx.id,amount);
    }
    for(const [day,{banks,zens}]of days){
      const values=banks.map(signedBank),total=ExactMoney.sum(values),zenTotal=ExactMoney.sum(zens.values()),preferred=new Map(banks.map((bank,index)=>[index,{has:(id:string)=>edges.get(bank.id)?.has(id)===true||groupZens.get(bankGroups.get(bank.id)??'')?.has(id)===true}]));
      const {missing,extras}=unmatchedSides(values,zens,preferred);if(!missing.size&&!extras.size)continue;
      result.days.push({date:day,account_id:account.id,bank_total:total.toString(),zenmoney_total:zenTotal.toString(),difference:zenTotal.subtract(total).toString(),
        bank_operations:[...missing].sort((a,b)=>a-b).map(i=>({id:banks[i].id,amount:values[i].toString(),payee:'',comment:banks[i].description||'',categories:[],created:null})),
        operations:[...extras].sort((a,b)=>{const x=remote.get(a)!,y=remote.get(b)!;return created(x)>created(y)?-1:created(x)<created(y)?1:compareText(a,b);}).map(id=>{
          const tx=remote.get(id)!,raw=facts.entities.get('transaction')!.get(id)!,tags=facts.reviewed.get(id)!.tags;
          return {id,amount:zens.get(id)!.toString(),payee:text(raw.payee),comment:tx.comment||'',categories:tags.map(id=>facts.tags.get(id)?.title??''),created:tx.created??null};
        })});
    }
  }
  result.days.sort((a,b)=>compareText(b.date,a.date)||compareText(b.account_id,a.account_id));return result;
}
