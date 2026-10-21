/** Pure speculative transition. Only the private owner may commit its result. */
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {canonicalParticipant,participantUuid,participantInteger,participantDigest,checkPeerReceipt,requireParticipant} from '../../control/participant-wire.js';
import type {ParticipantReceipt} from '../../control/participant-wire.js';
import type {ParticipantControl,ParticipantOperation,ParticipantCommand,OperationState} from './participant-model.js';

const fields={source_start:['peer_id'],source_seal:['dataset_digest','archive_sha256','archive_size'],destination_start:['peer_receipt'],
  destination_arm:[],source_handoff:['peer_receipt'],source_cancel:[],destination_discard:['peer_receipt'],source_resume:['peer_receipt'],destination_activate:['peer_receipt']} as const;
export function participantRequest(command:ParticipantCommand,input:unknown):{request:Record<string,unknown>;digest:string}{
  requireParticipant(Object.hasOwn(fields,command));
  const raw=canonicalParticipant(input),request=JSON.parse(new TextDecoder().decode(raw)) as Record<string,unknown>;
  requireParticipant(request!==null&&typeof request==='object'&&!Array.isArray(request));
  const keys=['request_id','switch_id','expected_epoch',...fields[command]];
  requireParticipant(Object.keys(request).length===keys.length&&keys.every(key=>Object.hasOwn(request,key)));
  participantUuid(request.request_id);participantUuid(request.switch_id);participantInteger(request.expected_epoch);
  return {request,digest:bytesToHex(sha256(canonicalParticipant({command,request})))};
}
export function receiptOperation(op:ParticipantOperation){return {switch_id:op.switchId,peer_id:op.peerId,dataset_id:op.datasetId,
  dataset_digest:op.datasetDigest,archive_sha256:op.archiveSha256,archive_size:op.archiveSize};}
export function participantTransition(current:ParticipantControl,original:ParticipantOperation|null,command:ParticipantCommand,
  request:Record<string,unknown>,context:{now:string;datasetId:string;archiveId:string;eligible:boolean;legacyHold:boolean;
    archive:{sha256:string;size:string}|null;validated:boolean}){
  const epoch=participantInteger(request.expected_epoch),now=participantInteger(context.now,9223372036854775807n,0n).toString();
  requireParticipant(current.epoch===request.expected_epoch&&epoch<9223372036854775807n,'migration_busy');
  let op=original===null?null:{...original},state:OperationState;
  const insert=(role:'source'|'destination',peerId:string,datasetId:string,next:OperationState,peer?:ParticipantReceipt):ParticipantOperation=>({
    participantId:current.id,generation:current.generation,switchId:request.switch_id as string,role,peerId,datasetId,state:next,
    datasetDigest:peer?.dataset_digest??null,archiveSha256:peer?.archive_sha256??null,archiveSize:peer?.archive_size??null,
    peerEpoch:peer?.participant_epoch??null,validated:false,createdAt:now,updatedAt:now,archiveId:context.archiveId,snapshotNonce:null,importNonce:null,
  });
  if(command==='destination_discard'&&op===null){
    requireParticipant(current.state==='active'&&!current.awaitingSync,'migration_paused');
    const peer=checkPeerReceipt(request.peer_receipt,'source_cancel',current.id);
    requireParticipant(peer.switch_id===request.switch_id);state='discarded';op=insert('destination',peer.installation_id,peer.dataset_id,state,peer);
  }else if(command==='source_start'||command==='destination_start'){
    requireParticipant(op===null&&current.state==='active'&&!current.awaitingSync,'migration_paused');
    if(command==='source_start'){
      requireParticipant(!context.legacyHold,'migration_paused');const peer=participantUuid(request.peer_id);
      requireParticipant(peer!==current.id);state='export_hold';op=insert('source',peer,participantUuid(context.datasetId),state);
    }else{
      requireParticipant(context.eligible&&!current.everActivated,'migration_not_empty');
      const peer=checkPeerReceipt(request.peer_receipt,'source_seal',current.id);
      requireParticipant(peer.switch_id===request.switch_id&&peer.dataset_digest!==null);state='import_hold';op=insert('destination',peer.installation_id,peer.dataset_id,state,peer);
    }
  }else{
    requireParticipant(op!==null&&current.operationId===request.switch_id&&current.state===op.state,'migration_paused');
    const old=op.state,role=op.role;
    if(command==='source_seal'){
      requireParticipant(role==='source'&&old==='export_hold'&&op.datasetDigest===null);
      const size=participantInteger(request.archive_size,67108864n).toString();
      requireParticipant(context.archive!==null&&context.archive.sha256===request.archive_sha256&&context.archive.size===size,'migration_incomplete');
      op={...op,datasetDigest:participantDigest(request.dataset_digest),archiveSha256:participantDigest(request.archive_sha256),archiveSize:size};state=old;
    }else if(command==='source_cancel'){
      requireParticipant(role==='source'&&old==='export_hold','migration_paused');state='cancel_pending';
    }else if(command==='destination_arm'){
      requireParticipant(role==='destination'&&old==='import_hold'&&context.validated,'migration_incomplete');state='armed';op={...op,validated:true};
    }else{
      const peerCommand=({source_handoff:'destination_arm',destination_discard:'source_cancel',source_resume:'destination_discard',destination_activate:'source_handoff'} as const)[command];
      const peer=checkPeerReceipt(request.peer_receipt,peerCommand,current.id,receiptOperation(op));
      if(command==='source_handoff'){
        requireParticipant(role==='source'&&old==='export_hold'&&peer.peer_epoch===current.epoch,'migration_paused');state='handed_off';
      }else if(command==='destination_discard'){
        requireParticipant(role==='destination'&&['import_hold','armed'].includes(old),'migration_paused');
        requireParticipant(op.peerEpoch!==null&&participantInteger(peer.participant_epoch)>participantInteger(op.peerEpoch));state='discarded';
      }else if(command==='source_resume'){
        requireParticipant(role==='source'&&old==='cancel_pending'&&peer.peer_epoch===current.epoch,'migration_paused');state='resumed';
      }else{
        requireParticipant(role==='destination'&&old==='armed'&&peer.peer_epoch===current.epoch,'migration_paused');
        requireParticipant(context.eligible&&!current.everActivated,'migration_not_empty');requireParticipant(context.validated,'migration_incomplete');state='activated';
      }
      op={...op,peerEpoch:peer.participant_epoch};
    }
    op={...op,state,updatedAt:now};
  }
  const active=['resumed','discarded','activated'].includes(state),next:ParticipantControl={...current,epoch:String(epoch+1n),
    state:active?'active':state as ParticipantControl['state'],operationId:active?null:request.switch_id as string,
    awaitingSync:state==='activated',everActivated:current.everActivated||state==='activated'};
  const plain={receipt_version:'1' as const,request_id:request.request_id as string,command,installation_id:current.id,participant_epoch:next.epoch,
    switch_id:op.switchId,role:op.role,peer_id:op.peerId,peer_epoch:op.peerEpoch,dataset_id:op.datasetId,state:op.state,
    dataset_digest:op.datasetDigest,archive_sha256:op.archiveSha256,archive_size:op.archiveSize};
  const receipt:ParticipantReceipt={...plain,receipt_sha256:bytesToHex(sha256(canonicalParticipant(plain)))};
  return {control:next,operation:op,receipt};
}
