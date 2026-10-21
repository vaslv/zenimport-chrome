/** Rebuildable evidence from confirmed current mobile data; never self-training. */
import {ExactMoney} from '../money.js';
import {normalized} from '../identity.js';
import {DomainError} from '../errors.js';
import {compareText} from '../reconciliation/matching.js';
import type {BankMovement} from '../reconciliation/matching.js';
export interface CategoryBank extends BankMovement{
  bank:string;currency:string;description:string;beneficiary_account:string|null;beneficiary_name:string|null;
}
export interface CategoryTag{id:string;title:string;deleted:boolean;archive:boolean;showIncome:boolean;showOutcome:boolean}
/** Flags and numbers are normalized by the exact SDK/mirror adapter. Scale flags
 * retain the original Decimal quantum before canonical monetary normalization.
 */
export interface ReviewedPayment{
  id:string;viewed:boolean;hold:boolean;deleted:boolean;tags:readonly string[];
  incomeAccount:string|null;outcomeAccount:string|null;incomeInstrument:string|null;outcomeInstrument:string|null;
  income:string|null;outcome:string|null;incomeScaleAllowed:boolean;outcomeScaleAllowed:boolean;
}
export interface CategoryPayment{bank_id:string;category_id:string|null;reason:'single_category'|'ambiguous_categories';eligible:boolean;zen_ids:readonly string[]}
export interface CategoryEvidence{bank_id:string;zen_id:string;category_id:string;direction:'income'|'expense';origin:string;eligible:boolean}
export interface EvidenceInput{
  /** Caller selects delivered bank rows and retains the bank exclusion set. */
  banks:readonly CategoryBank[];bankExclusions:ReadonlySet<string>;zenExclusions:ReadonlySet<string>;
  tags:ReadonlyMap<string,CategoryTag>;transactions:ReadonlyMap<string,ReviewedPayment>;
  accounts:ReadonlyMap<string,{type:string}>;instruments:ReadonlyMap<string,string>;
  bindings:ReadonlyMap<string,ReadonlySet<string>>;
  groups:readonly {kind:string;banks:readonly string[];zens:readonly string[]}[];
  receipts:readonly {bank_id:string;zen_id:string;origin:string}[];deliveries:ReadonlyMap<string,string>;
}
const ordinary=new Set(['cash','ccard','checking','deposit','emoney']);
const key=(...values:unknown[])=>JSON.stringify(values);
export function validTag(tags:ReadonlyMap<string,CategoryTag>,id:string|null,direction:'income'|'expense'){
  const tag=id===null?undefined:tags.get(id);return !!tag&&!tag.deleted&&!tag.archive&&(direction==='income'?tag.showIncome:tag.showOutcome);
}
export function safeNormalized(value:string|null|undefined):string|null{
  try{return normalized(value);}catch(error){if(error instanceof DomainError&&error.code==='unsupported_unicode')return null;throw error;}
}
export function predictionRecipient(bank:Pick<CategoryBank,'beneficiary_account'|'beneficiary_name'|'description'>):string|null{
  // Lower-priority text cannot erase a known stronger recipient identity.
  const account=safeNormalized(bank.beneficiary_account);if(account===null)return null;if(account)return 'account:'+account;
  const name=safeNormalized(bank.beneficiary_name);if(name===null)return null;if(name)return 'name:'+name;
  const description=safeNormalized(bank.description);return description!==null&&[...description].length>=6?'description:'+description:null;
}

