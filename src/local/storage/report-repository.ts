/** Read-only named report owner. Delivery state is deliberately not a prerequisite. */
import type {ContextFence,SentinelPort} from '../../control/types.js';
import {RepositoryOwner} from './repository-owner.js';
import {readSource} from '../reconciliation/source.js';
import {sourceFacts} from '../reconciliation/facts.js';
import {buildReport} from '../reports/build.js';
import type {ReportRequest} from '../reports/build.js';
export class ReportRepository{
  private constructor(private owner:RepositoryOwner){}
  static async open(name:string,sentinel:SentinelPort,fence:ContextFence){return new ReportRepository(await RepositoryOwner.open(name,sentinel,fence));}
  async build(request:ReportRequest,now:string){
    const source=await readSource(this.owner),result=buildReport(source,sourceFacts(source),request,now);
    await this.owner.check(source.stamp);return result;
  }
  close(){this.owner.close();}
}
