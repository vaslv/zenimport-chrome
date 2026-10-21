/** Pure account-side matching. Input facts are immutable repository snapshots. */
import {ExactMoney,signedMovement} from '../money.js';
import type {Movement} from '../money.js';
import {timestampProjection} from '../bank-record.js';
import {uniqueSubset} from './subsets.js';
export interface BankMovement{
  id:string;account_id:string;external_id:string;identity_kind:string;local_date:string;
  direction:'income'|'expense';amount:string;occurred_at:string|null;
}
export interface Target{id:string;instrument:string}
/** Amounts use the canonical plain-decimal domain codec, not mirror TEXT display. */
export interface RemoteMovement extends Movement{id:string;date?:string;comment?:string|null;created?:string|null;hold?:boolean}
export type Candidate=readonly [BankMovement,Target];
export interface MatchContext{
  transactions:readonly RemoteMovement[];claimed:ReadonlySet<string>;unknown:ReadonlySet<string>;
  excluded:ReadonlySet<string>;enabled:readonly {id:string;zenmoney_account_id:string|null}[];grouped:ReadonlySet<string>;
}
export interface MatchGroup{account_id:string;banks:string[];zens:string[];kind:'split'|'settlement'}
export type SingleMatch=readonly [string,'bank_reference'|'day_amount'|'day_amount_order'];
export const edgeKey=(zen:string,target:string)=>JSON.stringify([zen,target]);
export const compareText=(a:string,b:string)=>{
  const left=[...a],right=[...b];for(let i=0;i<Math.min(left.length,right.length);i++){const d=left[i].codePointAt(0)!-right[i].codePointAt(0)!;if(d)return d;}return left.length-right.length;
};
const key=(...values:unknown[])=>JSON.stringify(values);
const compareBig=(a:bigint,b:bigint)=>a<b?-1:a>b?1:0;
export function signedBank(bank:BankMovement){const value=ExactMoney.bank(bank.amount);return bank.direction==='income'?value:value.negate();}
export function bankReference(bank:BankMovement){
  if(bank.identity_kind!=='bank'||!bank.external_id.startsWith('vib:id:'))return null;
  const token=bank.external_id.slice(7);return token.match(/^[A-Za-z0-9]{6,128}$/)?.[0]===token?token:null;
}
export function matchingPool(context:MatchContext){
  const buckets=new Map<string,RemoteMovement[]>();
  for(const tx of context.transactions){
    if(context.excluded.has(tx.id)||context.unknown.has(tx.id)||tx.hold)continue;
    for(const target of new Set([tx.incomeAccount,tx.outcomeAccount]))if(target!=null&&!context.claimed.has(edgeKey(tx.id,target))){
      const k=key(target,tx.date),bucket=buckets.get(k)??[];bucket.push(tx);buckets.set(k,bucket);
    }
  }
  return buckets;
}
function enabledTargets(context:MatchContext){
  const result=new Map<string|null,Set<string>>();for(const row of context.enabled){const bucket=result.get(row.zenmoney_account_id)??new Set<string>();bucket.add(row.id);result.set(row.zenmoney_account_id,bucket);}return result;
}
function increment(map:Map<string,number>,id:string){map.set(id,(map.get(id)??0)+1);}

