/** Private integration fixture, excluded from every product entry point. */
import {RemoteParticipant} from './remote.js';
export async function run(action:string,args:{url:string;token:string;permission?:boolean;id?:string}){
  const chrome=(globalThis as unknown as {chrome:{permissions:{contains(value:{origins:string[]}):Promise<boolean>}}}).chrome;
  const permission=async()=>args.permission!==false&&await chrome.permissions.contains({origins:[new URL(args.url).origin+'/*']});
  try{
    const client=new RemoteParticipant(args,permission);
    const result=action==='identity'?await client.identity():action==='status'?await client.status(args.id!):await client.capabilities();
    return {ok:true,result};
  }catch(error){return {ok:false,code:(error as {code?:string}).code??'migration_invalid'};}
}
