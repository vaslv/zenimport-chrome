/** Verified token references persist; unverified drafts expire with the session. */
import {CredentialCandidates,credentialPrefix,tokenText} from './candidates.js';
import type {CandidateSecret as Secret} from './candidates.js';
export {tokenHash} from './candidates.js';
import type {StorageArea} from '../../application/state.js';
import type {RuntimeControl} from '../../control/types.js';
import type {MirrorRepository} from '../storage/mirror-repository.js';
import type {MirrorReader} from './reader.js';
import {LocalZenMoneyError} from './errors.js';
import {requireStorage} from '../storage/types.js';
const prefix=credentialPrefix,draftKey='localZenMoneyDraft';
export class LocalCredentials{
  private secure:Promise<unknown>;
  private candidates:CredentialCandidates;
  constructor(private persistent:StorageArea,private session:StorageArea,private store:MirrorRepository,private reader:MirrorReader,private clock:()=>number){
    this.secure=Promise.all([persistent,session].map(area=>area.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})));
    this.candidates=new CredentialCandidates(persistent,reader,clock);
  }
  async saveDraft(token:string){
    await this.secure;if(!tokenText(token))throw new LocalZenMoneyError('zenmoney_auth');
    await this.session.set({[draftKey]:{token,expiresAt:Math.floor(this.clock())+86400}});
  }
  async draft(){
    await this.secure;const raw=(await this.session.get(draftKey))[draftKey] as {token?:unknown;expiresAt?:unknown}|undefined;
    if(!raw)return null;
    if(!tokenText(raw.token)||typeof raw.expiresAt!=='number'||!Number.isSafeInteger(raw.expiresAt)||raw.expiresAt<=this.clock()||raw.expiresAt>this.clock()+86400){await this.cancelDraft();return null;}
    return raw.token;
  }
  async cancelDraft(){await this.secure;await this.session.remove(draftKey);}
  async verify(token:string){
    await this.secure;if(!tokenText(token))throw new LocalZenMoneyError('zenmoney_auth');
    const before=await this.store.context(),{ref,owners}=await this.candidates.verifyToken(token,before.owners);
    // A concurrent mode/token change wins Root CAS; this candidate cannot replace it.
    let root:RuntimeControl;
    try{
      root=await this.store.adopt(before.root,ref,owners);
    }
    catch(error){
      // A lost acknowledgement may still have committed. Delete only after
      // proving this unique candidate is not the selected Root reference.
      const selected=await this.store.context().catch(()=>null);
      if(selected&&selected.root.credentialRef!==ref)await this.persistent.remove(prefix+ref);
      throw error;
    }
    await this.cancelDraft();
    if(before.root.credentialRef)await this.persistent.remove(prefix+before.root.credentialRef);
    return {root,owners};
  }
  async cleanupCandidates(all=false){
    await this.secure;const before=await this.store.context(),values=await this.persistent.get(null);
    const keys=Object.entries(values).filter(([key,value])=>{
      if(!key.startsWith(prefix)||key===prefix+before.root.credentialRef)return false;
      if(all)return true;const secret=value as Partial<Secret>|null;
      return secret!==null&&typeof secret==='object'&&typeof secret.createdAt==='number'&&Number.isSafeInteger(secret.createdAt)&&this.clock()-secret.createdAt>=86400;
    }).map(([key])=>key);
    if(!keys.length)return;
    // Fence every preexisting candidate before erasure. A suspended verification
    // cannot later select a secret the cleanup has removed. New verifications use
    // fresh references and the new epoch, outside this captured candidate list.
    await this.store.adopt(before.root,before.root.credentialRef,before.owners);
    await this.persistent.remove(keys);
  }
  async current():Promise<{root:RuntimeControl;token:string;hash:string;owners:string[]}>{
    await this.secure;const {root,owners}=await this.store.context();
    if(!root.credentialRef)throw new LocalZenMoneyError('zenmoney_not_configured');
    const value=await this.candidates.read(root.credentialRef);
    requireStorage(JSON.stringify(value.owners)===JSON.stringify(owners),'recovery_required');
    return {root,owners,token:value.token,hash:value.hash};
  }
  async remove(){
    await this.secure;const {root}=await this.store.context();await this.store.removeCredential(root);
    // Disable the reference/epoch first. A crash here leaves an unusable secret,
    // never an active credential without its corresponding epoch.
    if(root.credentialRef)await this.persistent.remove(prefix+root.credentialRef);await this.cancelDraft();await this.cleanupCandidates(true);
  }
}
