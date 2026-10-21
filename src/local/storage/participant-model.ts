/** Nonportable per-generation authority. Never imported from a financial archive. */
import type {ParticipantReceipt} from '../../control/participant-wire.js';
export type ParticipantState='active'|'export_hold'|'import_hold'|'armed'|'cancel_pending'|'handed_off';
export type OperationState=Exclude<ParticipantState,'active'>|'activated'|'discarded'|'resumed';
export type ParticipantCommand='source_start'|'source_seal'|'destination_start'|'destination_arm'|'source_handoff'|
  'source_cancel'|'destination_discard'|'source_resume'|'destination_activate';
export interface ParticipantControl{
  readonly id:string;readonly generation:string;readonly epoch:string;readonly state:ParticipantState;
  readonly operationId:string|null;readonly everActivated:boolean;readonly awaitingSync:boolean;
}
export interface ParticipantOperation{
  readonly participantId:string;readonly switchId:string;readonly generation:string;
  readonly role:'source'|'destination';readonly peerId:string;readonly datasetId:string;readonly state:OperationState;
  readonly datasetDigest:string|null;readonly archiveSha256:string|null;readonly archiveSize:string|null;
  readonly peerEpoch:string|null;readonly validated:boolean;readonly createdAt:string;readonly updatedAt:string;
  readonly archiveId:string;readonly snapshotNonce:string|null;readonly importNonce:string|null;
}
export interface ParticipantReceiptRow{
  readonly participantId:string;readonly requestId:string;readonly switchId:string;readonly requestDigest:string;
  readonly receipt:ParticipantReceipt;
}
export interface ParticipantChunk{
  readonly participantId:string;readonly switchId:string;readonly number:number;readonly sha256:string;readonly data:Uint8Array;
}
export interface ModeSwitch{
  readonly id:string;readonly generation:string;readonly role:'source'|'destination';readonly previousMode:'local'|'remote';
  readonly previousGeneration:string|null;readonly state:'pending'|'remote'|'local'|'cancelled';
  readonly peerId:string;readonly credentialRef:string|null;readonly routingEpoch:string;
}
