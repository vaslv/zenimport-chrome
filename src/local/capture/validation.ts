/** Local equivalents of the frozen wire-v1 validators; no dynamic evaluation. */
import type {Capabilities,DiscoverConnection,AccountSettings} from '../../application/dto.generated.js';
import {calendarDate} from '../../domain/dates.js';
import {CaptureError,requireCapture} from './errors.js';
import {int64} from '../storage/types.js';
export function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
  requireCapture(value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
  const fields=Object.getOwnPropertyDescriptors(value);requireCapture(Object.getOwnPropertySymbols(value).length===0&&Object.entries(fields).every(([key,field])=>keys.includes(key)&&'value'in field));
  return value as Record<string,unknown>;
}
export function text(value:unknown,min=1,max=240):string{
  requireCapture(typeof value==='string'&&value.length<=max*2);const chars=[...value];
  requireCapture(chars.length>=min&&chars.length<=max&&chars.every(char=>{const n=char.codePointAt(0)!;return n<0xd800||n>0xdfff;}));return value;
}
export function counter(value:unknown):number{requireCapture(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0);return value;}
export function name(value:unknown){
  const label=text(value,1,120).replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,'');
  requireCapture(label.length>0&&[...label].every(char=>char.codePointAt(0)!>=32));return label;
}
function day(value:unknown){try{return calendarDate(text(value,10,10));}catch{throw new CaptureError('validation_error');}}
export function capabilities(input:unknown):Capabilities{
  const value=object(input,['timezone','currencies','max_window_days','earliest_date','details']);
  requireCapture(value.timezone==='Asia/Ho_Chi_Minh');requireCapture(Array.isArray(value.currencies)&&value.currencies.length>=1&&value.currencies.length<=100);
  const currencies=value.currencies.map(currency=>{const c=text(currency,3,12);requireCapture(/^[A-Z]{3,12}$/.test(c));return c;});
  const days=counter(value.max_window_days);requireCapture(days>=1&&days<=366);
  requireCapture(['included','separate','unavailable'].includes(value.details as string));
  const earliest=value.earliest_date==null?null:day(value.earliest_date);
  return {timezone:'Asia/Ho_Chi_Minh',currencies,max_window_days:days,earliest_date:earliest,details:value.details as Capabilities['details']};
}
export function discovery(input:unknown):DiscoverConnection{
  const value=object(input,['bank','connector_version','profile_key','profile_identity','capabilities','accounts_complete','accounts','label']);
  const bank=text(value.bank,1,40);requireCapture(['bidv','vietinbank'].includes(bank),'unsupported_bank');
  const caps=capabilities(value.capabilities);requireCapture(caps.details!=='unavailable');
  requireCapture(bank!=='bidv'||caps.currencies.length===1&&caps.currencies[0]==='VND'&&caps.details==='included'&&caps.max_window_days<=30);
  requireCapture(typeof value.accounts_complete==='boolean'&&Array.isArray(value.accounts)&&value.accounts.length<=200);
  requireCapture(value.profile_identity==='bank'||value.profile_identity==='user_selected');const identities=new Set<string>();
  const accounts=value.accounts.map(input=>{
    const row=object(input,['source_key','identity_scope','label','masked_number','currency','scale','supported','unsupported_reason']);
    const source_key=text(row.source_key),currency=text(row.currency,3,12),scale=counter(row.scale);
    requireCapture(/^[A-Z]{3,12}$/.test(currency)&&scale<=12&&['bank','profile'].includes(row.identity_scope as string)&&typeof row.supported==='boolean');
    const identity_scope=row.identity_scope as 'bank'|'profile',key=JSON.stringify([identity_scope,source_key,currency]);requireCapture(!identities.has(key));identities.add(key);
    const reason=row.unsupported_reason==null?null:text(row.unsupported_reason,0,2000);requireCapture(row.supported||!!reason);
    if(row.supported)requireCapture(caps.currencies.includes(currency)&&({VND:0,USD:2,EUR:2} as Record<string,number>)[currency]===scale&&(bank!=='bidv'||currency==='VND'&&scale===0),'unsupported_currency');
    return {source_key,identity_scope,currency,scale,supported:row.supported,label:text(row.label,0,2000),masked_number:text(row.masked_number,0,120),unsupported_reason:reason};
  });
  const version=text(value.connector_version,1,40);requireCapture(version!=='legacy-v12');
  return {bank,connector_version:version,profile_key:text(value.profile_key),profile_identity:value.profile_identity,
    capabilities:caps,accounts_complete:value.accounts_complete,accounts,label:value.label==null?null:name(value.label)};
}
export type LocalSettings=Omit<AccountSettings,'expected_version'>&{expected_version:string};
export function settings(input:unknown):LocalSettings{
  const value=object(input,['expected_version','selection','zenmoney_account_id','import_start']);
  let version:string;try{version=int64(typeof value.expected_version==='string'?value.expected_version:String(counter(value.expected_version)));}catch{throw new CaptureError('validation_error');}
  requireCapture(BigInt(version)>=0n&&['enabled','ignored','unconfigured'].includes(value.selection as string));
  const target=value.zenmoney_account_id==null?null:text(value.zenmoney_account_id),start=value.import_start==null?null:day(value.import_start);
  requireCapture(value.selection==='enabled'?target!==null&&start!==null:target===null);
  return {expected_version:version,selection:value.selection as AccountSettings['selection'],zenmoney_account_id:target,import_start:start};
}
