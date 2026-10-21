/** Trusted credential candidates can be verified before selecting a local writer. */
import type {StorageArea} from '../../application/state.js';
import type {MirrorReader} from './reader.js';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {prepareMirror} from './projection.js';
import {LocalZenMoneyError} from './errors.js';
import {requireStorage,storageFailure} from '../storage/types.js';
export const credentialPrefix='localCredential:';
export const tokenText=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\s\u001c-\u001f\u0085]/u.test(value);
export const tokenHash=(token:string)=>bytesToHex(sha256(new TextEncoder().encode(token)));
export interface CandidateSecret{version:'1';ref:string;token:string;hash:string;owners:string[];createdAt:number}
export class CredentialCandidates{
  private secure:Promise<unknown>;
  constructor(private persistent:StorageArea,private reader:MirrorReader,private clock:()=>number){this.secure=persistent.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});}
  async read(ref:string):Promise<CandidateSecret>{
    await this.secure;requireStorage(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(ref),'recovery_required');
    const value=(await this.persistent.get(credentialPrefix+ref))[credentialPrefix+ref] as CandidateSecret|undefined;
    if(value===undefined)throw new LocalZenMoneyError('zenmoney_not_configured');
    requireStorage(value!==null&&typeof value==='object'&&Object.keys(value).sort().join(',')==='createdAt,hash,owners,ref,token,version'&&value.version==='1'&&value.ref===ref&&tokenText(value.token)&&value.hash===tokenHash(value.token)&&
      typeof value.createdAt==='number'&&Number.isSafeInteger(value.createdAt)&&value.createdAt>=0&&Array.isArray(value.owners)&&value.owners.length>0&&value.owners.length<=200&&
      value.owners.every(id=>typeof id==='string'&&/^[1-9][0-9]*$/.test(id)&&id.length<=240)&&JSON.stringify([...new Set(value.owners)].sort())===JSON.stringify(value.owners),'recovery_required');
    return value;
  }
  async verifyToken(token:string,expected:readonly string[]=[]){
    await this.secure;if(!tokenText(token))throw new LocalZenMoneyError('zenmoney_auth');
    const diff=await this.reader.read(token,'0',true),owners=prepareMirror(diff.rawJson,'0',true,crypto.randomUUID()).owners!;
    if(expected.length&&JSON.stringify(expected)!==JSON.stringify(owners))throw new LocalZenMoneyError('zenmoney_wrong_owner');
    const ref=crypto.randomUUID(),secret:CandidateSecret={version:'1',ref,token,hash:tokenHash(token),owners,createdAt:Math.floor(this.clock())};
    try{await this.persistent.set({[credentialPrefix+ref]:secret});}catch(error){throw storageFailure(error);}
    const saved=await this.read(ref);
    requireStorage(saved.ref===ref&&saved.token===token&&saved.hash===secret.hash&&saved.createdAt===secret.createdAt&&JSON.stringify(saved.owners)===JSON.stringify(owners),'recovery_required');
    return {ref,owners,hash:secret.hash};
  }
  async verifyReference(ref:string){
    const secret=await this.read(ref),diff=await this.reader.read(secret.token,'0',true),owners=prepareMirror(diff.rawJson,'0',true,crypto.randomUUID()).owners!;
    if(JSON.stringify(owners)!==JSON.stringify(secret.owners))throw new LocalZenMoneyError('zenmoney_wrong_owner');
    return {ownerIds:owners,sourceHash:secret.hash};
  }
}
