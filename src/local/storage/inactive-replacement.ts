/** User-confirmed inactive copies are backed up, never merged or reactivated. */
import type {FinancialDatabase} from './database.js';
import {datasetControl} from '../../control/validation.js';
import {requireParticipant,participantUuid} from '../../control/participant-wire.js';
import {encodeKey} from './cells.js';
import {inactiveBackupEvidence} from './backup-evidence.js';
export interface InactiveCopy{generation:string;datasetId:string;backupId:string|null;archiveSha256:string|null;datasetDigest:string|null}
export async function inactiveCopies(db:FinancialDatabase,preferred?:ReadonlyMap<string,string>):Promise<InactiveCopy[]>{
  const backups=await db.applicationState.where('scope').startsWith('local-backup:').toArray(),result:InactiveCopy[]=[];
  for(const raw of await db.datasets.where('lifecycle').equals('retired').toArray()){
    const dataset=datasetControl(raw);let history=false;
    for(const table of ['bank_transactions','capture_jobs','deliveries','processing_receipts','processing_targets'] as const)
      if(await db.financial(table).where('generation').equals(dataset.generation).count()){history=true;break;}
    for(const key of ['sync_ever_started','migration_import_sha256','portable_imports'])
      if(await db.financial('dataset_metadata').get([dataset.generation,encodeKey([['text',key]])]))history=true;
    if(!history)continue;
    const backup=backups.map(row=>row.value).find(row=>(preferred===undefined||row.id===preferred.get(dataset.generation))&&row.generation===dataset.generation&&row.datasetId===dataset.datasetId&&row.held===false&&
      ['ready','cleaned'].includes(row.phase as string)&&typeof row.acknowledgedAt==='string'&&typeof row.sha256==='string'&&row.manifest!==null);
    result.push(backup?inactiveBackupEvidence(backup):{generation:dataset.generation,datasetId:dataset.datasetId,backupId:null,archiveSha256:null,datasetDigest:null});
  }
  return result.sort((a,b)=>a.generation.localeCompare(b.generation));
}
export async function confirmReplacement(db:FinancialDatabase,id:string,consent:boolean){
  participantUuid(id);const copies=await inactiveCopies(db);
  if(copies.length){requireParticipant(consent===true,'migration_paused');requireParticipant(copies.every(copy=>copy.backupId!==null&&copy.archiveSha256!==null&&copy.datasetDigest!==null),'migration_incomplete');}
  await db.applicationState.add({scope:'local-replacement:'+id,value:{id,confirmed:consent,copies}});
}
export async function verifyReplacement(db:FinancialDatabase,id:string){
  const decision=(await db.applicationState.get('local-replacement:'+participantUuid(id)))?.value;
  if(decision===undefined){requireParticipant((await inactiveCopies(db)).length===0,'migration_paused');return;}
  requireParticipant(Array.isArray(decision.copies),'migration_invalid');
  const accepted=decision.copies as InactiveCopy[],preferred=new Map<string,string>();
  for(const copy of accepted){participantUuid(copy.generation);participantUuid(copy.backupId);preferred.set(copy.generation,copy.backupId!);}
  const copies=await inactiveCopies(db,preferred);if(!copies.length){requireParticipant(accepted.length===0,'migration_paused');return;}
  requireParticipant(decision.id===id&&decision.confirmed===true&&JSON.stringify(accepted)===JSON.stringify(copies),'migration_paused');
}
