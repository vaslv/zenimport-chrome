/** Explicit UUID facts precede amount matching, including unattempted intents. */
import {compareText} from '../../domain/reconciliation/matching.js';
import {int64,requireStorage} from '../storage/types.js';
import type {RowByTable} from '../storage/schema.generated.js';
import type {SourceSnapshot} from './source.js';
import type {Facts} from './facts.js';
import {sourceGroups} from './plan.js';
export function knownReconciliation(source:SourceSnapshot,facts:Facts,now:string){
  const rows=source.rows,at=int64(now),groups=sourceGroups(source),edges=new Map<string,{bank_id:string;zen_id:string}>(),replacements=new Map<string,Set<string>>();
  const originals=new Map(rows.bank_processing.map(row=>[row.bank_id,row])),processing=new Map(rows.bank_processing.map(row=>[row.bank_id,{...row}])),originalDeliveries=new Map(rows.deliveries.map(row=>[row.bank_id,row])),deliveries=new Map(rows.deliveries.map(row=>[row.bank_id,{...row}]));
  const deleted=new Set(rows.zen_tombstones.filter(row=>row.kind==='transaction').map(row=>row.entity_id)),receipts=new Map<string,RowByTable['processing_receipts']>(),added=new Map<string,RowByTable['processing_receipts'][]>();
  const key=(bank:string,zen:string)=>JSON.stringify([bank,zen]);
  for(const row of rows.processing_receipts)receipts.set(key(row.bank_id,row.zen_id),row);
  for(const row of [...rows.deliveries,...rows.delivery_attempts,...rows.processing_receipts])edges.set(key(row.bank_id,row.zen_id),{bank_id:row.bank_id,zen_id:row.zen_id});
  for(const group of groups)for(const bank of group.banks)for(const zen of group.zens){
    edges.set(key(bank,zen),{bank_id:bank,zen_id:zen});if(group.origin==='duplicate_cleanup'){const set=replacements.get(bank)??new Set<string>();set.add(zen);replacements.set(bank,set);}
  }
  for(const delivery of deliveries.values())if(delivery.state!=='suppressed'&&deleted.has(delivery.zen_id)){delivery.state='suppressed';delivery.updated_at=at;}
  for(const {bank_id:bank,zen_id:zen}of [...edges.values()].sort((a,b)=>compareText(a.bank_id,b.bank_id)||compareText(a.zen_id,b.zen_id))){
    if(replacements.has(bank)&&!replacements.get(bank)!.has(zen))continue;
    const state=processing.get(bank),delivery=deliveries.get(bank);requireStorage(state,'storage_corrupt');
    if(deleted.has(zen)){
      if(state.state!=='suppressed'||state.reason!=='zenmoney_deleted'){state.state='suppressed';state.reason='zenmoney_deleted';state.updated_at=at;}
      if(delivery&&delivery.state!=='suppressed'){delivery.state='suppressed';delivery.updated_at=at;}
    }else if(facts.blockingTransactions.has(zen)&&state.state!=='suppressed'){
      const identity=key(bank,zen);if(!receipts.has(identity)){
        const row={bank_id:bank,zen_id:zen,origin:'mirror_exists',at};receipts.set(identity,row);const bucket=added.get(bank)??[];bucket.push(row);added.set(bank,bucket);
      }
      if(state.state!=='delivered'||state.reason!=='zenmoney_exists'){state.state='delivered';state.reason='zenmoney_exists';state.updated_at=at;}
      if(delivery?.zen_id===zen&&!['suppressed','delivered'].includes(delivery.state)){delivery.state='delivered';delivery.updated_at=at;}
    }
  }
  return [...processing].flatMap(([bank_id,state])=>{
    const delivery=deliveries.get(bank_id),changed=JSON.stringify(delivery)!==JSON.stringify(originalDeliveries.get(bank_id));
    return JSON.stringify(state)===JSON.stringify(originals.get(bank_id))&&!changed&&!added.has(bank_id)?[]:[{bank_id,processing:state,delivery:changed?delivery:undefined,receipts:added.get(bank_id)??[]}];
  });
}
