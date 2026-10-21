/** Rebuildable category rows from one exact, immutable source snapshot. */
import {buildCategoryEvidence,categoryContext,predictCategory} from '../../domain/prediction/categories.js';
import {canonicalStoredDto} from '../../domain/codec.js';
import {sourceGroups} from './plan.js';
import {sourceFresh} from './freshness.js';
import type {SourceSnapshot} from './source.js';
import type {Facts} from './facts.js';
import type {RowByTable} from '../storage/schema.generated.js';
import {int64,requireStorage} from '../storage/types.js';
export function categoryModel(source:SourceSnapshot,facts:Facts){
  const rows=source.rows,states=new Map(rows.bank_processing.map(row=>[row.bank_id,row.state])),bindings=new Map<string,Set<string>>();
  function bind(bank:string,target:string){const set=bindings.get(bank)??new Set<string>();set.add(target);bindings.set(bank,set);}
  for(const row of rows.account_bindings)bind(row.account_id,row.zenmoney_account_id);
  for(const row of rows.bank_accounts)if(row.zenmoney_account_id!==null)bind(row.id,row.zenmoney_account_id);
  const banks=[...facts.banks.values()],accounts=new Map([...(facts.entities.get('account')??[])].map(([id,row])=>[id,{type:typeof row.type==='string'?row.type:''}]));
  const deliveries=new Map(rows.deliveries.map(row=>[row.bank_id,row.zen_id])),groups=sourceGroups(source),evidence=buildCategoryEvidence({
    banks:banks.filter(bank=>states.get(bank.id)==='delivered'),bankExclusions:new Set(rows.bank_exclusions.map(row=>row.bank_id)),zenExclusions:new Set(rows.zen_exclusions.map(row=>row.zen_id)),
    tags:facts.tags,transactions:facts.reviewed,accounts,instruments:facts.instruments,bindings,groups,receipts:rows.processing_receipts,deliveries});
  const rules=rows.recipient_rules.map((row):{bank:string;direction:'income'|'expense';name:string;category_id:string}=>{requireStorage(row.direction==='income'||row.direction==='expense','storage_corrupt');return {...row,direction:row.direction};});
  const context=categoryContext({tags:facts.tags,banks,payments:evidence.payments,rules,manual:new Map(rows.category_choices.filter(row=>row.source==='manual').map(row=>[row.bank_id,row.category_id]))});
  return {evidence,context};
}
export function categoryPlan(source:SourceSnapshot,facts:Facts,now:string){
  const {evidence,context}=categoryModel(source,facts),rows=source.rows,banks=[...facts.banks.values()],states=new Map(rows.bank_processing.map(row=>[row.bank_id,row.state]));
  const attempted=new Set(rows.deliveries.filter(row=>row.ever_attempted==='1').map(row=>row.bank_id)),fresh=sourceFresh(source,now),generation=rows.zen_mirror_state[0]?.generation;
  requireStorage(generation!==undefined,'storage_corrupt');const predictions:RowByTable['category_predictions'][]=[];
  for(const bank of banks)if(['pending','prepared'].includes(states.get(bank.id)??'')&&!attempted.has(bank.id)){
    const prediction=predictCategory(bank,context,fresh);predictions.push({bank_id:bank.id,bank_revision:int64(bank.revision),category_id:prediction.category_id,source:prediction.source,reason:prediction.reason,
      candidates_json:canonicalStoredDto(prediction.candidates),mirror_generation:generation,updated_at:int64(now)});
  }
  return {
    evidence:evidence.evidence.map(row=>({...row,eligible:int64(row.eligible?'1':'0')})),
    payments:evidence.payments.map(({zen_ids,...row})=>({...row,eligible:int64(row.eligible?'1':'0'),zen_ids_json:canonicalStoredDto(zen_ids)})),predictions,
  };
}
