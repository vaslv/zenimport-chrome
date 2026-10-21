/** Historical target proof and late opposite-bank corroboration; no side effects. */
import {DomainError} from '../errors.js';
import {signedMovement} from '../money.js';
import {signedBank,edgeKey,compareText} from './matching.js';
import type {BankMovement,RemoteMovement,Candidate} from './matching.js';
export interface KnownEdge{bank_id:string;zen_id:string}
export interface TargetProof extends KnownEdge{target_id:string;origin:string;at:string}
export interface Authorization{bank_id:string;target_id:string;revision:string;source_hash:string;authorized_at:string}
export interface OwnershipContext{
  /** KNOWN is a union of durable edges; duplicate pairs must already be removed. */
  known:readonly KnownEdge[];targets:readonly TargetProof[];
  /** Only ever-attempted deliveries and immutable attempt payloads are evidence. */
  payloads:readonly (KnownEdge&{incomeAccount:unknown;outcomeAccount:unknown})[];
  adopted:ReadonlySet<string>;attempted:ReadonlySet<string>;authorizations:ReadonlyMap<string,Authorization>;
  /** Eligible mirror entities exclude permanent tombstones for recovery. */
  transactions:ReadonlyMap<string,RemoteMovement>;
  /** Current deleted=0 entities retain reappeared tombstoned UUIDs for blocking. */
  blockingTransactions:ReadonlyMap<string,RemoteMovement>;excluded:ReadonlySet<string>;sourceHash:string;
  enabled:readonly {id:string;zenmoney_account_id:string|null}[];
  instruments:ReadonlyMap<string,string>;
  current:ReadonlyMap<string,BankMovement>;revisions:ReadonlyMap<string,BankMovement>;
}
const pair=(bank:string,zen:string)=>JSON.stringify([bank,zen]);
export const revisionKey=(bank:string,revision:string)=>JSON.stringify([bank,revision]);
export function ownershipClaims(known:readonly KnownEdge[],targets:readonly TargetProof[]){
  const byPair=new Map(targets.map(row=>[pair(row.bank_id,row.zen_id),row.target_id])),exact=new Set<string>(),unknown=new Set<string>();
  for(const row of known){const target=byPair.get(pair(row.bank_id,row.zen_id));if(target===undefined)unknown.add(row.zen_id);else exact.add(edgeKey(row.zen_id,target));}
  return {exact,unknown};
}
export function backfillOwnership(context:OwnershipContext):TargetProof[]{
  const targets=new Map(context.targets.map(row=>[pair(row.bank_id,row.zen_id),row.target_id])),added:TargetProof[]=[],payloadProofs=new Map<string,Set<string>>();
  for(const payload of context.payloads)if(payload.incomeAccount===payload.outcomeAccount&&typeof payload.incomeAccount==='string'&&payload.incomeAccount){
    const key=pair(payload.bank_id,payload.zen_id),proofs=payloadProofs.get(key)??new Set<string>();proofs.add(payload.incomeAccount);payloadProofs.set(key,proofs);
  }
  for(const edge of context.known){
    const key=pair(edge.bank_id,edge.zen_id);if(targets.has(key))continue;
    const proofs=new Set(payloadProofs.get(key));
    const authorization=context.authorizations.get(edge.bank_id);
    if(authorization&&(context.adopted.has(key)||context.attempted.has(key)))proofs.add(authorization.target_id);
    if(proofs.size===1){const target=[...proofs][0];added.push({...edge,target_id:target,origin:'durable_history',at:authorization?.authorized_at??'0'});targets.set(key,target);}
  }
  return added;
}

