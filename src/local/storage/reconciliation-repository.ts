/** Persist complete matching facts in small, revision-fenced native transactions. */
import type {ContextFence,SentinelPort} from '../../control/types.js';
import {RepositoryOwner} from './repository-owner.js';
import type {RepositorySession} from './kernel.js';
import {readSource} from '../reconciliation/source.js';
import {sourceFacts} from '../reconciliation/facts.js';
import {knownReconciliation} from '../reconciliation/known.js';
import {sourceFresh} from '../reconciliation/freshness.js';
import {planReconciliation} from '../reconciliation/plan.js';
import type {ReconcileChoice} from '../reconciliation/plan.js';
import type {TargetProof} from '../../domain/reconciliation/ownership.js';
import {requireStorage,int64} from './types.js';
import {CaptureError,requireCapture} from '../capture/errors.js';
const text=(value:string)=>['text',value] as const;
async function remember(view:RepositorySession,proof:TargetProof){
  const key=[text(proof.bank_id),text(proof.zen_id)],old=await view.get('processing_targets',key);
  if(old)requireStorage(old.target_id===proof.target_id,'invariant_violation');else await view.insert('processing_targets',{...proof,at:int64(proof.at)});
}
async function delivered(view:RepositorySession,bank:string,origin:string,now:string){
  const pending=await view.find('deliveries',['bank_id'],[text(bank)]);
  if(pending){requireStorage(pending.ever_attempted==='0','invariant_violation');await view.remove('deliveries',[text(pending.zen_id)]);}
  const state=await view.get('bank_processing',[text(bank)]);requireStorage(state,'storage_corrupt');
  await view.replace('bank_processing',[text(bank)],{...state,state:'delivered',reason:'existing_'+origin,updated_at:int64(now)});
}
export class ReconciliationRepository{
  private constructor(private owner:RepositoryOwner){}
  static async open(name:string,sentinel:SentinelPort,fence:ContextFence){return new ReconciliationRepository(await RepositoryOwner.open(name,sentinel,fence));}
  async run(choices:readonly ReconcileChoice[],now:string){
    int64(now);let source=await readSource(this.owner),facts=sourceFacts(source);
    if(!sourceFresh(source,now))throw new CaptureError('zenmoney_unavailable',true);
    const current=await this.owner.knownMirrorCurrent(source.stamp),known=current?[]:knownReconciliation(source,facts,now);let knownStamp=source.stamp;
    for(const fact of known)for(let offset=0;offset<Math.max(1,fact.receipts.length);offset+=200)knownStamp=(await this.owner.apply(knownStamp,async view=>{
      // Imported groups can have many explicit UUIDs. Each bounded receipt page
      // publishes the same final bank/delivery state, never an intermediate one.
      for(const receipt of fact.receipts.slice(offset,offset+200))await view.insert('processing_receipts',receipt);
      if(fact.delivery)await view.replace('deliveries',[text(fact.delivery.zen_id)],fact.delivery);
      await view.replace('bank_processing',[text(fact.bank_id)],fact.processing);
    })).stamp;
    if(known.length){source=await readSource(this.owner);requireStorage(JSON.stringify(source.stamp)===JSON.stringify(knownStamp),'stale_epoch');facts=sourceFacts(source);}
    const states=new Map(source.rows.bank_processing.map(row=>[row.bank_id,row.state]));
    for(const choice of choices)requireCapture(facts.banks.has(choice.bank_id),'not_found');
    // A retry after a committed fact never changes terminal history. The delivery
    // scheduler supplies only validated authorized revisions for new candidates.
    const pending=choices.filter(choice=>['pending','prepared'].includes(states.get(choice.bank_id)??''));
    const plan=planReconciliation(source,facts,pending,now);let stamp=source.stamp;
    for(const proof of plan.proofs)stamp=(await this.owner.apply(stamp,view=>remember(view,proof))).stamp;
    for(const [bank,[zen,origin]]of plan.singles){
      stamp=(await this.owner.apply(stamp,async view=>{
        await remember(view,{bank_id:bank,zen_id:zen,target_id:plan.targets.get(bank)!,origin,at:now});
        await view.insert('processing_receipts',{bank_id:bank,zen_id:zen,origin,at:int64(now)});await delivered(view,bank,origin,now);
      })).stamp;
    }
    for(const group of plan.groups){
      stamp=(await this.owner.apply(stamp,async view=>{
        for(const bank of group.banks)for(const zen of group.zens)await remember(view,{bank_id:bank,zen_id:zen,target_id:plan.targets.get(bank)!,origin:'day_amount_group',at:now});
        const id=crypto.randomUUID();await view.insert('link_groups',{id,kind:group.kind,account_id:group.account_id,created_at:int64(now),origin:'day_amount_group'});
        for(const bank of group.banks)await view.insert('link_bank_members',{group_id:id,bank_id:bank});
        for(const zen of group.zens)await view.insert('link_zen_members',{group_id:id,zen_id:zen});
        for(const bank of group.banks)await delivered(view,bank,'day_amount_group',now);
      })).stamp;
    }
    // Own new matches already prove their identity against this source. Publish
    // only the final revision, so any later external explicit edge invalidates it.
    await this.owner.confirmKnownMirror(stamp);
    return {recognized:[...plan.recognized],blocked:[...plan.blocked],proofs:plan.proofs.length,stamp};
  }
  close(){this.owner.close();}
}
