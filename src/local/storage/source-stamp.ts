/** Private optimistic consistency token, never bank-page or popup input. */
import type {RuntimeControl} from '../../control/types.js';
import {datasetControl} from '../../control/validation.js';
import type {FinancialDatabase} from './database.js';
import type {RepositorySession} from './kernel.js';
import {financialRevision} from './revisions.js';
import {mirrorScope} from './mirror-scope.js';
import {int64,requireStorage} from './types.js';
export interface FinancialSnapshot{
  generation:string;epoch:string;credentialEpoch:string;credentialRef:string|null;
  participantId:string;participantEpoch:string;revision:string;projection:string;mirror:string;mirrorControl:string;
}
export async function financialStamp(db:FinancialDatabase,root:RuntimeControl,view:RepositorySession):Promise<FinancialSnapshot>{
  requireStorage(root.activeGeneration!==null,'stale_epoch');const generation=root.activeGeneration,dataset=datasetControl(await db.datasets.get(generation));
  const mirror=await view.get('zen_mirror_state',[['integer',int64('1')]]);
  return {generation,epoch:root.epoch,credentialEpoch:root.credentialEpoch,credentialRef:root.credentialRef,
    participantId:dataset.participantId,participantEpoch:dataset.participantEpoch,revision:await financialRevision(db,generation),
    projection:await mirrorScope(db,generation),mirror:JSON.stringify(mirror),mirrorControl:JSON.stringify((await db.applicationState.get('mirror:'+generation))?.value??null)};
}
