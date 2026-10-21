import {CredentialCandidates} from '../zenmoney/candidates.js';
import {mirrorReader} from '../zenmoney/reader.js';
import type {StorageArea} from '../../application/state.js';
/** Private integration fixture, excluded from every product entry point. */
import {RemoteParticipant} from './remote.js';
export async function run(action:string,args:{url:string;token:string;permission?:boolean;id?:string;raw?:string;owners?:string[];ref?:string;now?:number}){
  const chrome=(globalThis as unknown as {chrome:{permissions:{contains(value:{origins:string[]}):Promise<boolean>}}}).chrome;
  const permission=async()=>args.permission!==false&&await chrome.permissions.contains({origins:[new URL(args.url).origin+'/*']});
  try{
    if(action.startsWith('candidate-')){
      const area=(globalThis as unknown as {chrome:{storage:{local:StorageArea}}}).chrome.storage.local;
      const reader=mirrorReader({permission:async()=>args.permission!==false,clock:()=>args.now??1000,fetch:async()=>new Response(args.raw??'{"serverTimestamp":100,"user":[{"id":1}],"account":[],"instrument":[],"tag":[],"transaction":[]}',{status:200})});
      const candidates=new CredentialCandidates(area,reader,()=>args.now??1000);
      const result=action==='candidate-verify'?await candidates.verifyToken(args.token,args.owners):await candidates.verifyReference(args.ref!);
      return {ok:true,result};
    }
    const client=new RemoteParticipant(args,permission);
    const result=action==='identity'?await client.identity():action==='status'?await client.status(args.id!):await client.capabilities();
    return {ok:true,result};
  }catch(error){return {ok:false,code:(error as {code?:string}).code??'migration_invalid'};}
}
