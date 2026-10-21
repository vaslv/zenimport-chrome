/** Derived cache builds are bounded and invisible until one atomic publication. */
import type {ContextFence,SentinelPort} from '../../control/types.js';
import {RepositoryOwner} from './repository-owner.js';
import {readSource} from '../reconciliation/source.js';
import {sourceFacts} from '../reconciliation/facts.js';
import {categoryPlan} from '../reconciliation/categories.js';
import {sourceFresh} from '../reconciliation/freshness.js';
import {CaptureError} from '../capture/errors.js';
import {int64} from './types.js';
import type {RowByTable} from './schema.generated.js';
const text=(value:string)=>['text',value] as const;
export class CategoryRepository{
  private constructor(private owner:RepositoryOwner){}
  static async open(name:string,sentinel:SentinelPort,fence:ContextFence){return new CategoryRepository(await RepositoryOwner.open(name,sentinel,fence));}
  async build(now:string){
    int64(now);const source=await readSource(this.owner);if(!sourceFresh(source,now))throw new CaptureError('zenmoney_unavailable',true);
    if(await this.owner.categoriesReady(source.stamp))return {reused:true};
    const plan=categoryPlan(source,sourceFacts(source),now),id=crypto.randomUUID(),counts={category_evidence:plan.evidence.length,category_payments:plan.payments.length,category_predictions:plan.predictions.length};
    await this.owner.beginCategories(source.stamp,id,counts);let stamp=source.stamp;
    for(const table of ['category_evidence','category_payments'] as const)for(;;){
      const unit=await this.owner.categoryUnit(stamp,id,async view=>{
        const page=await view.page(table,null,200);
        for(const row of page.rows)await view.remove(table,table==='category_evidence'?[text(row.bank_id),text((row as RowByTable['category_evidence']).zen_id),text(row.category_id!)]:[text(row.bank_id)]);
        return page.rows.length;
      });stamp=unit.stamp;if(!unit.result)break;
    }
    const eligible=new Set(plan.predictions.map(row=>row.bank_id));let after:string|null=null;
    for(;;){
      const unit=await this.owner.categoryUnit(stamp,id,async view=>{
        const page:{after:string|null;rows:RowByTable['category_predictions'][]}=await view.page('category_predictions',after,200);
        for(const row of page.rows)if(!eligible.has(row.bank_id))await view.remove('category_predictions',[text(row.bank_id)]);return page;
      });stamp=unit.stamp;if(unit.result.rows.length<200)break;after=unit.result.after;
    }
    for(let offset=0;offset<plan.evidence.length;offset+=200)stamp=(await this.owner.categoryUnit(stamp,id,async view=>{
      for(const row of plan.evidence.slice(offset,offset+200))await view.insert('category_evidence',row);
    })).stamp;
    for(let offset=0;offset<plan.payments.length;offset+=200)stamp=(await this.owner.categoryUnit(stamp,id,async view=>{
      for(const row of plan.payments.slice(offset,offset+200))await view.insert('category_payments',row);
    })).stamp;
    for(let offset=0;offset<plan.predictions.length;offset+=200)stamp=(await this.owner.categoryUnit(stamp,id,async view=>{
      const rows=plan.predictions.slice(offset,offset+200),keys=rows.map(row=>[text(row.bank_id)]),previous=await view.getMany('category_predictions',keys),deliveries=await view.findMany('deliveries',['bank_id'],keys);
      for(let i=0;i<rows.length;i++){
        const row=rows[i],old=previous[i],delivery=deliveries[i];
        if((old===null||old.bank_revision!==row.bank_revision||old.category_id!==row.category_id)&&delivery?.state==='prepared'&&delivery.ever_attempted==='0'&&delivery.needs_rebuild!=='1'){
          // This flag cannot alter evidence or prediction inputs. Its source
          // revision advances atomically with this cache row and build token.
          await view.replace('deliveries',[text(delivery.zen_id)],{...delivery,needs_rebuild:int64('1')});
        }
        if(old)await view.replace('category_predictions',[text(row.bank_id)],row);else await view.insert('category_predictions',row);
      }
    })).stamp;
    await this.owner.completeCategories(stamp,id);return {reused:false,counts};
  }
  close(){this.owner.close();}
}
