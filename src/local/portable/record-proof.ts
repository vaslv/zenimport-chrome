/** Bank aliases, exact raw revisions and coverage frontier; no financial writes. */
import {bankRecord,legacyOccurred,timestampProjection} from '../../domain/bank-record.js';
import {calendarDate} from '../../domain/dates.js';
import type {GraphReader} from './relations.js';
import type {RowByTable} from '../storage/schema.generated.js';
import {LegacyFacts} from './legacy-facts.js';
import {financialObject,jsonEqual,jsonTruthy,tupleText} from './json-values.js';
import {requirePortable} from './format.js';

export interface BankFacts{
  readonly accounts:ReadonlyMap<string,RowByTable['bank_accounts']>;
  readonly banks:ReadonlyMap<string,RowByTable['bank_transactions']>;
  readonly aliases:ReadonlyMap<string,string>;
  readonly versions:ReadonlyMap<string,RowByTable['bank_versions']>;
}
export const versionKey=(bankId:string,revision:string)=>tupleText(bankId,revision);
export const aliasKey=(accountId:string,externalId:string)=>tupleText(accountId,externalId);

function shifted(day:string,delta:number):string{
  calendarDate(day);const value=new Date(day+'T00:00:00Z');value.setUTCDate(value.getUTCDate()+delta);
  return calendarDate(value.toISOString().slice(0,10));
}
function legacyOriginal(bank:RowByTable['bank_transactions'],account:RowByTable['bank_accounts'],version:RowByTable['bank_versions'],legacy:LegacyFacts){
  const original=financialObject(version.data_json,'invalid_legacy_proof');
  requirePortable(original.id===bank.id&&original.bank_account===bank.account_id,'invalid_legacy_proof');
  requirePortable(legacy.bankOriginals(bank.id).some(proof=>jsonEqual(original,{...proof,bank:account.bank,currency:account.currency})),'invalid_legacy_proof');
  return original;
}

