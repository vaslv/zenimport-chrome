import {readOutbox} from './outbox-control.js';
/** Existing-store control owner. Never exposed to bank/page messages. */
import Dexie from 'dexie';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import type {SentinelPort,DatasetSentinel,RuntimeControl,DatasetControl} from '../../control/types.js';
import {datasetControl,runtimeControl} from '../../control/validation.js';
import {ParticipantError,participantInteger,participantUuid,requireParticipant,canonicalParticipant,checkPeerReceipt} from '../../control/participant-wire.js';
import type {ParticipantReceipt,PeerReceiptCommand} from '../../control/participant-wire.js';
import {FinancialDatabase} from './database.js';
import {readAnchor,assertAnchor} from './anchor.js';
import {int64,requireStorage} from './types.js';
import {participantControl} from './participant-validation.js';
import {participantRequest,participantTransition,receiptOperation} from './participant-transition.js';
import type {ParticipantCommand,ParticipantOperation,ParticipantReceiptRow,ParticipantControl,ModeSwitch} from './participant-model.js';
import {TABLES,canonical} from '../portable/format.js';
import {createArchive,readArchive} from '../portable/zip.js';
import {validateFinancialGraph} from '../portable/graph.js';
import {HeldReader} from './held-reader.js';
import {packRow} from './cells.js';
import {stageArchive} from './staging.js';
import {stageRecord} from './stage-types.js';
import {validateStageGraph} from './graph-validation.js';
import type {ImportPermit} from './import-scope.js';
import {assertImportScope,scopeTables} from './import-scope.js';

export interface PeerStatus{
  readonly installation_id:string;readonly participant_epoch:string;readonly state:string;
  readonly operation:{readonly state:string}|null;readonly receipts:readonly ParticipantReceipt[];
}
export interface MigrationPorts{
  /** Must use an authenticated peer transport, not a page-supplied assertion. */
  readPeer(participantId:string,switchId:string):Promise<PeerStatus>;
  /** Fresh SDK read with the independently stored local credential reference. */
  verifyOwner(credentialRef:string):Promise<{ownerIds:readonly string[];sourceHash:string}>;
}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const sameWire=(a:unknown,b:unknown)=>new TextDecoder().decode(canonicalParticipant(a))===new TextDecoder().decode(canonicalParticipant(b));
const hash=(bytes:Uint8Array)=>bytesToHex(sha256(bytes));
const increment=(value:string)=>int64((participantInteger(value)+1n).toString());
const peerCommand:Partial<Record<ParticipantCommand,PeerReceiptCommand>>={destination_start:'source_seal',source_handoff:'destination_arm',
  destination_discard:'source_cancel',source_resume:'destination_discard',destination_activate:'source_handoff'};
interface OwnerSnapshot{root:RuntimeControl;control:ParticipantControl;dataset:DatasetControl;operation:ParticipantOperation|null;transfer:ModeSwitch|null}

