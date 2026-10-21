/** Explicit archive-only recovery. No peer receipt, financial SDK send or fallback. */
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import type {RuntimeControl,SentinelPort,DatasetSentinel} from '../../control/types.js';
import {datasetControl} from '../../control/validation.js';
import {participantUuid,requireParticipant} from '../../control/participant-wire.js';
import {readArchive} from '../portable/zip.js';
import {canonical,parseJson,validateManifest,TABLES} from '../portable/format.js';
import {FinancialDatabase} from './database.js';
import {readAnchor,assertAnchor} from './anchor.js';
import {int64,storageFailure} from './types.js';
import {participantControl} from './participant-validation.js';
import {encodeKey} from './cells.js';
import {confirmReplacement,verifyReplacement} from './inactive-replacement.js';
import {restoreIntent,restoreScope,assertRestoreScope} from './restore-control.js';
import type {RestoreIntent} from './restore-control.js';
import {stageArchive} from './staging.js';
import {validateStageGraph} from './graph-validation.js';
import {StageGraphReader} from './graph-reader.js';
import {stageRecord} from './stage-types.js';
import {restorePreview} from './restore-preview.js';
import type {ImportPermit} from './import-scope.js';
interface OwnerProof{ownerIds:readonly string[];sourceHash:string}
export interface RestorePorts{
  /** Fresh full SDK read using an independently protected credential reference. */
  verify(ref:string):Promise<OwnerProof&{raw:string}>;
  /** Re-read immutable protected credential metadata, without a financial send. */
  credential(ref:string):Promise<OwnerProof>;
  permission():Promise<boolean>;
}
export interface RestoreConsent{formerWritersRetired:boolean;acceptPostSnapshotEvidenceLoss:boolean;replaceInactiveLocalCopy?:boolean}
const increment=(value:string)=>int64(String(BigInt(value)+1n));
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export class RestoreOwner{
  private constructor(private db:FinancialDatabase,private port:SentinelPort,private ports:RestorePorts,private clock:()=>number){}
  static async open(name:string,port:SentinelPort,ports:RestorePorts,clock=()=>Date.now()/1000){
    const marker=await readAnchor(port),db=new FinancialDatabase(name,false);
    try{await db.open();await db.transaction('r',db.runtime,db.datasets,()=>assertAnchor(db,marker));return new RestoreOwner(db,port,ports,clock);}
    catch(error){db.close();throw storageFailure(error);}
  }
  close(){this.db.close();}
  #now(){const value=int64(String(Math.floor(this.clock())));requireParticipant(BigInt(value)>=0n&&BigInt(value)<=253402300799n);return value;}
  async #unit<T>(write:boolean,operation:(root:RuntimeControl,marker:DatasetSentinel)=>Promise<T>){
    const marker=await readAnchor(this.port);
    try{return await this.db.transaction(write?'rw':'r',this.db.tables,async()=>operation(await assertAnchor(this.db,marker),marker));}
    catch(error){if(error&&typeof error==='object'&&'code'in error)throw error;throw storageFailure(error);}
  }
  async #read(id:string){participantUuid(id);return restoreIntent((await this.db.applicationState.get(restoreScope(id)))?.value);}
  async #save(value:RestoreIntent){await this.db.applicationState.put({scope:restoreScope(value.id),value:restoreIntent(value) as unknown as Record<string,unknown>});}
  #fence(value:RestoreIntent){return {installationId:value.initialRoot.installationId,generation:value.generation,epoch:increment(value.initialRoot.epoch)};}
  #permit(value:RestoreIntent):ImportPermit{return {kind:'restore',switchId:value.id,participantId:value.participantId,nonce:value.nonce};}
  async #guard(value:RestoreIntent,marker:DatasetSentinel){requireParticipant((await this.#read(value.id)).credentialRef===value.credentialRef,'migration_busy');return assertRestoreScope(this.db,this.#fence(value),marker,this.#permit(value));}
  async current(){return this.#unit(false,async(_root,marker)=>{
    const id=(await this.db.applicationState.get('archive-restore-head'))?.value.id;
    return id===undefined?null:this.#read(participantUuid(id));
  });}
  async #empty(generation:string){
    for(const table of ['capture_jobs','bank_transactions','deliveries','processing_receipts','processing_targets'] as const)
      requireParticipant(await this.db.financial(table).where('generation').equals(generation).count()===0,'migration_not_empty');
    for(const key of ['sync_ever_started','migration_import_sha256','portable_imports'])
      requireParticipant(await this.db.financial('dataset_metadata').get([generation,encodeKey([['text',key]])])===undefined,'migration_not_empty');
  }
  async begin(id:string,blob:Blob,credentialRef:string,consent:RestoreConsent){
    participantUuid(id);participantUuid(credentialRef);
    requireParticipant(consent.formerWritersRetired===true&&consent.acceptPostSnapshotEvidenceLoss===true,'migration_paused');
    const initial=await this.#unit(false,async root=>root),archive=await readArchive(blob,{async manifest(){},async row(){}}),proof=await this.ports.verify(credentialRef),now=this.#now();
    requireParticipant(same(proof.ownerIds,archive.manifest.zenmoney_identity.owner_ids),'migration_wrong_account');
    await this.port.markFinancialActivity(initial.installationId);
    return this.#unit(true,async(root,marker)=>{
      const previous=(await this.db.applicationState.get(restoreScope(id)))?.value;
      if(previous){const value=restoreIntent(previous);requireParticipant(value.archiveSha256===archive.archiveSha256&&value.credentialRef===credentialRef);return value;}
      requireParticipant(same(root,initial)&&root.pendingSwitchId===null,'migration_busy');increment(increment(root.epoch));increment(root.credentialEpoch);
      for(const [head,prefix,terminal] of [['mode-switch-head','mode-switch:',['complete','cancelled']],['mode-join-head','mode-join:',['complete','cancelled']],
        ['local-backup-head','local-backup:',['ready','cancelled','cleaned']],['archive-restore-head','archive-restore:',['activated','cancelled']]] as const){
        const id=(await this.db.applicationState.get(head))?.value.id;
        if(typeof id==='string')requireParticipant(terminal.includes((await this.db.applicationState.get(prefix+id))?.value.phase as never),'migration_busy');
      }
      if(root.activeMode==='local'){
        const dataset=datasetControl(await this.db.datasets.get(root.activeGeneration!)),control=participantControl(await this.db.participants.get(dataset.participantId));
        requireParticipant(dataset.lifecycle==='active'&&dataset.holdId===null&&control.state==='active'&&!control.everActivated&&!control.awaitingSync,'migration_not_empty');
        await this.#empty(dataset.generation);
      }
      await confirmReplacement(this.db,id,consent.replaceInactiveLocalCopy===true);
      const manifest=archive.manifest,generation=crypto.randomUUID(),participantId=crypto.randomUUID();
      const value:RestoreIntent={version:'1',id,generation,participantId,nonce:crypto.randomUUID(),initialRoot:root,credentialRef,
        archiveSha256:archive.archiveSha256,archiveSize:blob.size,manifest:new TextDecoder().decode(canonical(manifest)),createdAt:now,phase:'loading',
        formerWritersRetired:true,acceptPostSnapshotEvidenceLoss:true,preview:null};
      await this.db.datasets.add({generation,datasetId:manifest.dataset_id,participantId,participantEpoch:int64('1'),logicalSchemaVersion:'1',lifecycle:'staging',
        ownerIds:[...manifest.zenmoney_identity.owner_ids],holdId:id,createdAt:now,backupAcknowledgedAt:null});
      await this.db.participants.add({id:participantId,generation,epoch:'1',state:'active',operationId:null,everActivated:false,awaitingSync:false});
      await this.#save(value);await this.db.applicationState.put({scope:'archive-restore-head',value:{id}});
      await this.db.runtime.put({...root,pendingSwitchId:id,epoch:increment(root.epoch),financialMayHaveStarted:true});return value;
    });
  }
  async load(id:string,blob:Blob){
    requireParticipant(blob instanceof Blob&&blob.size>0&&blob.size<=67108864,'migration_invalid');
    // The exact archive was fully checked before reservation. Recheck its digest
    // before cleanup; stageArchive independently validates all persisted facts.
    const checksum=bytesToHex(sha256(new Uint8Array(await blob.arrayBuffer())));
    const value=await this.#unit(true,async(_root,marker)=>{
      const value=await this.#read(id);requireParticipant(value.archiveSha256===checksum&&value.archiveSize===blob.size,'migration_invalid');
      await this.#guard(value,marker);if(['validated','preview'].includes(value.phase))return value;
      const next={...value,nonce:crypto.randomUUID(),preview:null};const dataset=datasetControl(await this.db.datasets.get(value.generation));
      await this.db.datasets.put({...dataset,lifecycle:'staging'});await this.#save(next);return next;
    });if(['validated','preview'].includes(value.phase))return value;
    // Rebuild only the unactivated recovery generation; no archived source row or
    // former writer is changed. New nonce revokes every previous loading handler.
    for(const table of TABLES)for(;;){
      const removed=await this.#unit(true,async(_root,marker)=>{
        await this.#guard(value,marker);const keys=await this.db.financial(table).where('generation').equals(value.generation).limit(500).primaryKeys();
        await this.db.financial(table).bulkDelete(keys);return keys.length;
      });if(!removed)break;
    }
    await this.#unit(true,async(_root,marker)=>{await this.#guard(value,marker);await this.db.stages.delete(value.generation);});
    await stageArchive(this.db,this.port,this.#fence(value),blob,this.#now(),this.#permit(value));
    await validateStageGraph(this.db,this.port,this.#fence(value),value.generation,this.#now(),this.#permit(value));
    return this.#unit(true,async(_root,marker)=>{await this.#guard(value,marker);const next={...await this.#read(id),phase:'validated' as const};await this.#save(next);return next;});
  }
  async preview(id:string){
    const value=await this.#unit(false,async(_root,marker)=>{const value=await this.#read(id);await this.#guard(value,marker);requireParticipant(['validated','preview'].includes(value.phase),'migration_incomplete');return value;});
    const proof=await this.ports.verify(value.credentialRef),now=this.#now(),reader=await StageGraphReader.open(this.db,this.port,this.#fence(value),value.generation,this.#permit(value));
    requireParticipant(same(proof.ownerIds,validateManifest(parseJson(new TextEncoder().encode(value.manifest))).zenmoney_identity.owner_ids),'migration_wrong_account');
    const summary=await restorePreview(reader,value,proof.raw,proof.sourceHash,now);
    return this.#unit(true,async(_root,marker)=>{await this.#guard(value,marker);const next={...await this.#read(id),phase:'preview' as const,preview:summary};await this.#save(next);return next;});
  }
  async activate(id:string,previewId:string,acceptSummary:boolean){
    participantUuid(previewId);requireParticipant(acceptSummary===true,'migration_paused');
    const value=await this.#unit(false,()=>this.#read(id));if(value.phase==='activated'){requireParticipant(value.preview?.id===previewId);return value;}
    requireParticipant(value.phase==='preview'&&value.preview?.id===previewId,'migration_incomplete');
    const proof=await this.ports.credential(value.credentialRef);requireParticipant(await this.ports.permission(),'permission_required');const now=this.#now();
    return this.#unit(true,async(root,marker)=>{
      await this.#guard(value,marker);const current=await this.#read(id);requireParticipant(current.phase==='preview'&&current.preview?.id===previewId,'migration_incomplete');
      requireParticipant(BigInt(now)>=BigInt(current.preview.checkedAt)&&BigInt(now)-BigInt(current.preview.checkedAt)<=300n&&proof.sourceHash===current.preview.sourceHash&&
        same(proof.ownerIds,validateManifest(parseJson(new TextEncoder().encode(current.manifest))).zenmoney_identity.owner_ids),'migration_wrong_account');
      await verifyReplacement(this.db,id);
      const stage=stageRecord(await this.db.stages.get(value.generation)),dataset=datasetControl(await this.db.datasets.get(value.generation));
      requireParticipant(stage.state==='graph_valid'&&stage.archiveSha256===value.archiveSha256&&stage.manifest===current.manifest&&stage.graphDigest===validateManifest(parseJson(new TextEncoder().encode(current.manifest))).dataset_digest,'migration_incomplete');
      if(root.activeGeneration!==null){const old=datasetControl(await this.db.datasets.get(root.activeGeneration));await this.db.datasets.put({...old,lifecycle:'retired'});}
      await this.db.stages.put(stageRecord({...stage,state:'activated'}));await this.db.datasets.put({...dataset,lifecycle:'active',holdId:null,participantEpoch:int64('2')});
      await this.db.participants.put({id:value.participantId,generation:value.generation,epoch:'2',state:'active',operationId:null,everActivated:true,awaitingSync:true});
      await this.db.runtime.put({...root,activeMode:'local',activeGeneration:value.generation,pendingSwitchId:null,credentialRef:value.credentialRef,
        credentialEpoch:increment(root.credentialEpoch),epoch:increment(root.epoch),financialMayHaveStarted:true});
      const next={...current,phase:'activated' as const};await this.#save(next);return next;
    });
  }
  async cancel(id:string){return this.#unit(true,async(root,marker)=>{
    const value=await this.#read(id);if(value.phase==='cancelled')return value;requireParticipant(value.phase!=='activated','migration_paused');await this.#guard(value,marker);
    const dataset=datasetControl(await this.db.datasets.get(value.generation)),stage=await this.db.stages.get(value.generation);
    await this.db.datasets.put({...dataset,lifecycle:'discarded',holdId:null});
    if(stage)await this.db.stages.put(stageRecord({...stage,state:'discarded',graphVersion:null,graphDigest:null,graphVerifiedAt:null}));
    await this.db.runtime.put({...root,pendingSwitchId:null,epoch:increment(root.epoch)});
    const next={...value,phase:'cancelled' as const,nonce:crypto.randomUUID()};await this.#save(next);return next;
  });}
}
