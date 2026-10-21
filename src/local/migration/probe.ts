import {CredentialCandidates} from '../zenmoney/candidates.js';
import {mirrorReader} from '../zenmoney/reader.js';
import type {StorageArea} from '../../application/state.js';
/** Private integration fixture, excluded from every product entry point. */
import {RemoteParticipant} from './remote.js';
import type {ArchiveRecoveryRequest} from './archive-wire.js';
export async function run(action:string,args:{url:string;token:string;permission?:boolean;id?:string;raw?:string;owners?:string[];ref?:string;now?:number;request?:unknown;number?:number;data?:string;checksum?:string;previewId?:string;accept?:boolean}){
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
    if(action.startsWith('archive-')){
      let result:unknown;
      if(action==='archive-backup')result=await client.archiveBackup(args.request as Parameters<RemoteParticipant['archiveBackup']>[0]);
      else if(action==='archive-restore')result=await client.archiveRestore(args.request as ArchiveRecoveryRequest);
      else if(action==='archive-status')result=await client.archiveStatus(args.id!);
      else if(action==='archive-download'){const bytes=await client.archiveDownload(args.id!,args.number!);let data='';for(const byte of bytes)data+=String.fromCharCode(byte);result=btoa(data);}
      else if(action==='archive-upload')result=await client.archiveUpload(args.id!,args.number!,Uint8Array.from(atob(args.data!),c=>c.charCodeAt(0)));
      else if(action==='archive-preview')result=await client.archivePreview(args.id!,args.checksum!);
      else if(action==='archive-activate')result=await client.archiveActivate(args.id!,args.previewId!,args.accept!==false);
      else if(action==='archive-ack')result=await client.archiveAcknowledge(args.id!,args.checksum!);
      else if(action==='archive-clean')result=await client.archiveClean(args.id!);
      else result=await client.archiveAction(args.id!,action.slice(8) as 'retry'|'cancel'|'finalize');
      return {ok:true,result};
    }
    const result=action==='identity'?await client.identity():action==='status'?await client.status(args.id!):await client.capabilities();
    return {ok:true,result};
  }catch(error){return {ok:false,code:(error as {code?:string}).code??'migration_invalid'};}
}
