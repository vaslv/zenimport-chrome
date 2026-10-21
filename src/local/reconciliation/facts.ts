/** Lossless storage-to-domain boundary. Raw SDK tokens retain their quantum. */
import {decodeJson,ExactDecimal} from 'zenmoney-typescript';
import {moneyFromWire} from '../../domain/codec.js';
import {ExactMoney} from '../../domain/money.js';
import {revisionKey} from '../../domain/reconciliation/ownership.js';
import type {RemoteMovement} from '../../domain/reconciliation/matching.js';
import type {CategoryBank,ReviewedPayment,CategoryTag} from '../../domain/prediction/categories.js';
import {jsonTruthy,jsonEqual,scalarText} from '../portable/json-values.js';
import {requireStorage} from '../storage/types.js';
import type {RowByTable} from '../storage/schema.generated.js';
import type {SourceSnapshot} from './source.js';
export type FinancialObject=Record<string,unknown>;
export type BankFact=CategoryBank&{revision:string};
export function storedObject(raw:string):FinancialObject{
  const value=decodeJson(raw);requireStorage(value!==null&&typeof value==='object'&&!Array.isArray(value)&&!(value instanceof ExactDecimal),'storage_corrupt');
  return value as FinancialObject;
}
const text=(value:unknown):string|null=>value==null?null:scalarText(value,'invalid_financial_identifier');
const string=(value:unknown,fallback='')=>{requireStorage(value==null||typeof value==='string','storage_corrupt');return value??fallback;};
const amount=(value:unknown):string|null=>value==null?null:moneyFromWire(value).toString();
const scaleAllowed=(value:unknown)=>{
  if(typeof value==='bigint'||typeof value==='number'&&Number.isSafeInteger(value))return true;
  if(!(value instanceof ExactDecimal))return false;
  const [mantissa,exponent='0']=value.toString().toLowerCase().split('e');
  return BigInt(exponent)-BigInt(mantissa.split('.')[1]?.length??0)>=-12n;
};
export function movementFact(row:RowByTable['zen_entities']):RemoteMovement{
  const value=storedObject(row.data),created=value.created;
  requireStorage(created==null||typeof created==='bigint'||typeof created==='number'&&Number.isSafeInteger(created),'storage_corrupt');
  return {id:row.id,date:value.date==null?undefined:string(value.date),incomeAccount:text(value.incomeAccount),outcomeAccount:text(value.outcomeAccount),
    incomeInstrument:text(value.incomeInstrument),outcomeInstrument:text(value.outcomeInstrument),income:amount(value.income)??undefined,outcome:amount(value.outcome)??undefined,
    hold:jsonTruthy(value.hold),created:created==null?null:String(created),comment:value.comment==null?null:string(value.comment)};
}
export function reviewedFact(row:RowByTable['zen_entities']):ReviewedPayment{
  const value=storedObject(row.data),tag=value.tag??[];requireStorage(Array.isArray(tag)&&tag.every(id=>typeof id==='string'),'storage_corrupt');
  return {id:row.id,viewed:value.viewed===true||value.viewed===1||value.viewed===1n,hold:jsonTruthy(value.hold),deleted:jsonTruthy(value.deleted),tags:tag as string[],
    incomeAccount:text(value.incomeAccount),outcomeAccount:text(value.outcomeAccount),incomeInstrument:text(value.incomeInstrument),outcomeInstrument:text(value.outcomeInstrument),
    income:amount(value.income),outcome:amount(value.outcome),incomeScaleAllowed:scaleAllowed(value.income),outcomeScaleAllowed:scaleAllowed(value.outcome)};
}
export function tagFact(row:RowByTable['zen_entities']):CategoryTag{
  const value=storedObject(row.data),enabled=(key:string)=>!jsonEqual(value[key],false);
  return {id:row.id,title:string(value.title),deleted:jsonTruthy(value.deleted),archive:jsonTruthy(value.archive),showIncome:enabled('showIncome'),showOutcome:enabled('showOutcome')};
}
export function bankFact(row:RowByTable['bank_transactions'],account:RowByTable['bank_accounts']):BankFact{
  requireStorage(row.account_id===account.id&&(row.direction==='income'||row.direction==='expense'),'storage_corrupt');
  ExactMoney.bank(row.amount);
  return {...row,direction:row.direction,bank:account.bank};
}
export function historicalBank(current:BankFact,version:RowByTable['bank_versions'],scale:string):BankFact{
  requireStorage(current.id===version.bank_id,'storage_corrupt');
  // Python returns the current row if its revision is requested, including the
  // original canonical external ID rather than a later connector alias.
  if(current.revision===version.revision)return current;
  const data=storedObject(version.data_json);let result:BankFact;
  if(Object.hasOwn(data,'local_date')){
    requireStorage(data.direction==='income'||data.direction==='expense','storage_corrupt');
    result={...current,revision:version.revision,local_date:string(data.local_date),occurred_at:data.occurred_at==null?null:string(data.occurred_at),direction:data.direction,
      amount:string(data.amount),description:string(data.description),beneficiary_account:data.beneficiary_account==null?null:string(data.beneficiary_account),beneficiary_name:data.beneficiary_name==null?null:string(data.beneficiary_name)};
  }else{
    const raw=storedObject(version.raw_json),details=jsonTruthy(raw.details)?raw.details:{};
    requireStorage(details!==null&&typeof details==='object'&&!Array.isArray(details)&&!(details instanceof ExactDecimal),'storage_corrupt');
    const fields=details as FinancialObject;
    requireStorage(typeof data.amount_minor==='bigint'||typeof data.amount_minor==='number'&&Number.isSafeInteger(data.amount_minor),'storage_corrupt');
    const minor=BigInt(data.amount_minor),places=Number(scale);requireStorage(Number.isInteger(places)&&places>=0&&places<=12,'storage_corrupt');
    const digits=(minor<0n?-minor:minor).toString().padStart(places+1,'0');
    result={...current,revision:version.revision,local_date:string(data.date),occurred_at:null,direction:minor>0n?'income':'expense',
      amount:places?digits.slice(0,-places)+'.'+digits.slice(-places):digits,description:string(data.description),
      beneficiary_account:fields.corresponsiveAccount==null?null:string(fields.corresponsiveAccount),beneficiary_name:fields.corresponsiveName==null?null:string(fields.corresponsiveName)};
  }
  ExactMoney.bank(result.amount);return result;
}
export interface Facts{
  banks:Map<string,BankFact>;revisions:Map<string,BankFact>;accounts:Map<string,RowByTable['bank_accounts']>;
  entities:Map<string,Map<string,FinancialObject>>;transactions:Map<string,RemoteMovement>;blockingTransactions:Map<string,RemoteMovement>;
  reviewed:Map<string,ReviewedPayment>;tags:Map<string,CategoryTag>;instruments:Map<string,string>;
}
export function sourceFacts(source:SourceSnapshot):Facts{
  const rows=source.rows,accounts=new Map(rows.bank_accounts.map(row=>[row.id,row])),banks=new Map<string,BankFact>(),revisions=new Map<string,BankFact>();
  for(const row of rows.bank_transactions){const account=accounts.get(row.account_id);requireStorage(account,'storage_corrupt');banks.set(row.id,bankFact(row,account));}
  for(const row of rows.bank_versions){const bank=banks.get(row.bank_id);requireStorage(bank,'storage_corrupt');revisions.set(revisionKey(row.bank_id,row.revision),historicalBank(bank,row,accounts.get(bank.account_id)!.scale));}
  const deleted=new Set(rows.zen_tombstones.map(row=>JSON.stringify([row.kind,row.entity_id]))),entities=new Map<string,Map<string,FinancialObject>>(),transactions=new Map<string,RemoteMovement>(),blockingTransactions=new Map<string,RemoteMovement>(),reviewed=new Map<string,ReviewedPayment>(),tags=new Map<string,CategoryTag>(),instruments=new Map<string,string>();
  for(const row of rows.zen_entities){
    if(row.deleted!=='0')continue;
    if(row.kind==='transaction')blockingTransactions.set(row.id,movementFact(row));
    if(deleted.has(JSON.stringify([row.kind,row.id])))continue;
    const bucket=entities.get(row.kind)??new Map<string,FinancialObject>();bucket.set(row.id,storedObject(row.data));entities.set(row.kind,bucket);
    if(row.kind==='transaction'){transactions.set(row.id,blockingTransactions.get(row.id)!);reviewed.set(row.id,reviewedFact(row));}
    if(row.kind==='tag')tags.set(row.id,tagFact(row));
    if(row.kind==='instrument')instruments.set(row.id,string(bucket.get(row.id)!.shortTitle));
  }
  return {banks,revisions,accounts,entities,transactions,blockingTransactions,reviewed,tags,instruments};
}
