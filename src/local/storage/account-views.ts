/** Stable local views retain exact internal settings versions. */
import type {RowByTable} from './schema.generated.js';
import type {RepositorySession} from './kernel.js';
import {get,text} from './capture-policy.js';
export function accountView(row:RowByTable['bank_accounts'],discovered?:RowByTable['connection_discovery']){
  const {id,source_key,label,masked_number,currency,scale,supported,unsupported_reason,settings_version,selection,zenmoney_account_id,import_start,last_complete_end}=row;
  return {id,source_key,label:discovered?.label??label,masked_number:discovered?.masked_number??masked_number,currency,scale:Number(scale),
    supported:(discovered?.supported??supported)==='1',unsupported_reason:discovered?discovered.unsupported_reason:unsupported_reason,
    settings_version,selection,zenmoney_account_id,import_start,last_complete_end};
}
export async function connectionView(view:RepositorySession,id:string){
  const row=await get(view,'connections',id),accounts=[];
  for(const found of await view.rows('connection_discovery',[text(id)]))if(found.present==='1')accounts.push(accountView(await get(view,'bank_accounts',found.account_id),found));
  const label=await view.get('connection_labels',[text(id)]),bank=({bidv:'BIDV',vietinbank:'VietinBank'} as Record<string,string>)[row.bank]??row.bank;
  return {id:row.id,bank:row.bank,accounts_complete:row.accounts_complete==='1',accounts,profile_key:row.profile_key,profile_identity:row.profile_identity,label:label?.label??bank+' '+id.slice(0,6)};
}
