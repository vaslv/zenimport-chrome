/** Immutable loss-detection anchor; the transactional root selects the writer. */
import type {DatasetSentinel,SentinelPort} from '../../control/types.js';
import {datasetControl,runtimeControl} from '../../control/validation.js';
import type {FinancialDatabase} from './database.js';
import {requireStorage} from './types.js';

export async function readAnchor(port:SentinelPort,installationId?:string,activity=false):Promise<DatasetSentinel>{
  const marker=await port.read();
  requireStorage(marker!==null&&marker.state==='ready'&&(!activity||marker.financialMayHaveStarted)&&
    (installationId===undefined||marker.installationId===installationId),'recovery_required');return marker;
}
/** Call inside a transaction containing runtime/datasets; never reconstruct it. */
export async function assertAnchor(db:FinancialDatabase,marker:DatasetSentinel){
  const root=runtimeControl(await db.runtime.get('runtime'));
  requireStorage(root.installationId===marker.installationId&&await db.runtime.count()===1,'recovery_required');
  const raw=await db.datasets.get(marker.generation);requireStorage(raw!==undefined,'recovery_required');
  const anchor=datasetControl(raw);requireStorage(anchor.datasetId===marker.datasetId,'recovery_required');
  requireStorage(!root.financialMayHaveStarted||marker.financialMayHaveStarted,'recovery_required');return root;
}
