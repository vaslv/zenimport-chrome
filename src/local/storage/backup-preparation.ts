/** Durable pre-snapshot quiescence. It carries intent, never writer authority. */
import type {FinancialDatabase} from './database.js';
import type {RuntimeControl} from '../../control/types.js';
import {runtimeControl} from '../../control/validation.js';
import {participantUuid,requireParticipant} from '../../control/participant-wire.js';
export interface BackupPreparation{version:'1';id:string;generation:string;initialRoot:RuntimeControl;phase:'quiescing'|'complete'|'cancelled'}
export const backupPreparationScope=(id:string)=>'backup-preparation:'+id;
export const backupPreparationHead='backup-preparation-head';
export function backupPreparation(input:unknown):BackupPreparation{
  requireParticipant(input!==null&&typeof input==='object'&&!Array.isArray(input));const v=input as BackupPreparation;
  requireParticipant(Object.keys(v).sort().join(',')==='generation,id,initialRoot,phase,version'&&v.version==='1'&&['quiescing','complete','cancelled'].includes(v.phase));
  participantUuid(v.id);participantUuid(v.generation);const root=runtimeControl(v.initialRoot);
  requireParticipant(root.activeMode==='local'&&root.activeGeneration===v.generation&&root.pendingSwitchId===null);return structuredClone(v);
}
export async function currentBackupPreparation(db:FinancialDatabase){
  const id=(await db.applicationState.get(backupPreparationHead))?.value.id;
  return id===undefined?null:backupPreparation((await db.applicationState.get(backupPreparationScope(participantUuid(id))))?.value);
}
export async function assertNoBackupPreparation(db:FinancialDatabase,permit?:string){
  const value=await currentBackupPreparation(db);
  requireParticipant(value===null||value.phase!=='quiescing'||value.id===permit,'migration_busy');
}