export function buildCategoryEvidence(input:EvidenceInput):{payments:CategoryPayment[];evidence:CategoryEvidence[]}{
  const groups=new Map<string,EvidenceInput['groups'][number]>();for(const group of input.groups)for(const bank of group.banks)groups.set(bank,group);
  const receipts=new Map<string,Set<string>>();for(const row of input.receipts)if(row.origin!=='day_amount_order'){
    const values=receipts.get(row.bank_id)??new Set<string>();values.add(row.zen_id);receipts.set(row.bank_id,values);
  }
  const banks=input.banks.filter(bank=>!input.bankExclusions.has(bank.id)),proofs=new Map<string,{zens:readonly string[];origin:string}>(),owners=new Map<string,Set<string>>();
  for(const bank of banks){
    const group=groups.get(bank.id);let zens:readonly string[],origin:string;
    if(group){if(group.kind==='settlement'||group.banks.length!==1)continue;zens=group.zens;origin='confirmed_group:'+group.kind;}
    else{
      const delivery=input.deliveries.get(bank.id);zens=delivery===undefined?[...(receipts.get(bank.id)??[])].sort(compareText):[delivery];
      if(zens.length!==1)continue;origin='confirmed_receipt';
    }
    proofs.set(bank.id,{zens,origin});for(const zen of zens){const set=owners.get(zen)??new Set<string>();set.add(bank.id);owners.set(zen,set);}
  }
  const payments:CategoryPayment[]=[],evidence:CategoryEvidence[]=[];
  for(const bank of banks){
    const proof=proofs.get(bank.id);if(!predictionRecipient(bank)||!proof||proof.zens.some(id=>owners.get(id)?.size!==1))continue;
    const categories=new Set<string>(),values:ExactMoney[]=[],edges:{zen:string;category:string}[]=[];
    let valid=proof.zens.length>0;
    for(const id of proof.zens){
      const tx=input.transactions.get(id);
      if(!tx||input.zenExclusions.has(id)||!tx.viewed||tx.hold||tx.deleted){valid=false;break;}
      const target=tx.incomeAccount,account=target===null?undefined:input.accounts.get(target);
      if(target===null||target!==tx.outcomeAccount||!input.bindings.get(bank.account_id)?.has(target)||!account||!ordinary.has(account.type)||tx.income===null||tx.outcome===null){valid=false;break;}
      const value=ExactMoney.parse(bank.direction==='income'?tx.income:tx.outcome),other=ExactMoney.parse(bank.direction==='income'?tx.outcome:tx.income);
      const instrument=bank.direction==='income'?tx.incomeInstrument:tx.outcomeInstrument,scaleAllowed=bank.direction==='income'?tx.incomeScaleAllowed:tx.outcomeScaleAllowed;
      if(value.sign()<=0||other.sign()!==0||value.compare(ExactMoney.bank(bank.amount))>0||!scaleAllowed||instrument===null||input.instruments.get(instrument)!==bank.currency){valid=false;break;}
      if(tx.tags.some(tag=>!validTag(input.tags,tag,bank.direction))){valid=false;break;}
      values.push(value);for(const category of tx.tags){categories.add(category);edges.push({zen:id,category});}
    }
    if(!valid||!ExactMoney.sum(values).equals(ExactMoney.bank(bank.amount)))continue;
    const eligible=categories.size===1&&proof.zens.every(id=>input.transactions.get(id)!.tags.length===1),category=eligible?[...categories][0]:null;
    payments.push({bank_id:bank.id,category_id:category,reason:eligible?'single_category':'ambiguous_categories',eligible,zen_ids:[...proof.zens]});
    for(const edge of new Map(edges.map(edge=>[key(edge.zen,edge.category),edge])).values())evidence.push({bank_id:bank.id,zen_id:edge.zen,category_id:edge.category,direction:bank.direction,origin:proof.origin,eligible});
  }
  return {payments,evidence};
}

