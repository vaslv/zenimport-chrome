/** Authenticated, bounded portable-v2 transport. No automatic command retry. */
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {SyncError,serverAddress} from '../../../extension/backend-client.js';
import {participantUuid,participantInteger,participantDigest,requireParticipant,ParticipantError} from '../../control/participant-wire.js';
import {participantRequest} from '../storage/participant-transition.js';
import type {ParticipantCommand} from '../storage/participant-model.js';
import {archiveStatus,archivePreview,recoveryRequest,recoveryWithdrawal} from './archive-wire.js';
import type {ArchiveRecoveryRequest} from './archive-wire.js';
import {capabilities,identity,status,object,receipt,task} from './wire.js';
const prefix='/api/v1/migration/portable';
const errors=new Set(['migration_busy','migration_paused','migration_not_empty','migration_invalid','migration_wrong_account','migration_incomplete','zenmoney_unavailable','unauthorized','validation_error','not_found']);
const base64=(bytes:Uint8Array)=>{let text='';for(let offset=0;offset<bytes.length;offset+=32768)text+=String.fromCharCode(...bytes.subarray(offset,offset+32768));return btoa(text);};
export class RemoteParticipant{
  readonly url:string;
  constructor(private config:{url:string;token:string},private permission:()=>Promise<boolean>,private fetcher:typeof fetch=globalThis.fetch,private timeoutMs=20000){
    this.url=serverAddress(config.url);this.config={...config,url:this.url};if(!config.token||config.token.length>4096||/\s/u.test(config.token))throw new SyncError('unauthorized');
  }
  async #request(path:string,method='GET',body?:unknown,binary=false,archive=false){
    if(!await this.permission())throw new SyncError('permission_required');
    const controller=new AbortController();let rejectAbort:(reason:Error)=>void=()=>{},reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject;});void aborted.catch(()=>{});
    const timer=setTimeout(()=>{controller.abort();rejectAbort(new SyncError('backend_unavailable',true));},this.timeoutMs);
    try{
      const fetcher=this.fetcher;
      const response=await Promise.race([fetcher(this.url+(archive?'/api/v1/migration/archives':prefix)+path,{method,headers:{Authorization:'Bearer '+this.config.token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal}).then(response=>{if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});throw new SyncError('backend_unavailable',true);}return response;}),aborted]);
      const chunks:Uint8Array[]=[];let size=0;
      if(response.body){reader=response.body.getReader();for(;;){const part=await Promise.race([reader.read(),aborted]);if(part.done)break;size+=part.value.length;requireParticipant(size<=(binary&&response.ok?262144:1024*1024));chunks.push(part.value);}}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      if(!await this.permission())throw new SyncError('permission_required');
      if(binary&&response.ok){requireParticipant(response.headers.get('content-type')?.split(';')[0]==='application/octet-stream'&&size>0&&bytesToHex(sha256(bytes))===participantDigest(response.headers.get('x-chunk-sha256')));return bytes;}
      const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      const code=(value as {error?:{code?:unknown}})?.error?.code;
      if(!response.ok&&response.status===404&&(path==='/identity'||archive&&(code!=='not_found'||['/capabilities','/recoveries/withdraw'].includes(path))))throw new SyncError('unsupported_migration_version');
      if(!response.ok)throw new SyncError(typeof code==='string'&&errors.has(code)?code:'backend_error');
      return value as unknown;
    }catch(error){if(error instanceof SyncError||error instanceof ParticipantError)throw error;throw new SyncError('backend_unavailable',true);}
    finally{clearTimeout(timer);controller.abort();if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}}
  }
  async capabilities(){return capabilities(await this.#request('/capabilities'));}
  async identity(){return identity(await this.#request('/identity','POST',{}));}
  async quiesce(installationId:string,epoch:string){
    participantUuid(installationId);participantInteger(epoch);
    const value=object(await this.#request('/quiesce','POST',{installation_id:installationId,expected_epoch:epoch}));
    requireParticipant(Object.keys(value).sort().join(',')==='installation_id,participant_epoch,ready'&&value.installation_id===installationId&&value.participant_epoch===epoch&&typeof value.ready==='boolean');
    return value.ready;
  }
  async status(switchId:string){participantUuid(switchId);return status(await this.#request('/switches/'+switchId),switchId);}
  async command(command:Exclude<ParticipantCommand,'source_seal'>,input:unknown){
    requireParticipant((command as string)!=='source_seal');const {request}=participantRequest(command,input),value=object(await this.#request('/commands/'+command,'POST',request));
    requireParticipant(Object.keys(value).every(key=>['receipt','work'].includes(key))&&(value.receipt!=null||value.work!=null));
    const proof=value.receipt==null?null:receipt(value.receipt),peer=request.peer_receipt===undefined?null:receipt(request.peer_receipt);
    if(peer)requireParticipant(peer.switch_id===request.switch_id);
    if(proof)requireParticipant(proof.command===command&&proof.request_id===request.request_id&&proof.switch_id===request.switch_id&&
      BigInt(proof.participant_epoch)===BigInt(request.expected_epoch as string)+1n&&(request.peer_id===undefined||proof.peer_id===request.peer_id)&&
      (peer===null||proof.peer_id===peer.installation_id&&proof.installation_id===peer.peer_id&&proof.dataset_id===peer.dataset_id&&proof.dataset_digest===peer.dataset_digest&&proof.archive_sha256===peer.archive_sha256&&proof.archive_size===peer.archive_size));
    const work=value.work==null?null:task(value.work,{switchId:request.switch_id as string,kind:command==='source_start'?'snapshot':'activate',...(command==='destination_activate'?{id:request.request_id as string}:{})});
    requireParticipant(work===null||['source_start','destination_activate'].includes(command));
    requireParticipant(command==='destination_activate'||proof!==null);
    return {receipt:proof,work};
  }
  async finalize(input:{request_id:string;switch_id:string;expected_epoch:string}){
    participantUuid(input.request_id);participantUuid(input.switch_id);participantInteger(input.expected_epoch);return task(await this.#request('/finalize','POST',input),{id:input.request_id,switchId:input.switch_id,kind:'validate'});
  }
  async upload(switchId:string,epoch:string,number:number,data:Uint8Array){
    participantUuid(switchId);participantInteger(epoch);requireParticipant(Number.isInteger(number)&&number>=0&&number<256&&data.length>0&&data.length<=262144);
    const checksum=bytesToHex(sha256(data)),value=object(await this.#request('/switches/'+switchId+'/chunks/'+number,'PUT',{expected_epoch:epoch,data:base64(data),sha256:checksum}));
    requireParticipant(value.switch_id===switchId&&value.number===String(number)&&value.bytes===String(data.length)&&value.sha256===checksum);return value;
  }
  async download(switchId:string,number:number){participantUuid(switchId);requireParticipant(Number.isInteger(number)&&number>=0&&number<256);return await this.#request('/switches/'+switchId+'/chunks/'+number,'GET',undefined,true) as Uint8Array;}
  async retry(id:string){participantUuid(id);return task(await this.#request('/work/'+id+'/retry','POST',{}),{id});}
  async archiveCapabilities(){
    const value=object(await this.#request('/capabilities','GET',undefined,false,true));
    requireParticipant(Object.keys(value).sort().join(',')==='archive_control_version,recovery_withdrawal'&&value.archive_control_version==='1'&&value.recovery_withdrawal===true,'unsupported_migration_version');
    return {archive_control_version:'1' as const,recovery_withdrawal:true as const};
  }
  async archiveWithdraw(input:ArchiveRecoveryRequest){
    const request=recoveryRequest(input);
    return recoveryWithdrawal(await this.#request('/recoveries/withdraw','POST',request,false,true),request);
  }
  async archiveBackup(input:{id:string;installation_id:string;expected_epoch:string}){
    const request=structuredClone(input);participantUuid(request.id);participantUuid(request.installation_id);participantInteger(request.expected_epoch,(1n<<63n)-3n);
    requireParticipant(Object.keys(request).sort().join(',')==='expected_epoch,id,installation_id');
    const value=archiveStatus(await this.#request('/backups','POST',request,false,true),request.id);
    requireParticipant(value.kind==='backup'&&value.installation_id===request.installation_id&&value.initial_epoch===request.expected_epoch);return value;
  }
  async archiveRestore(input:ArchiveRecoveryRequest){
    const request=recoveryRequest(input),value=archiveStatus(await this.#request('/recoveries','POST',request,false,true),request.id);
    requireParticipant(value.kind==='recovery'&&value.installation_id===request.installation_id&&value.initial_epoch===request.expected_epoch&&
      value.dataset_id===request.dataset_id&&value.archive_sha256===request.archive_sha256&&value.archive_size===request.archive_size);return value;
  }
  async archiveStatus(id:string){participantUuid(id);return archiveStatus(await this.#request('/'+id,'GET',undefined,false,true),id);}
  async archiveDownload(id:string,number:number){participantUuid(id);requireParticipant(Number.isInteger(number)&&number>=0&&number<256);return await this.#request('/'+id+'/chunks/'+number,'GET',undefined,true,true) as Uint8Array;}
  async archiveUpload(id:string,number:number,data:Uint8Array){
    participantUuid(id);requireParticipant(Number.isInteger(number)&&number>=0&&number<256&&data instanceof Uint8Array&&data.length>0&&data.length<=262144);
    const checksum=bytesToHex(sha256(data)),value=object(await this.#request('/'+id+'/chunks/'+number,'PUT',{data:base64(data),sha256:checksum},false,true));
    requireParticipant(Object.keys(value).sort().join(',')==='bytes,number,sha256'&&value.number===String(number)&&value.bytes===String(data.length)&&value.sha256===checksum);return value;
  }
  async archiveAction(id:string,action:'retry'|'cancel'|'finalize'){
    participantUuid(id);requireParticipant(['retry','cancel','finalize'].includes(action));
    const value=archiveStatus(await this.#request('/'+id+'/'+action,'POST',{},false,true),id);
    if(action==='cancel')requireParticipant(['cancelled','cleaned'].includes(value.phase));
    if(action==='finalize')requireParticipant(value.kind==='recovery'&&value.phase==='validating');return value;
  }
  async archivePreview(id:string,checksum:string){participantUuid(id);participantDigest(checksum);return archivePreview(await this.#request('/'+id+'/preview','GET',undefined,false,true),checksum);}
  async archiveActivate(id:string,previewId:string,acceptSummary:boolean){
    participantUuid(id);participantUuid(previewId);requireParticipant(acceptSummary===true,'migration_paused');
    const value=archiveStatus(await this.#request('/'+id+'/activate','POST',{preview_id:previewId,accept_summary:true},false,true),id);
    requireParticipant(value.kind==='recovery'&&value.phase==='activated');return value;
  }
  async archiveAcknowledge(id:string,checksum:string){
    participantUuid(id);participantDigest(checksum);const value=archiveStatus(await this.#request('/'+id+'/acknowledge','POST',{sha256:checksum},false,true),id);
    requireParticipant(value.archive_sha256===checksum&&value.acknowledged_at!==null);return value;
  }
  async archiveClean(id:string){
    participantUuid(id);const value=object(await this.#request('/'+id+'/clean','POST',{},false,true));
    requireParticipant(Object.keys(value).join(',')==='complete'&&typeof value.complete==='boolean');return {complete:value.complete};
  }

}
