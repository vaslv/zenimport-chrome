/** Authenticated local/remote adapters for the same durable participant protocol. */
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import type {MigrationOwner} from '../storage/migration-owner.js';
import {participantUuid,requireParticipant,ParticipantError} from '../../control/participant-wire.js';
import type {ParticipantReceipt} from '../../control/participant-wire.js';
import {status,receipt} from './wire.js';
import type {LiveParticipant} from './runner.js';
import type {RemoteParticipant} from './remote.js';
export class NativeParticipant implements LiveParticipant{
  constructor(private owner:MigrationOwner,private id:string,private clock=()=>Math.floor(Date.now()/1000)){participantUuid(id);}
  async status(switchId:string){return status({...await this.owner.status(this.id,switchId),legacy_hold:null,work:[]},switchId);}
  async command(command:Parameters<LiveParticipant['command']>[0],request:Record<string,unknown>){return receipt(await this.owner.command(this.id,command,request,String(this.clock())));}
  async seal(switchId:string){return receipt(await this.owner.snapshotSource(this.id,switchId,String(this.clock())));}
  async finalize(_request:Record<string,unknown>){return true;}
  async download(switchId:string,number:number){return this.owner.download(this.id,switchId,number);}
  async upload(switchId:string,epoch:string,number:number,bytes:Uint8Array){return this.owner.putChunk(this.id,switchId,epoch,number,bytes,bytesToHex(sha256(bytes)));}
}
export class ServerParticipant implements LiveParticipant{
  constructor(private remote:RemoteParticipant,private id:string){participantUuid(id);}
  async status(switchId:string){const value=await this.remote.status(switchId);requireParticipant(value.installation_id===this.id);return value;}
  async command(command:Parameters<LiveParticipant['command']>[0],request:Record<string,unknown>):Promise<ParticipantReceipt|null>{
    const value=await this.remote.command(command,request);if(value.receipt)requireParticipant(value.receipt.installation_id===this.id);return value.receipt;
  }
  async seal(switchId:string){return (await this.status(switchId)).receipts.find(proof=>proof.command==='source_seal')??null;}
  async finalize(request:Record<string,unknown>){
    const value=await this.status(participantUuid(request.switch_id)),id=participantUuid(request.request_id),existing=value.work.find(work=>work.id===id);
    if(existing){
      requireParticipant(existing.kind==='validate');
      if(existing.state==='blocked')throw new ParticipantError(String(existing.error_code??'migration_incomplete'));
      return existing.state==='complete';
    }
    const result=await this.remote.finalize({request_id:id,switch_id:participantUuid(request.switch_id),expected_epoch:String(request.expected_epoch)});
    return result.state==='complete';
  }
  async download(switchId:string,number:number){await this.status(switchId);return this.remote.download(switchId,number);}
  async upload(switchId:string,epoch:string,number:number,bytes:Uint8Array){await this.status(switchId);return this.remote.upload(switchId,epoch,number,bytes);}
}