interface Profile{counts:ReadonlyMap<string,number>;blocked:number;payments:ReadonlyMap<string,string|null>}
export interface PredictionContext{
  tags:ReadonlyMap<string,CategoryTag>;profiles:ReadonlyMap<string,Profile>;rules:ReadonlyMap<string,ReadonlySet<string>>;
  manual:ReadonlyMap<string,string|null>;banks:ReadonlyMap<string,string>;
}
export function categoryContext(input:{tags:ReadonlyMap<string,CategoryTag>;banks:readonly CategoryBank[];payments:readonly CategoryPayment[];
  rules:readonly {bank:string;direction:'income'|'expense';name:string;category_id:string}[];manual:ReadonlyMap<string,string|null>}):PredictionContext{
  const banks=new Map(input.banks.map(bank=>[bank.id,bank])),profiles=new Map<string,{counts:Map<string,number>;blocked:number;payments:Map<string,string|null>}>();
  for(const payment of input.payments){
    const bank=banks.get(payment.bank_id);if(!bank)throw new DomainError('invalid_dto');
    const recipient=predictionRecipient(bank),k=key(bank.account_id,bank.direction,recipient),profile=profiles.get(k)??{counts:new Map<string,number>(),blocked:0,payments:new Map<string,string|null>()};
    if(payment.eligible&&validTag(input.tags,payment.category_id,bank.direction)){
      const category=payment.category_id!;
      // Future Unicode versions cannot alter an automatic tie-break silently.
      if(safeNormalized(input.tags.get(category)!.title)!==null){profile.counts.set(category,(profile.counts.get(category)??0)+1);profile.payments.set(bank.id,category);}
      else{profile.blocked++;profile.payments.set(bank.id,null);}
    }else if(!payment.eligible){profile.blocked++;profile.payments.set(bank.id,null);}
    profiles.set(k,profile);
  }
  const rules=new Map<string,Set<string>>();
  for(const rule of input.rules){
    const name=safeNormalized(rule.name);if(name===null||!validTag(input.tags,rule.category_id,rule.direction))continue;
    const k=key(rule.bank,rule.direction,name),set=rules.get(k)??new Set<string>();set.add(rule.category_id);rules.set(k,set);
  }
  return {tags:input.tags,profiles,rules,manual:input.manual,banks:new Map(input.banks.map(bank=>[bank.account_id,bank.bank]))};
}
export interface Prediction{category_id:string|null;source:'unknown'|'manual'|'rule'|'history';reason:string;candidates:{category_id:string;title:string;count:number}[]}
export function predictCategory(bank:CategoryBank,context:PredictionContext,fresh:boolean):Prediction{
  const result:Prediction={category_id:null,source:'unknown',reason:'no_confirmed_history',candidates:[]};
  if(!fresh)return {...result,reason:'zenmoney_unavailable'};
  const manual=context.manual.get(bank.id);if(manual&&validTag(context.tags,manual,bank.direction))return {...result,category_id:manual,source:'manual',reason:'manual_choice'};
  const name=safeNormalized(bank.beneficiary_name);if(name===null)return {...result,reason:'unsupported_unicode'};
  const rules=name?context.rules.get(key(context.banks.get(bank.account_id),bank.direction,name))??new Set<string>():new Set<string>();
  if(rules.size===1)return {...result,category_id:[...rules][0],source:'rule',reason:'recipient_rule'};
  const recipient=predictionRecipient(bank);if(!recipient)return result;
  const profile=context.profiles.get(key(bank.account_id,bank.direction,recipient)),counts=new Map(profile?.counts??[]);let blockers=profile?.blocked??0;
  if(profile?.payments.has(bank.id)){
    const own=profile.payments.get(bank.id);if(own===null)blockers--;else if(own!==undefined){const count=counts.get(own)!-1;if(count===0)counts.delete(own);else counts.set(own,count);}
  }
  result.candidates=[...counts].sort(([a,x],[b,y])=>y-x||compareText(safeNormalized(context.tags.get(a)!.title)!,safeNormalized(context.tags.get(b)!.title)!)||compareText(a,b))
    .map(([category_id,count])=>({category_id,title:context.tags.get(category_id)!.title,count}));
  if(rules.size>0||blockers>0||counts.size>1)return {...result,reason:'conflicting_history'};
  const first=[...counts][0];if(first&&first[1]>=3)return {...result,category_id:first[0],source:'history',reason:'three_consistent_payments'};
  return {...result,reason:counts.size?'insufficient_history':result.reason};
}
