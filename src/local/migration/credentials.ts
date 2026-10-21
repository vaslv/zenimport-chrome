/** Detached server credentials. Verification never changes Root or a writer. */
import type {StorageArea} from '../../application/state.js';
import type {RemoteDescriptor} from '../storage/remote-control.js';
import {serverAddress} from '../../../extension/backend-client.js';
import {participantUuid,requireParticipant} from '../../control/participant-wire.js';
import {RemoteParticipant} from './remote.js';
import {identity} from './wire.js';
import type {PortableIdentity} from './wire.js';
export interface ServerSecret extends RemoteDescriptor{version:1;ref:string;token:string}
interface CandidateProof{version:1;ref:string;identity:PortableIdentity}
const key=(ref:string)=>'remoteCredential:'+ref,proofKey=(ref:string)=>'remoteCandidate:'+ref;
const ordered=(value:unknown)=>JSON.stringify(value,(_key,item)=>item!==null&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const same=(a:unknown,b:unknown)=>ordered(a)===ordered(b);
export class ServerCredentials{
  private secure:Promise<void>;
  constructor(private area:StorageArea,private permission:(url:string)=>Promise<boolean>,private fetcher:typeof fetch=globalThis.fetch){
    this.secure=area.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  }
  async read(ref:string):Promise<ServerSecret>{
    await this.secure;participantUuid(ref);const raw=(await this.area.get(key(ref)))[key(ref)] as ServerSecret|undefined;
    requireParticipant(raw!==undefined&&raw!==null&&typeof raw==='object'&&Object.keys(raw).sort().join(',')==='contextId,legacy,ref,token,url,version'&&
      raw.version===1&&raw.ref===ref&&typeof raw.url==='string'&&serverAddress(raw.url)===raw.url&&typeof raw.token==='string'&&raw.token.length>0&&raw.token.length<=4096&&!/\s/u.test(raw.token)&&typeof raw.legacy==='boolean','recovery_required');
    participantUuid(raw.contextId);return structuredClone(raw);
  }
  /** Reserve a new immutable route secret without weakening the old binding. */
  async cloneContext(ref:string,targetRef:string,contextId:string){
    participantUuid(targetRef);participantUuid(contextId);requireParticipant(ref!==targetRef,'migration_invalid');
    const source=await this.read(ref),value:ServerSecret={version:1,ref:targetRef,url:source.url,token:source.token,contextId,legacy:false};
    const previous=(await this.area.get(key(targetRef)))[key(targetRef)];
    if(previous!==undefined){requireParticipant(same(await this.read(targetRef),value),'recovery_required');return value;}
    await this.area.set({[key(targetRef)]:value});
    requireParticipant(same(await this.read(targetRef),value),'recovery_required');return value;
  }
  async client(ref:string){const secret=await this.read(ref);return new RemoteParticipant(secret,()=>this.permission(secret.url),this.fetcher);}
  async verify(config:{url:string;token:string},expectedOwners:readonly string[]=[]){
    await this.secure;const url=serverAddress(config.url),token=config.token.trim(),client=new RemoteParticipant({url,token},()=>this.permission(url),this.fetcher);
    const checked=await client.identity();this.#owners(checked,expectedOwners);
    const ref=crypto.randomUUID(),secret:ServerSecret={version:1,ref,url,token,contextId:crypto.randomUUID(),legacy:false};
    // A new UUID cannot replace a selected reference. Both acknowledged records
    // exist before a coordinator journal is allowed to select this candidate.
    await this.area.set({[key(ref)]:secret,[proofKey(ref)]:{version:1,ref,identity:checked}});
    requireParticipant(same(await this.read(ref),secret),'recovery_required');
    const proof=await this.proof(ref);requireParticipant(same(proof,checked),'recovery_required');return {ref,identity:checked};
  }
  async proof(ref:string){
    await this.secure;participantUuid(ref);const raw=(await this.area.get(proofKey(ref)))[proofKey(ref)] as CandidateProof|undefined;
    requireParticipant(raw!==undefined&&raw!==null&&typeof raw==='object'&&Object.keys(raw).sort().join(',')==='identity,ref,version'&&raw.version===1&&raw.ref===ref,'recovery_required');
    return identity(raw.identity);
  }
  #owners(value:PortableIdentity,expected:readonly string[]){
    requireParticipant(!expected.length||same([...value.owner_ids].sort(),[...expected].sort()),'migration_wrong_account');
  }
  /** Legacy selected references need fresh verification, not a fabricated proof. */
  async verifyReference(ref:string,expectedOwners:readonly string[]=[],expectedId?:string){
    const checked=await (await this.client(ref)).identity();this.#owners(checked,expectedOwners);
    if(expectedId!==undefined)requireParticipant(checked.installation_id===expectedId,'migration_invalid');return checked;
  }
  async verifiedCandidate(ref:string,expectedOwners:readonly string[]=[]){
    const saved=await this.proof(ref),checked=await this.verifyReference(ref,saved.owner_ids,saved.installation_id);
    this.#owners(checked,expectedOwners);requireParticipant(checked.dataset_id===saved.dataset_id,'migration_invalid');return checked;
  }
}
