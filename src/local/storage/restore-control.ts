/** Archive-only recovery decisions are separate from bilateral migration proofs. */
import type {RuntimeControl,ContextFence,DatasetSentinel} from '../../control/types.js';
import {runtimeControl,datasetControl} from '../../control/validation.js';
import {participantUuid,participantDigest,requireParticipant} from '../../control/participant-wire.js';
import {validateManifest,parseJson} from '../portable/format.js';
import type {FinancialDatabase} from './database.js';
import {assertAnchor} from './anchor.js';
import {participantControl} from './participant-validation.js';
import {int64} from './types.js';
export interface RestorePreview{
  id:string;archiveSha256:string;sdkSha256:string;cursor:string;sourceHash:string;checkedAt:string;
  bankTransactions:string;zenTransactions:string;missingBank:number;extraZen:number;uncheckedAccounts:number;
}
export interface RestoreIntent{
  version:'1';id:string;generation:string;participantId:string;nonce:string;initialRoot:RuntimeControl;
  credentialRef:string;archiveSha256:string;archiveSize:number;manifest:string;createdAt:string;
  phase:'loading'|'validated'|'preview'|'activated'|'cancelled';
  formerWritersRetired:true;acceptPostSnapshotEvidenceLoss:true;preview:RestorePreview|null;
}
export const restoreScope=(id:string)=>'archive-restore:'+id;
// Only the exact immutable text is cached; no mutable proof/authority is cached.
// One bounded manifest avoids reparsing every graph foreign-key lookup.
let validatedManifestText:string|null=null;
let validatedManifest:ReturnType<typeof validateManifest>|null=null;
function checkManifest(text:string){
  if(validatedManifestText===text&&validatedManifest!==null)return validatedManifest;
  const manifest=validateManifest(parseJson(new TextEncoder().encode(text)));
  validatedManifest=manifest;validatedManifestText=text;return manifest;
}

export function restoreIntent(input:unknown):RestoreIntent{
  requireParticipant(input!==null&&typeof input==='object'&&!Array.isArray(input));const value=input as RestoreIntent;
  const keys='acceptPostSnapshotEvidenceLoss,archiveSha256,archiveSize,createdAt,credentialRef,formerWritersRetired,generation,id,initialRoot,manifest,nonce,participantId,phase,preview,version';
  requireParticipant(Object.keys(value).sort().join(',')===keys&&value.version==='1'&&value.formerWritersRetired===true&&value.acceptPostSnapshotEvidenceLoss===true);
  for(const id of [value.id,value.generation,value.participantId,value.nonce,value.credentialRef])participantUuid(id);
  participantDigest(value.archiveSha256);const root=runtimeControl(value.initialRoot);requireParticipant(root.pendingSwitchId===null);
  requireParticipant(BigInt(int64(value.createdAt))>=0n&&BigInt(value.createdAt)<=253402300799n&&Number.isSafeInteger(value.archiveSize)&&value.archiveSize>0&&value.archiveSize<=67108864);
  requireParticipant(['loading','validated','preview','activated','cancelled'].includes(value.phase)&&typeof value.manifest==='string'&&value.manifest.length<=1048576);
  checkManifest(value.manifest);
  if(value.preview!==null){
    const proof=value.preview;requireParticipant(Object.keys(proof).sort().join(',')==='archiveSha256,bankTransactions,checkedAt,cursor,extraZen,id,missingBank,sdkSha256,sourceHash,uncheckedAccounts,zenTransactions');
    participantUuid(proof.id);for(const hash of [proof.archiveSha256,proof.sdkSha256,proof.sourceHash])participantDigest(hash);
    requireParticipant(proof.archiveSha256===value.archiveSha256);
    for(const key of ['checkedAt','cursor','bankTransactions','zenTransactions'] as const)requireParticipant(BigInt(int64(proof[key]))>=0n);
    for(const n of [proof.missingBank,proof.extraZen,proof.uncheckedAccounts])requireParticipant(Number.isSafeInteger(n)&&n>=0);
  }
  requireParticipant(value.phase!=='preview'||value.preview!==null);return structuredClone(value);
}
export async function assertRestoreScope(db:FinancialDatabase,fence:ContextFence,marker:DatasetSentinel,permit:{switchId:string;participantId:string;nonce:string}){
  const root=await assertAnchor(db,marker),value=restoreIntent((await db.applicationState.get(restoreScope(permit.switchId)))?.value);
  requireParticipant(['loading','validated','preview'].includes(value.phase)&&value.generation===fence.generation&&value.participantId===permit.participantId&&value.nonce===permit.nonce,'migration_paused');
  const expected={...value.initialRoot,pendingSwitchId:value.id,epoch:int64(String(BigInt(value.initialRoot.epoch)+1n)),financialMayHaveStarted:root.financialMayHaveStarted};
  requireParticipant(root.financialMayHaveStarted&&JSON.stringify(root)===JSON.stringify(expected)&&root.epoch===fence.epoch&&root.installationId===fence.installationId,'migration_paused');
  const dataset=datasetControl(await db.datasets.get(value.generation)),control=participantControl(await db.participants.get(value.participantId));
  const manifest=checkManifest(value.manifest);
  requireParticipant(dataset.datasetId===manifest.dataset_id&&JSON.stringify(dataset.ownerIds)===JSON.stringify(manifest.zenmoney_identity.owner_ids)&&
    root.activeGeneration!==value.generation&&dataset.participantId===value.participantId&&dataset.holdId===value.id&&['staging','validated'].includes(dataset.lifecycle)&&
    control.generation===value.generation&&control.epoch===dataset.participantEpoch&&control.state==='active'&&!control.everActivated&&!control.awaitingSync,'migration_paused');return root;
}
