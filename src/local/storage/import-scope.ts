/** Private migration permit, checked against durable ownership on every batch. */
import type {ContextFence,DatasetSentinel} from '../../control/types.js';
import {datasetControl} from '../../control/validation.js';
import type {FinancialDatabase} from './database.js';
import {assertAnchor} from './anchor.js';
import {participantControl} from './participant-validation.js';
import {requireStorage} from './types.js';
export interface ImportPermit{readonly switchId:string;readonly participantId:string;readonly nonce:string}
export const scopeTables=(db:FinancialDatabase)=>[db.runtime,db.datasets,db.participants,db.migrationOperations,db.switches];
export async function assertImportScope(db:FinancialDatabase,fence:ContextFence,marker:DatasetSentinel,permit?:ImportPermit){
  const root=await assertAnchor(db,marker);
  requireStorage(root.installationId===fence.installationId&&root.epoch===fence.epoch,'stale_epoch');
  if(permit){
    const control=participantControl(await db.participants.get(permit.participantId));
    const op=await db.migrationOperations.get([permit.participantId,permit.switchId]);
    const transfer=await db.switches.get(permit.switchId);
    const dataset=datasetControl(await db.datasets.get(fence.generation));
    requireStorage(root.pendingSwitchId===permit.switchId&&root.activeGeneration!==fence.generation&&
      control.generation===fence.generation&&['import_hold','armed'].includes(control.state)&&control.operationId===permit.switchId&&
      op!==undefined&&op.role==='destination'&&op.generation===fence.generation&&op.importNonce===permit.nonce&&
      dataset.participantId===control.id&&dataset.participantEpoch===control.epoch&&dataset.holdId===permit.switchId&&
      ['staging','validated','armed'].includes(dataset.lifecycle)&&!control.everActivated&&
      transfer?.generation===fence.generation&&transfer.role==='destination'&&transfer.state==='pending','stale_epoch');
  }else{
    requireStorage(root.activeMode==='local'&&root.activeGeneration===fence.generation&&root.pendingSwitchId===null,'stale_epoch');
    const active=datasetControl(await db.datasets.get(fence.generation));
    requireStorage(active.lifecycle==='active'&&active.holdId===null,'dataset_not_writable');
  }
  return root;
}