export function singleMatches(context:MatchContext,candidates:readonly Candidate[]):Map<string,SingleMatch>{
  const buckets=matchingPool(context),proposed=new Map<string,string>(),bankTargets=new Map(candidates.map(([bank,account])=>[bank.id,account.id]));
  for(const [bank,account]of candidates){
    const token=bankReference(bank);if(token===null)continue;
    const pattern=new RegExp('(?<![A-Za-z0-9])'+token+'(?![A-Za-z0-9])');
    const found=(buckets.get(key(account.id,bank.local_date))??[]).filter(tx=>pattern.test(tx.comment??'')&&signedMovement(tx,account.id,account.instrument)?.equals(signedBank(bank)));
    if(found.length===1)proposed.set(bank.id,found[0].id);
  }
  const owners=new Map<string,number>();for(const [bank,zen]of proposed)increment(owners,edgeKey(zen,bankTargets.get(bank)!));
  const result=new Map<string,SingleMatch>(),claimed=new Set<string>();
  for(const [bank,zen]of proposed)if(owners.get(edgeKey(zen,bankTargets.get(bank)!))===1){result.set(bank,[zen,'bank_reference']);claimed.add(edgeKey(zen,bankTargets.get(bank)!));}
  const targets=enabledTargets(context),groups=new Map<string,{target:Target;day:string;amount:ExactMoney;banks:BankMovement[]}>();
  for(const [bank,target]of candidates)if(!result.has(bank.id)){
    const k=key(target.id,bank.local_date,bank.direction,ExactMoney.bank(bank.amount).toString(),target.instrument);
    const group=groups.get(k)??{target,day:bank.local_date,amount:signedBank(bank),banks:[]};group.banks.push(bank);groups.set(k,group);
  }
  for(const {target,day,amount,banks}of groups.values()){
    if(targets.get(target.id)?.size!==1)continue;
    const remote=(buckets.get(key(target.id,day))??[]).filter(tx=>!claimed.has(edgeKey(tx.id,target.id))&&signedMovement(tx,target.id,target.instrument)?.equals(amount));
    remote.sort((a,b)=>compareBig(BigInt(a.created||'0'),BigInt(b.created||'0'))||compareText(a.id,b.id));
    banks.sort((a,b)=>compareBig(a.occurred_at?timestampProjection(a.occurred_at).micros:0n,b.occurred_at?timestampProjection(b.occurred_at).micros:0n)||compareText(a.id,b.id));
    const origin=banks.length===1&&remote.length===1?'day_amount':'day_amount_order';
    for(let i=0;i<Math.min(banks.length,remote.length);i++){result.set(banks[i].id,[remote[i].id,origin]);claimed.add(edgeKey(remote[i].id,target.id));}
  }
  return result;
}

export function groupMatches(context:MatchContext,candidates:readonly Candidate[],singles:ReadonlyMap<string,SingleMatch>):MatchGroup[]{
  const buckets=matchingPool(context),targets=enabledTargets(context),days=new Map<string,{account_id:string;target:Target;day:string;banks:BankMovement[]}>();
  const bankTargets=new Map(candidates.map(([bank,target])=>[bank.id,target.id])),claimed=new Set([...singles].map(([bank,[zen]])=>edgeKey(zen,bankTargets.get(bank)!)));
  for(const [bank,target]of candidates)if(!singles.has(bank.id)&&targets.get(target.id)?.size===1){
    const k=key(bank.account_id,target.id,target.instrument,bank.local_date),day=days.get(k)??{account_id:bank.account_id,target,day:bank.local_date,banks:[]};day.banks.push(bank);days.set(k,day);
  }
  const proposals:MatchGroup[]=[];
  for(const {account_id,target,day,banks}of days.values()){
    const checkpoint=proposals.length,remote=new Map<string,ExactMoney>(),budget={remaining:20000};
    for(const tx of buckets.get(key(target.id,day))??[])if(!claimed.has(edgeKey(tx.id,target.id))&&!context.grouped.has(tx.id)){
      const value=signedMovement(tx,target.id,target.instrument);if(value?.sign())remote.set(tx.id,value);
    }
    for(const bank of banks){
      const amount=signedBank(bank),proof=uniqueSubset([...remote],amount,budget);
      if(proof.ids)proposals.push({account_id,banks:[bank.id],zens:proof.ids,kind:proof.ids.every(id=>remote.get(id)!.sign()===amount.sign())?'split':'settlement'});
    }
    for(const [zen,value]of remote){const proof=uniqueSubset(banks.map(bank=>[bank.id,signedBank(bank)] as const),value,budget);if(proof.ids)proposals.push({account_id,banks:proof.ids,zens:[zen],kind:'settlement'});}
    if(budget.remaining<=0)proposals.splice(checkpoint);
  }
  const bankOwners=new Map<string,number>(),zenOwners=new Map<string,number>();
  for(const group of proposals){for(const id of group.banks)increment(bankOwners,id);for(const id of group.zens)increment(zenOwners,id);}
  return proposals.filter(group=>group.banks.every(id=>bankOwners.get(id)===1)&&group.zens.every(id=>zenOwners.get(id)===1));
}