export function recoverTransferOwnership(context:OwnershipContext,candidates:readonly Candidate[],now:string):TargetProof[]{
  if(!candidates.length)return [];
  const {exact,unknown}=ownershipClaims(context.known,context.targets),bindings=new Map<string|null,Set<string>>();
  for(const row of context.enabled){const set=bindings.get(row.zenmoney_account_id)??new Set<string>();set.add(row.id);bindings.set(row.zenmoney_account_id,set);}
  const ownersByZen=new Map<string,KnownEdge[]>();for(const edge of context.known){const rows=ownersByZen.get(edge.zen_id)??[];rows.push(edge);ownersByZen.set(edge.zen_id,rows);}
  const mappings=new Map(context.enabled.map(row=>[row.id,row.zenmoney_account_id]));
  const peerBuckets=new Map<string,{instruments:Set<string>;values:Map<string,Candidate[]>}>();
  for(const candidate of candidates){
    const [bank,target]=candidate,key=JSON.stringify([target.id,bank.local_date]);
    const bucket=peerBuckets.get(key)??{instruments:new Set<string>(),values:new Map<string,Candidate[]>()};
    const amount=JSON.stringify([target.instrument,signedBank(bank).toString()]),rows=bucket.values.get(amount)??[];
    rows.push(candidate);bucket.values.set(amount,rows);bucket.instruments.add(target.instrument);peerBuckets.set(key,bucket);
  }
  const remoteIndexes=new Map<string,Map<string,RemoteMovement[]>>();
  function alternativesFor(target:string,instrument:string,day:string,amount:string){
    const key=JSON.stringify([target,instrument]);let index=remoteIndexes.get(key);
    if(!index){
      index=new Map();for(const tx of context.transactions.values()){
        if(tx.hold||context.excluded.has(tx.id)||exact.has(edgeKey(tx.id,target))||tx.date===undefined||tx.incomeAccount!==target&&tx.outcomeAccount!==target)continue;
        const value=signedMovement(tx,target,instrument);if(!value?.sign())continue;
        const key=JSON.stringify([tx.date,value.toString()]),rows=index.get(key)??[];rows.push(tx);index.set(key,rows);
      }remoteIndexes.set(key,index);
    }
    return index.get(JSON.stringify([day,amount]))??[];
  }
  const proposals:{proof:TargetProof;peer:string}[]=[];
  for(const zen of [...unknown].sort(compareText)){
    const tx=context.transactions.get(zen);if(!tx||tx.hold||context.excluded.has(zen))continue;
    const sides=new Set([tx.incomeAccount,tx.outcomeAccount]);
    if(sides.has(null)||sides.has(undefined)||sides.size!==2||!tx.income||!tx.outcome||tx.income==='0'||tx.outcome==='0')continue;
    const owners=ownersByZen.get(zen)??[];if(owners.length!==1)continue;
    const old=owners[0].bank_id,proof=context.authorizations.get(old);
    if(!proof||proof.source_hash!==context.sourceHash||!sides.has(proof.target_id))continue;
    const bank=context.revisions.get(revisionKey(old,proof.revision)),current=context.current.get(old);
    if(!bank||!current)throw new DomainError('invalid_dto');
    const target=proof.target_id,binding=bindings.get(target);
    const mapped=mappings.get(bank.account_id);
    if(current.local_date!==bank.local_date||!signedBank(current).equals(signedBank(bank))||mapped!==target||binding?.size!==1||!binding.has(bank.account_id))continue;
    const instrument=context.instruments.get(target);
    if(instrument===undefined||bank.local_date!==tx.date||!signedMovement(tx,target,instrument)?.equals(signedBank(bank)))continue;
    const other=[...sides].find(side=>side!==target)!;
    if(exact.has(edgeKey(zen,other))||bindings.get(other)?.size!==1)continue;
    const bucket=peerBuckets.get(JSON.stringify([other,tx.date])),peers:Candidate[]=[];
    if(bucket)for(const instrument of bucket.instruments){
      const amount=signedMovement(tx,other,instrument);if(!amount)continue;
      for(const candidate of bucket.values.get(JSON.stringify([instrument,amount.toString()]))??[])if(candidate[0].account_id!==bank.account_id)peers.push(candidate);
    }
    if(peers.length!==1)continue;
    const [peer,account]=peers[0],alternatives=alternativesFor(other,account.instrument,peer.local_date,signedBank(peer).toString());
    if(alternatives.length===1)proposals.push({proof:{bank_id:old,zen_id:zen,target_id:target,origin:'corroborated_transfer',at:now},peer:peer.id});
  }
  const counts=new Map<string,number>();for(const {peer}of proposals)counts.set(peer,(counts.get(peer)??0)+1);
  return proposals.filter(({peer})=>counts.get(peer)===1).map(({proof})=>proof);
}

export function blockedOwnership(context:OwnershipContext,candidates:readonly Candidate[]):Set<string>{
  const {unknown}=ownershipClaims(context.known,context.targets),days=new Map<string,Set<string>>();
  for(const zen of unknown){
    const tx=context.blockingTransactions.get(zen);if(!tx||context.excluded.has(zen))continue;
    for(const side of ['income','outcome'] as const){const target=tx[side+'Account' as 'incomeAccount'|'outcomeAccount'],amount=tx[side];
      if(target!=null&&amount&&amount!=='0'&&tx.date!==undefined){const set=days.get(target)??new Set<string>();set.add(tx.date);days.set(target,set);}
    }
  }
  return new Set(candidates.filter(([bank,account])=>days.get(account.id)?.has(bank.local_date)).map(([bank])=>bank.id));
}
