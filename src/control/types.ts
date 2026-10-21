import type {Int64Text} from '../local/storage/types.js';

export interface DatasetSentinel{
  readonly version:'1';
  readonly installationId:string;
  readonly datasetId:string;
  readonly generation:string;
  readonly state:'initializing'|'ready';
  readonly financialMayHaveStarted:boolean;
}

/** Implemented only by trusted extension contexts, never a bank content script. */
export interface SentinelPort{
  read():Promise<DatasetSentinel|null>;
  create(value:DatasetSentinel):Promise<void>;
  acknowledgeReady(value:DatasetSentinel):Promise<void>;
  markFinancialActivity(installationId:string):Promise<void>;
}

export interface RuntimeControl{
  readonly id:'runtime';
  readonly installationId:string;
  readonly activeMode:'local'|'remote';
  readonly activeGeneration:string|null;
  readonly epoch:Int64Text;
  readonly pendingSwitchId:string|null;
  readonly credentialRef:string|null;
  readonly credentialEpoch:Int64Text;
  readonly financialMayHaveStarted:boolean;
}

export type DatasetLifecycle='active'|'staging'|'validated'|'held'|'armed'|'retired'|'discarded';

export interface DatasetControl{
  readonly generation:string;
  readonly datasetId:string;
  /** Fresh generation = fresh financial installation; never the source's ID. */
  readonly participantId:string;
  readonly participantEpoch:Int64Text;
  readonly logicalSchemaVersion:'1';
  readonly lifecycle:DatasetLifecycle;
  readonly ownerIds:readonly string[];
  readonly holdId:string|null;
  readonly createdAt:Int64Text;
  readonly backupAcknowledgedAt:Int64Text|null;
}

export interface ContextFence{
  readonly credentialEpoch?:Int64Text;
  readonly installationId:string;
  readonly generation:string;
  readonly epoch:Int64Text;
}