export class MigrationOwner{
  #db:FinancialDatabase;#port:SentinelPort;#ports:MigrationPorts;
  private constructor(db:FinancialDatabase,port:SentinelPort,ports:MigrationPorts){this.#db=db;this.#port=port;this.#ports=ports;}
  static async open(name:string,port:SentinelPort,ports:MigrationPorts){
    const anchor=await readAnchor(port);requireStorage(await Dexie.exists(name),'recovery_required');
    const db=new FinancialDatabase(name,false);
    try{await db.open();await db.transaction('r',db.runtime,db.datasets,()=>assertAnchor(db,anchor));return new MigrationOwner(db,port,ports);}
    catch(error){db.close();throw error;}
  }
  close(){this.#db.close();}
  async #anchor(){return readAnchor(this.#port);}
  async #snapshot(participantId:string,switchId:string):Promise<OwnerSnapshot>{
    participantUuid(participantId);participantUuid(switchId);const anchor=await this.#anchor();
    return this.#db.transaction('r',this.#db.tables,async()=>{
      const root=await assertAnchor(this.#db,anchor),control=participantControl(await this.#db.participants.get(participantId));
      const dataset=datasetControl(await this.#db.datasets.get(control.generation));
      requireStorage(dataset.participantId===control.id&&dataset.participantEpoch===control.epoch,'storage_corrupt');
      const operation=await this.#db.migrationOperations.get([participantId,switchId])??null;
      const transfer=await this.#db.switches.get(switchId)??null;
      return {root,control,dataset,operation,transfer};
    });
  }
  async status(participantId:string,switchId:string){
    participantUuid(participantId);participantUuid(switchId);const anchor=await this.#anchor();
    return this.#db.transaction('r',this.#db.tables,async()=>{
    await assertAnchor(this.#db,anchor);const control=participantControl(await this.#db.participants.get(participantId));
    const op=await this.#db.migrationOperations.get([participantId,switchId]);
    const receipts=await this.#db.migrationReceipts.where('[participantId+switchId]').equals([participantId,switchId]).toArray();
    receipts.sort((a,b)=>BigInt(a.receipt.participant_epoch)<BigInt(b.receipt.participant_epoch)?-1:1);
    return {installation_id:control.id,participant_epoch:control.epoch,state:control.state,operation_id:control.operationId,awaiting_sync:control.awaitingSync,
      operation:op?{...receiptOperation(op),state:op.state,role:op.role,peer_epoch:op.peerEpoch,validated:op.validated,created_at:op.createdAt,updated_at:op.updatedAt}:null,
      receipts:receipts.map(row=>row.receipt)};
    });
  }
  async current(){
    const anchor=await this.#anchor();return this.#db.transaction('r',this.#db.runtime,this.#db.datasets,async()=>{
      const root=await assertAnchor(this.#db,anchor);const dataset=root.activeGeneration?datasetControl(await this.#db.datasets.get(root.activeGeneration)):null;
      return {root,participantId:dataset?.participantId??null,anchorGeneration:anchor.generation};
    });
  }
  async #empty(generation:string){
    for(const name of ['capture_jobs','bank_transactions','deliveries','processing_receipts','processing_targets'] as const)
      if(await this.#db.financial(name).where('generation').equals(generation).count())return false;
    const metadata=await this.#db.financial('dataset_metadata').where('generation').equals(generation).toArray();
    return !metadata.some(value=>{const row=value.row;return row[0][0]==='text'&&['sync_ever_started','migration_import_sha256','portable_imports'].includes(row[0][1]);});
  }
  async reserveDestination(switchId:string,peerId:string,credentialRef:string,now:string){
    participantUuid(switchId);participantUuid(peerId);participantUuid(credentialRef);const stamp=int64(now);requireStorage(BigInt(stamp)>=0n);
    const generation=crypto.randomUUID(),participantId=crypto.randomUUID(),datasetId=crypto.randomUUID(),anchor=await this.#anchor();
    return this.#db.transaction('rw',this.#db.tables,async()=>{
      const root=await assertAnchor(this.#db,anchor),existing=await this.#db.switches.get(switchId);
      if(existing){
        requireParticipant(existing.role==='destination'&&existing.peerId===peerId&&existing.credentialRef===credentialRef&&existing.state==='pending','migration_invalid');
        const dataset=datasetControl(await this.#db.datasets.get(existing.generation));return {participantId:dataset.participantId,generation:dataset.generation};
      }
      requireParticipant(root.pendingSwitchId===null,'migration_busy');
      if(root.activeMode==='local'){
        const active=datasetControl(await this.#db.datasets.get(root.activeGeneration!)),control=participantControl(await this.#db.participants.get(active.participantId));
        requireParticipant(active.lifecycle==='active'&&active.holdId===null&&control.state==='active'&&!control.everActivated&&!control.awaitingSync&&await this.#empty(active.generation),'migration_not_empty');
      }
      const epoch=increment(root.epoch);
      await this.#db.datasets.add({generation,datasetId,participantId,participantEpoch:int64('1'),logicalSchemaVersion:'1',lifecycle:'staging',
        ownerIds:[],holdId:switchId,createdAt:stamp,backupAcknowledgedAt:null});
      await this.#db.participants.add({id:participantId,generation,epoch:'1',state:'active',operationId:null,everActivated:false,awaitingSync:false});
      await this.#db.switches.add({id:switchId,generation,role:'destination',previousMode:root.activeMode,previousGeneration:root.activeGeneration,
        state:'pending',peerId,credentialRef,routingEpoch:epoch});
      await this.#db.runtime.put({...root,pendingSwitchId:switchId,epoch});return {participantId,generation};
    });
  }
  async updateCredential(credentialRef:string){
    participantUuid(credentialRef);const anchor=await this.#anchor();
    await this.#db.transaction('rw',this.#db.runtime,this.#db.datasets,this.#db.switches,async()=>{
      const root=await assertAnchor(this.#db,anchor);
      if(root.pendingSwitchId){
        const transfer=await this.#db.switches.get(root.pendingSwitchId);requireParticipant(transfer?.role==='destination'&&transfer.state==='pending','migration_paused');
        await this.#db.switches.put({...transfer,credentialRef});await this.#db.runtime.put({...root,credentialEpoch:increment(root.credentialEpoch)});
      }else await this.#db.runtime.put({...root,credentialRef,credentialEpoch:increment(root.credentialEpoch)});
    });
  }
  async #authenticate(input:unknown,command:PeerReceiptCommand,participantId:string,switchId:string){
    const checked=checkPeerReceipt(input,command,participantId),status=await this.#ports.readPeer(checked.installation_id,switchId);
    requireParticipant(status.installation_id===checked.installation_id&&participantInteger(status.participant_epoch)>=participantInteger(checked.participant_epoch)&&
      status.operation?.state===checked.state&&status.receipts.some(receipt=>sameWire(receipt,checked)),'migration_invalid');return checked;
  }
  async #previous(participantId:string,requestId:string,digest:string){
    const row=await this.#db.migrationReceipts.get([participantId,requestId]);
    if(row){requireParticipant(row.requestDigest===digest);return structuredClone(row.receipt);}return null;
  }
  async command(participantId:string,command:Exclude<ParticipantCommand,'source_seal'>,input:unknown,now:string){
    return this.#command(participantId,command,input,now);
  }
  async #command(participantId:string,command:ParticipantCommand,input:unknown,now:string,
    sealed?:{sha256:string;size:string;nonce:string}){
    const {request,digest}=participantRequest(command,input);let snapshot=await this.#snapshot(participantId,request.switch_id as string);
    const previous=await this.#previous(participantId,request.request_id as string,digest);if(previous)return previous;
    const peer=peerCommand[command];if(peer){
      const receipt=await this.#authenticate(request.peer_receipt,peer,participantId,request.switch_id as string);
      requireParticipant(snapshot.transfer?.peerId===receipt.installation_id,'migration_invalid');
    }
    let verified=false,credentialEpoch:string|null=null,credentialRef:string|null=null;
    if(command==='destination_arm'||command==='destination_activate'){
      await this.#prepare(snapshot,now);snapshot=await this.#snapshot(participantId,request.switch_id as string);
      credentialEpoch=snapshot.root.credentialEpoch;credentialRef=snapshot.transfer?.credentialRef??null;
      requireParticipant(credentialRef!==null,'zenmoney_unavailable');
      let owner:{ownerIds:readonly string[];sourceHash:string};
      try{owner=await this.#ports.verifyOwner(credentialRef);}catch{throw new ParticipantError('zenmoney_unavailable');}
      const stage=stageRecord(await this.#db.stages.get(snapshot.control.generation));
      const manifest=JSON.parse(stage.manifest) as {zenmoney_identity:{owner_ids:string[]}};
      const order=(a:string,b:string)=>{const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;};
      requireParticipant(Array.isArray(owner.ownerIds)&&owner.ownerIds.length>=1&&owner.ownerIds.length<=200&&owner.ownerIds.every(id=>typeof id==='string'&&id.length>=1&&id.length<=240),'migration_wrong_account');
      requireParticipant(same([...new Set(owner.ownerIds)].sort(order),manifest.zenmoney_identity.owner_ids),'migration_wrong_account');
      requireParticipant(/^[0-9a-f]{64}$/.test(owner.sourceHash),'migration_invalid');verified=true;
    }
    const {root,control,dataset,operation:op}=snapshot;
    if(command==='source_start')requireParticipant(root.pendingSwitchId===null&&root.activeMode==='local'&&root.activeGeneration===control.generation&&dataset.lifecycle==='active'&&dataset.holdId===null,'migration_paused');
    else requireParticipant(root.pendingSwitchId===request.switch_id&&snapshot.transfer?.generation===control.generation&&snapshot.transfer.state==='pending','migration_paused');
    if(command==='source_seal')requireParticipant(sealed!==undefined&&op?.snapshotNonce===sealed.nonce,'migration_incomplete');
    const next=participantTransition(control,op,command,request,{now,datasetId:dataset.datasetId,archiveId:crypto.randomUUID(),eligible:!control.everActivated,
      legacyHold:false,archive:sealed??null,validated:verified});
    const anchor=await this.#anchor();
    return this.#db.transaction('rw',this.#db.tables,async()=>{
      const current=await assertAnchor(this.#db,anchor),replayed=await this.#previous(participantId,request.request_id as string,digest);if(replayed)return replayed;
      requireParticipant(same(current,root)&&same(await this.#db.participants.get(participantId),control)&&
        same((await this.#db.migrationOperations.get([participantId,request.switch_id as string]))??null,op),'migration_busy');
      if(verified)requireParticipant(current.credentialEpoch===credentialEpoch&&(await this.#db.switches.get(request.switch_id as string))?.credentialRef===credentialRef,'migration_busy');
      let updated={...dataset,participantEpoch:int64(next.control.epoch)};
      if(command==='source_start'){
        const outbox=await readOutbox(this.#db,control.generation);
        // An expired request still needs verification-only recovery before hold.
        requireParticipant(outbox===null||outbox.phase==='settled','migration_busy');
        const epoch=increment(current.epoch);updated={...updated,lifecycle:'held',holdId:request.switch_id as string};
        await this.#db.switches.add({id:request.switch_id as string,generation:control.generation,role:'source',previousMode:'local',previousGeneration:control.generation,
          state:'pending',peerId:next.operation.peerId,credentialRef:null,routingEpoch:epoch});
        await this.#db.runtime.put({...current,pendingSwitchId:request.switch_id as string,epoch});
      }else if(command==='destination_start')updated={...updated,datasetId:next.operation.datasetId};
      else if(command==='destination_arm')updated={...updated,lifecycle:'armed'};
      else if(command==='source_handoff')updated={...updated,lifecycle:'retired'};
      else if(command==='source_resume'||command==='destination_discard'){
        updated={...updated,lifecycle:command==='source_resume'?'active':'discarded',holdId:null};
        const transfer=snapshot.transfer!;await this.#db.switches.put({...transfer,state:'cancelled'});
        await this.#db.runtime.put({...current,pendingSwitchId:null,epoch:increment(current.epoch)});
        if(command==='destination_discard'){
          const stage=await this.#db.stages.get(control.generation);
          if(stage)await this.#db.stages.put(stageRecord({...stage,state:'discarded',graphVersion:null,graphDigest:null,graphVerifiedAt:null}));
        }
      }else if(command==='destination_activate'){
        const stage=stageRecord(await this.#db.stages.get(control.generation));
        requireParticipant(stage.state==='graph_valid'&&stage.graphDigest===op?.datasetDigest&&stage.archiveSha256===op.archiveSha256,'migration_incomplete');
        updated={...updated,lifecycle:'active',holdId:null};
        if(current.activeGeneration&&current.activeGeneration!==control.generation){
          const old=datasetControl(await this.#db.datasets.get(current.activeGeneration));await this.#db.datasets.put({...old,lifecycle:'retired'});
        }
        await this.#db.stages.put(stageRecord({...stage,state:'activated'}));
        await this.#db.runtime.put({...current,activeMode:'local',activeGeneration:control.generation,pendingSwitchId:null,credentialRef,
          credentialEpoch:increment(current.credentialEpoch),epoch:increment(current.epoch),financialMayHaveStarted:true});
        await this.#db.switches.put({...snapshot.transfer!,state:'local',routingEpoch:increment(current.epoch)});
      }
      await this.#db.datasets.put(updated);await this.#db.participants.put(next.control);await this.#db.migrationOperations.put(next.operation);
      const receiptRow:ParticipantReceiptRow={participantId,requestId:request.request_id as string,switchId:request.switch_id as string,requestDigest:digest,receipt:next.receipt};
      await this.#db.migrationReceipts.add(receiptRow);return next.receipt;
    });
  }
  async putChunk(participantId:string,switchId:string,expectedEpoch:string,number:number,input:Uint8Array,checksum:string){
    requireParticipant(input instanceof Uint8Array&&input.length>=1&&input.length<=262144);
    const data=new Uint8Array(input);requireParticipant(Number.isInteger(number)&&number>=0&&number<=255&&hash(data)===checksum);
    const snapshot=await this.#snapshot(participantId,switchId),anchor=await this.#anchor();
    return this.#db.transaction('rw',this.#db.tables,async()=>{
      const root=await assertAnchor(this.#db,anchor),control=participantControl(await this.#db.participants.get(participantId));
      const op=await this.#db.migrationOperations.get([participantId,switchId]);
      requireParticipant(root.pendingSwitchId===switchId&&control.epoch===expectedEpoch&&control.operationId===switchId&&
        op?.role==='destination'&&op.state==='import_hold'&&!op.validated,'migration_paused');
      const size=Number(participantInteger(op.archiveSize,67108864n));requireParticipant(number*262144<size&&data.length===Math.min(262144,size-number*262144));
      const old=await this.#db.migrationChunks.get([participantId,switchId,number]);
      if(old)requireParticipant(old.sha256===checksum&&old.data.length===data.length&&old.data.every((byte,i)=>byte===data[i]));
      else await this.#db.migrationChunks.add({participantId,switchId,number,sha256:checksum,data});
      return {switch_id:switchId,number:String(number),bytes:String(data.length),sha256:checksum};
    });
  }
  async download(participantId:string,switchId:string,number:number){
    const snapshot=await this.#snapshot(participantId,switchId);
    requireParticipant(snapshot.operation?.role==='source'&&snapshot.operation.datasetDigest!==null&&
      ['export_hold','handed_off'].includes(snapshot.operation.state),'migration_incomplete');
    const data=await this.#readChunk(participantId,switchId,number);await this.#unchanged(snapshot);return data;
  }
  async #readChunk(participantId:string,switchId:string,number:number){
    requireParticipant(Number.isInteger(number)&&number>=0&&number<=255);
    const chunk=await this.#db.migrationChunks.get([participantId,switchId,number]);requireParticipant(chunk!==undefined&&hash(chunk.data)===chunk.sha256,'migration_incomplete');
    return chunk.data.slice();
  }
  async #unchanged(snapshot:OwnerSnapshot){
    const current=await this.#snapshot(snapshot.control.id,snapshot.operation!.switchId);
    requireParticipant(same(current.root,snapshot.root)&&same(current.control,snapshot.control)&&same(current.operation,snapshot.operation),'migration_busy');return current;
  }
  async #archive(snapshot:OwnerSnapshot){
    const parts:ArrayBuffer[]=[],checksum=sha256.create();let size=0,count=0,last=0;
    const op=snapshot.operation!;
    const total=await this.#db.migrationChunks.where('[participantId+switchId]').equals([snapshot.control.id,op.switchId]).count();
    requireParticipant(total>=1&&total<=256,'migration_incomplete');
    for(let number=0;number<total;number++){
      await this.#unchanged(snapshot);const bytes=await this.#readChunk(snapshot.control.id,op.switchId,number);
      requireParticipant(number===0||last===262144,'migration_incomplete');last=bytes.length;
      requireParticipant(last>=1&&last<=262144,'migration_incomplete');size+=last;checksum.update(bytes);parts.push(new Uint8Array(bytes).buffer);count++;
    }
    requireParticipant(count===total&&size<=67108864,'migration_incomplete');
    const digest=bytesToHex(checksum.digest());
    if(op.archiveSha256!==null)requireParticipant(op.archiveSha256===digest&&op.archiveSize===String(size),'migration_incomplete');
    return {blob:new Blob(parts),sha256:digest,size:String(size)};
  }
  async #prepare(snapshot:OwnerSnapshot,now:string){
    requireParticipant(snapshot.operation?.role==='destination'&&['import_hold','armed'].includes(snapshot.control.state),'migration_paused');
    requireParticipant(snapshot.root.pendingSwitchId===snapshot.operation.switchId&&snapshot.transfer?.generation===snapshot.control.generation,'migration_paused');
    let stage=await this.#db.stages.get(snapshot.control.generation);
    if(!stage||!['format_valid','graph_valid'].includes(stage.state)){
      const archive=await this.#archive(snapshot),nonce=crypto.randomUUID(),anchor=await this.#anchor();
      await this.#db.transaction('rw',this.#db.tables,async()=>{
        const root=await assertAnchor(this.#db,anchor),current=await this.#db.migrationOperations.get([snapshot.control.id,snapshot.operation!.switchId]);
        requireParticipant(same(root,snapshot.root)&&same(current,snapshot.operation),'migration_busy');
        await this.#db.migrationOperations.put({...current!,importNonce:nonce});
        await this.#db.datasets.put({...snapshot.dataset,lifecycle:'staging'});
      });
      snapshot=await this.#snapshot(snapshot.control.id,snapshot.operation.switchId);
      const fence={installationId:snapshot.root.installationId,generation:snapshot.control.generation,epoch:snapshot.root.epoch};
      const permit:ImportPermit={switchId:snapshot.operation!.switchId,participantId:snapshot.control.id,nonce};
      // Only an inactive, unactivated participant with the same durable import
      // nonce may clear a partial loading attempt. Every deletion is bounded.
      for(const table of TABLES)while(true){
        const anchor=await this.#anchor();
        const removed=await this.#db.transaction('rw',this.#db.tables,async()=>{
          await assertImportScope(this.#db,fence,anchor,permit);
          const control=participantControl(await this.#db.participants.get(snapshot.control.id));
          requireParticipant(!control.everActivated,'migration_paused');
          const keys=await this.#db.financial(table).where('generation').equals(control.generation).limit(500).primaryKeys();
          await this.#db.financial(table).bulkDelete(keys);return keys.length;
        });if(removed===0)break;
      }
      const cleanupAnchor=await this.#anchor();
      await this.#db.transaction('rw',[...scopeTables(this.#db),this.#db.stages],async()=>{
        await assertImportScope(this.#db,fence,cleanupAnchor,permit);
        await this.#db.stages.delete(snapshot.control.generation);
      });
      await stageArchive(this.#db,this.#port,{installationId:snapshot.root.installationId,generation:snapshot.control.generation,epoch:snapshot.root.epoch},
        archive.blob,now,permit);
    }
    snapshot=await this.#snapshot(snapshot.control.id,snapshot.operation!.switchId);
    requireParticipant(snapshot.operation?.importNonce!==null,'migration_incomplete');
    const permit:ImportPermit={switchId:snapshot.operation!.switchId,participantId:snapshot.control.id,nonce:snapshot.operation!.importNonce!};
    await validateStageGraph(this.#db,this.#port,{installationId:snapshot.root.installationId,generation:snapshot.control.generation,epoch:snapshot.root.epoch},
      snapshot.control.generation,now,permit);
  }
  async snapshotSource(participantId:string,switchId:string,now:string){
    let snapshot=await this.#snapshot(participantId,switchId);const op=snapshot.operation;
    requireParticipant(op?.role==='source','migration_invalid');
    if(op.datasetDigest!==null){
      requireParticipant(['export_hold','handed_off'].includes(op.state),'migration_paused');
      const status=await this.status(participantId,switchId),receipt=status.receipts.find(receipt=>receipt.command==='source_seal');
      requireParticipant(receipt!==undefined,'migration_incomplete');return receipt;
    }
    requireParticipant(snapshot.control.state==='export_hold'&&snapshot.root.pendingSwitchId===switchId,'migration_paused');
    const nonce=crypto.randomUUID(),anchor=await this.#anchor();
    await this.#db.transaction('rw',this.#db.tables,async()=>{
      const root=await assertAnchor(this.#db,anchor);requireParticipant(same(root,snapshot.root)&&same(await this.#db.migrationOperations.get([participantId,switchId]),op),'migration_busy');
      await this.#db.migrationChunks.where('[participantId+switchId]').equals([participantId,switchId]).delete();
      await this.#db.migrationOperations.put({...op,snapshotNonce:nonce});
    });
    snapshot=await this.#snapshot(participantId,switchId);let currentAnchor=await this.#anchor();
    const guard=async()=>{
      const root=await assertAnchor(this.#db,currentAnchor),control=participantControl(await this.#db.participants.get(participantId));
      const current=await this.#db.migrationOperations.get([participantId,switchId]);
      requireParticipant(root.pendingSwitchId===switchId&&root.epoch===snapshot.root.epoch&&control.state==='export_hold'&&control.epoch===snapshot.control.epoch&&
        current?.snapshotNonce===nonce&&current.datasetDigest===null,'migration_paused');
    };
    const reader=new HeldReader(this.#db,snapshot.control.generation,async()=>{currentAnchor=await this.#anchor();},guard);
    const owners:string[]=[];for await(const row of reader.rows('zen_entities',[['text','user']]))if(row.deleted==='0')owners.push(row.id);
    let buffer=new Uint8Array(262144),used=0,number=0;
    const flush=async()=>{
      if(!used)return;const data=buffer.slice(0,used),checksum=hash(data);currentAnchor=await this.#anchor();
      await this.#db.transaction('rw',this.#db.tables,async()=>{
        await guard();requireParticipant(number<256,'migration_incomplete');
        await this.#db.migrationChunks.add({participantId,switchId,number,data,sha256:checksum});
      });number++;used=0;buffer=new Uint8Array(262144);
    };
    const seconds=participantInteger(op.createdAt,253402300799n,0n);
    const result=await createArchive({datasetId:op.datasetId,ownerIds:owners,sessionId:switchId,archiveId:op.archiveId,
      createdAt:new Date(Number(seconds)*1000).toISOString(),version:'L4-held-source'},async function*(name){for await(const row of reader.rows(name))yield packRow(name,row);},{
      async write(part){for(let offset=0;offset<part.length;){const length=Math.min(buffer.length-used,part.length-offset);buffer.set(part.subarray(offset,offset+length),used);used+=length;offset+=length;if(used===buffer.length)await flush();}},
    });await flush();await validateFinancialGraph(reader,result.manifest);
    const archived=await this.#archive(await this.#snapshot(participantId,switchId));
    requireParticipant(archived.sha256===result.archiveSha256&&archived.size===String(result.bytes),'migration_incomplete');
    return this.#command(participantId,'source_seal',{request_id:op.archiveId,switch_id:switchId,expected_epoch:snapshot.control.epoch,
      dataset_digest:result.manifest.dataset_digest,archive_sha256:result.archiveSha256,archive_size:String(result.bytes)},now,{sha256:archived.sha256,size:archived.size,nonce});
  }
  async selectRemote(participantId:string,switchId:string,remoteContextRef:string){
    participantUuid(remoteContextRef);const snapshot=await this.#snapshot(participantId,switchId);
    if(snapshot.transfer?.state==='remote'){
      requireParticipant(snapshot.transfer.credentialRef===remoteContextRef);return;
    }
    requireParticipant(snapshot.control.state==='handed_off'&&snapshot.operation?.state==='handed_off'&&snapshot.root.pendingSwitchId===switchId,'migration_paused');
    const anchor=await this.#anchor();await this.#db.transaction('rw',this.#db.tables,async()=>{
      const root=await assertAnchor(this.#db,anchor);requireParticipant(same(root,snapshot.root)&&same(await this.#db.participants.get(participantId),snapshot.control),'migration_busy');
      const epoch=increment(root.epoch);
      await this.#db.runtime.put({...root,activeMode:'remote',activeGeneration:null,pendingSwitchId:null,credentialRef:remoteContextRef,credentialEpoch:increment(root.credentialEpoch),epoch});
      await this.#db.switches.put({...snapshot.transfer!,state:'remote',credentialRef:remoteContextRef,routingEpoch:epoch});
    });
  }
}