export async function validateRecords(reader:GraphReader,legacy:LegacyFacts):Promise<BankFacts>{
  const accounts=new Map<string,RowByTable['bank_accounts']>(),banks=new Map<string,RowByTable['bank_transactions']>(),aliases=new Map<string,string>(),versions=new Map<string,RowByTable['bank_versions']>();
  const processing=new Set<string>(),revisionCounts=new Map<string,bigint>(),ranges=new Map<string,[string,string][]>();
  for await(const row of reader.rows('bank_accounts'))accounts.set(row.id,row);
  for await(const row of reader.rows('bank_processing'))processing.add(row.bank_id);
  for await(const row of reader.rows('bank_aliases'))aliases.set(aliasKey(row.account_id,row.external_id),row.bank_id);
  for await(const bank of reader.rows('bank_transactions')){
    banks.set(bank.id,bank);requirePortable(processing.has(bank.id),'missing_processing_state');
    const account=accounts.get(bank.account_id);requirePortable(account!==undefined,'invalid_relationship');
    requirePortable(bank.currency===account.currency&&(bank.amount.split('.')[1]?.length??0)<=Number(account.scale),'invalid_bank_currency');
    calendarDate(bank.local_date);
    requirePortable(aliases.get(aliasKey(bank.account_id,bank.external_id))===bank.id,'missing_bank_alias');
    if(bank.identity_version==='legacy-v12')continue;
    const raw=bankRecord(financialObject(bank.raw_json,'bank_raw_mismatch'));
    for(const field of ['identity_kind','identity_version','direction','amount','currency','description','beneficiary_account','beneficiary_name'] as const)
      requirePortable(raw[field]===bank[field],'bank_raw_mismatch');
    requirePortable(raw.local_date===bank.local_date&&bank.occurred_at!==null&&timestampProjection(raw.occurred_at).micros===timestampProjection(bank.occurred_at).micros,'bank_raw_mismatch');
    requirePortable(aliases.get(aliasKey(bank.account_id,raw.external_id))===bank.id,'missing_bank_alias');
  }
  for await(const version of reader.rows('bank_versions')){
    const bank=banks.get(version.bank_id),account=bank===undefined?undefined:accounts.get(bank.account_id);
    requirePortable(bank!==undefined&&account!==undefined,'invalid_relationship');
    requirePortable(BigInt(version.observed_at)>=0n,'invalid_revision_time');
    const revision=BigInt(version.revision);requirePortable(revision===(revisionCounts.get(bank.id)??0n)+1n,'incomplete_revision_history');
    revisionCounts.set(bank.id,revision);versions.set(versionKey(bank.id,version.revision),version);
    if(version.parser_version==='legacy-v12'){
      const original=legacyOriginal(bank,account,version,legacy);requirePortable(original.raw===version.raw_json,'invalid_legacy_proof');
    }else{
      requirePortable(version.data_json===version.raw_json,'invalid_revision_projection');
      const raw=bankRecord(financialObject(version.raw_json,'invalid_revision_projection'));
      requirePortable(aliases.get(aliasKey(bank.account_id,raw.external_id))===bank.id,'missing_bank_alias');
    }
  }
  for(const bank of banks.values()){
    const current=versions.get(versionKey(bank.id,bank.revision));
    requirePortable(current!==undefined&&current.raw_json===bank.raw_json,'invalid_current_revision');
    requirePortable(revisionCounts.get(bank.id)===BigInt(bank.revision),'incomplete_revision_history');
    if(bank.identity_version!=='legacy-v12')continue;
    requirePortable(current.parser_version==='legacy-v12','invalid_legacy_proof');
    const account=accounts.get(bank.account_id)!,original=legacyOriginal(bank,account,current,legacy);
    requirePortable(typeof original.raw==='string','invalid_legacy_proof');const raw=financialObject(original.raw,'invalid_legacy_proof');
    const minor=original.amount_minor;requirePortable(typeof minor==='bigint'||typeof minor==='number'&&Number.isSafeInteger(minor),'invalid_legacy_proof');
    const integer=BigInt(minor);requirePortable(integer!==0n,'invalid_legacy_proof');
    const scale=Number(account.scale),digits=(integer<0n?-integer:integer).toString().padStart(scale+1,'0'),amount=scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits;
    const details=jsonTruthy(raw.details)?raw.details:{};
    requirePortable(details!==null&&typeof details==='object'&&!Array.isArray(details)&&
      [Object.prototype,null].includes(Object.getPrototypeOf(details)),'invalid_legacy_proof');
    const fields=details as Record<string,unknown>;
    const expected=[original.bank_account,original.external_id,original.date,original.description,original.raw,amount,integer>0n?'income':'expense',
      Object.hasOwn(raw,'reference_kind')?raw.reference_kind:'bank',legacyOccurred(raw,account.bank,original.date as string),fields.corresponsiveAccount??null,fields.corresponsiveName??null];
    const actual=[bank.account_id,bank.external_id,bank.local_date,bank.description,bank.raw_json,bank.amount,bank.direction,bank.identity_kind,bank.occurred_at,bank.beneficiary_account,bank.beneficiary_name];
    requirePortable(jsonEqual(expected,actual),'invalid_legacy_bank_projection');
  }
  for await(const row of reader.rows('coverage')){
    calendarDate(row.start_date);calendarDate(row.end_date);const values=ranges.get(row.account_id)??[];values.push([row.start_date,row.end_date]);ranges.set(row.account_id,values);
  }
  for(const account of accounts.values()){
    if(account.import_start!==null)calendarDate(account.import_start);
    if(account.last_complete_end!==null)calendarDate(account.last_complete_end);
    let end:string|null=null;
    if(account.import_start!==null){
      let cursor:string=account.import_start;
      for(const [left,right]of (ranges.get(account.id)??[]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:a[1]>b[1]?1:0)){
        if(left>cursor)break;if(right>=cursor)cursor=shifted(right,1);
      }
      if(cursor>account.import_start)end=shifted(cursor,-1);
    }
    requirePortable(account.last_complete_end===end,'invalid_coverage_frontier');
  }
  return {accounts,banks,aliases,versions};
}
