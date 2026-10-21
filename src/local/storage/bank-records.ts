/** Canonical bank identity and append-only observations within an owned page. */
import type {RepositorySession} from './kernel.js';
import type {BankRecordValue} from '../../domain/bank-record.js';
import {localDay} from '../../domain/dates.js';
import {int64} from './types.js';
import {requireCapture} from '../capture/errors.js';
import {text,get} from './capture-policy.js';
import type {RowByTable} from './schema.generated.js';
const detailFields={
  vietinbank:new Set('currency remark amount balance trxId processDate dorC refType refId tellerId corresponsiveAccount corresponsiveName channel serviceBranchId serviceBranchName pmtType sendingBankId sendingBranchId sendingBranchName receivingBankId receivingBranchId receivingBranchName'.split(' ')),
  bidv:new Set('transactionDate referenceNumber transactionRemark transactionAmount balance'.split(' ')),
};
export function validateRecord(record:BankRecordValue,account:RowByTable['bank_accounts'],timezone:string,start:string,end:string,parser:string){
  requireCapture(record.identity_version!=='legacy-v12'&&parser!=='legacy-v12');
  requireCapture(record.currency===account.currency&&(record.amount.split('.')[1]?.length??0)<=Number(account.scale),'unsupported_currency');
  requireCapture(record.local_date>=start&&record.local_date<=end&&localDay(record.occurred_at,timezone)===record.local_date,'capture_context_changed');
  const allowed=detailFields[account.bank as keyof typeof detailFields];
  requireCapture(allowed&&record.details_state==='complete'&&Object.keys(record.details).every(key=>allowed.has(key)));
  requireCapture(record.balance===null||(record.balance.split('.')[1]?.length??0)<=Number(account.scale),'unsupported_currency');
}
export async function knownBank(view:RepositorySession,accountId:string,externalId:string){
  const alias=await view.get('bank_aliases',[text(accountId),text(externalId)]);
  if(alias)return get(view,'bank_transactions',alias.bank_id);
  return view.find('bank_transactions',['account_id','external_id'],[text(accountId),text(externalId)]);
}
export async function saveRecord(view:RepositorySession,accountId:string,record:BankRecordValue,parser:string,now:string){
  requireCapture(record.identity_version!=='legacy-v12'&&parser!=='legacy-v12');
  const existing=await knownBank(view,accountId,record.external_id),raw=JSON.stringify(record);
  if(existing?.raw_json===raw)return {id:existing.id,revision:existing.revision};
  const id=existing?.id??crypto.randomUUID(),revision=int64(String(BigInt(existing?.revision??'0')+1n));
  const row={id,account_id:accountId,external_id:existing?.external_id??record.external_id,identity_kind:record.identity_kind,identity_version:record.identity_version,
    local_date:record.local_date,occurred_at:record.occurred_at.replace(/Z$/,'+00:00'),direction:record.direction,amount:record.amount,currency:record.currency,
    description:record.description,beneficiary_account:record.beneficiary_account,beneficiary_name:record.beneficiary_name,raw_json:raw,revision};
  if(existing)await view.replace('bank_transactions',[text(id)],row);else{
    await view.insert('bank_transactions',row);await view.insert('bank_processing',{bank_id:id,state:'pending',reason:'new_bank_record',updated_at:int64(now)});
  }
  await view.insert('bank_versions',{bank_id:id,revision,data_json:raw,raw_json:raw,observed_at:int64(now),parser_version:parser});
  const alias=await view.get('bank_aliases',[text(accountId),text(record.external_id)]);requireCapture(alias===null||alias.bank_id===id,'history_incomplete');
  if(alias===null)await view.insert('bank_aliases',{account_id:accountId,external_id:record.external_id,identity_version:record.identity_version,bank_id:id});
  return {id,revision};
}
