/** One pure reconciliation plan; only a fenced repository may persist its facts. */
import {DomainError} from '../../domain/errors.js';
import {backfillOwnership,recoverTransferOwnership,ownershipClaims,blockedOwnership,revisionKey} from '../../domain/reconciliation/ownership.js';
import type {OwnershipContext,KnownEdge,TargetProof} from '../../domain/reconciliation/ownership.js';
import {singleMatches,groupMatches} from '../../domain/reconciliation/matching.js';
import type {Candidate,MatchContext} from '../../domain/reconciliation/matching.js';
import {sourceFresh} from './freshness.js';
import {storedObject,instrumentText} from './facts.js';
import type {Facts} from './facts.js';
import type {SourceSnapshot} from './source.js';
import {CaptureError,requireCapture} from '../capture/errors.js';
import {requireStorage} from '../storage/types.js';
import {jsonTruthy,scalarText} from '../portable/json-values.js';
const pair=(bank:string,zen:string)=>JSON.stringify([bank,zen]);
export interface ReconcileChoice{bank_id:string;revision:string;target_id:string}
export function sourceGroups(source:SourceSnapshot){
  const groups=new Map(source.rows.link_groups.map(row=>[row.id,{...row,banks:[] as string[],zens:[] as string[]}]));
  for(const row of source.rows.link_bank_members){const group=groups.get(row.group_id);requireStorage(group,'storage_corrupt');group.banks.push(row.bank_id);}
  for(const row of source.rows.link_zen_members){const group=groups.get(row.group_id);requireStorage(group,'storage_corrupt');group.zens.push(row.zen_id);}
  let edges=0;for(const group of groups.values()){edges+=group.banks.length*group.zens.length;if(edges>1000000)throw new DomainError('unsupported_scenario');}
  return [...groups.values()];
}
export function sourceOwnership(source:SourceSnapshot,facts:Facts):OwnershipContext{
  const rows=source.rows,known=new Map<string,KnownEdge>(),adopted=new Set<string>(),attempted=new Set<string>(),payloads:OwnershipContext['payloads'][number][]=[],groups=sourceGroups(source);
  function remember(bank:string,zen:string){known.set(pair(bank,zen),{bank_id:bank,zen_id:zen});}
  for(const row of rows.processing_receipts){remember(row.bank_id,row.zen_id);if(['bank_reference','day_amount','day_amount_order'].includes(row.origin))adopted.add(pair(row.bank_id,row.zen_id));}
  for(const row of [...rows.deliveries.filter(row=>row.ever_attempted==='1'),...rows.delivery_attempts]){
    remember(row.bank_id,row.zen_id);attempted.add(pair(row.bank_id,row.zen_id));const data=storedObject(row.payload);
    payloads.push({bank_id:row.bank_id,zen_id:row.zen_id,incomeAccount:data.incomeAccount,outcomeAccount:data.outcomeAccount});
  }
  for(const group of groups)for(const bank of group.banks)for(const zen of group.zens){remember(bank,zen);if(group.origin==='day_amount_group')adopted.add(pair(bank,zen));}
  const instruments=new Map<string,string>();for(const [id,account]of facts.entities.get('account')??[])if(instrumentText(account.instrument)!==null)instruments.set(id,instrumentText(account.instrument)!);
  return {known:[...known.values()],targets:rows.processing_targets,payloads,adopted,attempted,
    authorizations:new Map(rows.delivery_authorizations.map(row=>[row.bank_id,{...row,source_hash:row.source_hash??''}])),
    transactions:facts.transactions,blockingTransactions:facts.blockingTransactions,excluded:new Set(rows.zen_exclusions.map(row=>row.zen_id)),
    sourceHash:rows.zen_mirror_state[0]?.source_hash??'',enabled:rows.bank_accounts.filter(row=>row.selection==='enabled'),instruments,current:facts.banks,revisions:facts.revisions};
}
export function planReconciliation(source:SourceSnapshot,facts:Facts,choices:readonly ReconcileChoice[],now:string){
  if(!sourceFresh(source,now))throw new CaptureError('zenmoney_unavailable',true);
  const rows=source.rows,processing=new Map(rows.bank_processing.map(row=>[row.bank_id,row.state])),deliveries=new Map(rows.deliveries.map(row=>[row.bank_id,row]));
  const deleted=new Set(rows.zen_tombstones.filter(row=>row.kind==='transaction').map(row=>row.entity_id));
  const attempted=new Set(rows.delivery_attempts.map(row=>row.bank_id)),terminal=new Set([...rows.processing_receipts,...rows.link_bank_members,...rows.bank_exclusions].map(row=>row.bank_id));
  const complete=new Set(rows.capture_intervals.filter(row=>row.state==='complete').map(row=>row.id)),captured=new Set(rows.captured_records.filter(row=>complete.has(row.interval_id)).map(row=>revisionKey(row.bank_id,row.revision)));
  const accounts=facts.entities.get('account')??new Map(),candidates:Candidate[]=[],ids=new Set<string>();
  for(const choice of choices){
    requireCapture(!ids.has(choice.bank_id));ids.add(choice.bank_id);
    const bank=facts.revisions.get(revisionKey(choice.bank_id,choice.revision)),physical=bank&&facts.accounts.get(bank.account_id),target=accounts.get(choice.target_id);
    requireCapture(bank&&captured.has(revisionKey(choice.bank_id,choice.revision)),'history_incomplete');
    requireCapture(physical?.selection==='enabled'&&physical.supported==='1','account_disabled');
    requireCapture(physical.zenmoney_account_id===choice.target_id,'settings_conflict');
    requireCapture(!deleted.has(deliveries.get(bank.id)?.zen_id??'')&&['pending','prepared'].includes(processing.get(bank.id)??'')&&!attempted.has(bank.id)&&deliveries.get(bank.id)?.ever_attempted!=='1'&&!terminal.has(bank.id),'delivery_uncertain');
    requireCapture(target&&!jsonTruthy(target.archive)&&['cash','ccard','checking','deposit','emoney'].includes(target.type as string)&&instrumentText(target.instrument)!==null&&facts.instruments.get(instrumentText(target.instrument)!)===bank.currency,'zenmoney_account_unavailable');
    candidates.push([bank,{id:choice.target_id,instrument:scalarText(target.instrument,'invalid_instrument')}]);
  }
  const ownership=sourceOwnership(source,facts),proofs:TargetProof[]=backfillOwnership(ownership);
  ownership.targets=[...ownership.targets,...proofs];const recovered=recoverTransferOwnership(ownership,candidates,now);proofs.push(...recovered);ownership.targets=[...ownership.targets,...recovered];
  const claims=ownershipClaims(ownership.known,ownership.targets),context:MatchContext={transactions:[...facts.transactions.values()],claimed:claims.exact,unknown:claims.unknown,excluded:ownership.excluded,enabled:ownership.enabled,grouped:new Set(rows.link_zen_members.map(row=>row.zen_id))};
  const singles=singleMatches(context,candidates),groups=groupMatches(context,candidates,singles),recognized=new Set([...singles.keys(),...groups.flatMap(group=>group.banks)]);
  const blocked=new Set([...blockedOwnership(ownership,candidates)].filter(id=>!recognized.has(id)));
  return {proofs,singles,groups,recognized,blocked,targets:new Map(candidates.map(([bank,target])=>[bank.id,target.id]))};
}
