/** Small read-only refresh unit; its lease and retry deadline survive worker death. */
import type {LocalCredentials} from './credentials.js';
import type {MirrorReader} from './reader.js';
import type {MirrorRepository} from '../storage/mirror-repository.js';
import {zenmoneyFailure,LocalZenMoneyError} from './errors.js';
import {StorageError} from '../storage/types.js';
export class LocalMirror{
  constructor(private store:MirrorRepository,private credentials:LocalCredentials,private reader:MirrorReader,private clock:()=>number){}
  async refresh({force=false,transactions=false}:{force?:boolean;transactions?:boolean}={}){
    const credential=await this.credentials.current();
    if(!await this.reader.permission())throw new LocalZenMoneyError('zenmoney_permission');
    const lease=await this.store.claim(credential.root,credential.hash,String(Math.floor(this.clock())),force,transactions);
    if(!lease){if(!await this.reader.permission())throw new LocalZenMoneyError('zenmoney_permission');return;}
    try{
      const diff=await this.reader.read(credential.token,lease.cursor,lease.full,transactions);
      await this.store.apply(credential.root,lease,diff.rawJson,String(Math.floor(this.clock())));
    }catch(error){
      if((error as {code?:string}).code==='stale_epoch'||(error as {code?:string}).code==='dataset_not_writable')throw error;
      const failure=zenmoneyFailure(error);
      // A failed old response cannot revoke a newer token/refresh's readiness.
      await this.store.failed(credential.root,lease,failure.code,String(Math.floor(this.clock()))).catch(problem=>{
        if(!['stale_epoch','dataset_not_writable'].includes((problem as {code:string}).code))throw problem;
      });throw error instanceof StorageError?error:failure;
    }
  }
  async readiness(){
    let configured=false,owners:string[]=[];
    try{const credential=await this.credentials.current();configured=true;owners=credential.owners;
      if(!await this.reader.permission())throw new LocalZenMoneyError('zenmoney_permission');
      const status=await this.store.status(credential.hash,String(Math.floor(this.clock())));
      return {configured:true,owners:credential.owners,ready:status.ready,lastRefresh:status.state.refreshed_at,error:status.control.error,nextAt:status.control.nextAt};
    }catch(error){if(error instanceof LocalZenMoneyError)return {configured,owners,ready:false,lastRefresh:null,error:error.code,nextAt:null};throw error;}
  }
}
