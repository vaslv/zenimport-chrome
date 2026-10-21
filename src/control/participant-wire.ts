/** Protocol-2 integrity codec. A checked receipt is not authenticated authority. */
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';

export class ParticipantError extends Error{
  constructor(readonly code='migration_invalid'){super(code);this.name='ParticipantError';}
}
export function requireParticipant(value:unknown,code='migration_invalid'):asserts value{if(!value)throw new ParticipantError(code);}

const encoder=new TextEncoder();
const compare=(left:string,right:string)=>{
  const a=encoder.encode(left),b=encoder.encode(right);for(let i=0;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i])return a[i]-b[i];return a.length-b.length;
};
function string(value:string){
  requireParticipant(value.length<=16384);
  for(const char of value){const code=char.codePointAt(0)!;requireParticipant(code<0xd800||code>0xdfff);}
}

/** Exact Python ensure_ascii=False/sorted-key preimage; integers are strings. */
export function canonicalParticipant(input:unknown):Uint8Array{
  let nodes=0,characters=0;
  function encode(value:unknown,depth:number):string{
    requireParticipant(depth<=32&&++nodes<=16384);
    if(value===null)return 'null';
    if(typeof value==='boolean')return value?'true':'false';
    if(typeof value==='string'){
      string(value);characters+=value.length;requireParticipant(characters<=16384);return JSON.stringify(value);
    }
    if(Array.isArray(value)){
      requireParticipant(value.length<=8192&&Object.keys(value).length===value.length&&Object.getOwnPropertySymbols(value).length===0);
      const children:string[]=[];
      for(let i=0;i<value.length;i++){requireParticipant(Object.hasOwn(value,i));children.push(encode(value[i],depth+1));}
      return '['+children.join(',')+']';
    }
    requireParticipant(value!==null&&typeof value==='object'&&[null,Object.prototype].includes(Object.getPrototypeOf(value)));
    requireParticipant(Object.getOwnPropertySymbols(value).length===0);
    const keys=Object.keys(value);requireParticipant(keys.length<=4096);
    return '{'+keys.sort(compare).map(key=>{
      string(key);characters+=key.length;requireParticipant(characters<=16384);
      return JSON.stringify(key)+':'+encode((value as Record<string,unknown>)[key],depth+1);
    }).join(',')+'}';
  }
  const bytes=encoder.encode(encode(input,0));requireParticipant(bytes.length<=16384);return bytes;
}
export function participantUuid(value:unknown):string{
  requireParticipant(typeof value==='string'&&value.length===36&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value));return value;
}
export function participantInteger(value:unknown,maximum=9223372036854775807n,minimum=1n):bigint{
  requireParticipant(typeof value==='string'&&value.length<=19&&/^(?:0|[1-9][0-9]*)$/.test(value));
  const number=BigInt(value);requireParticipant(number>=minimum&&number<=maximum);return number;
}
export function participantDigest(value:unknown):string{
  requireParticipant(typeof value==='string'&&value.length===64&&/^[0-9a-f]{64}$/.test(value));return value;
}

export interface ParticipantReceipt{
  readonly receipt_version:'1';readonly request_id:string;readonly command:string;readonly installation_id:string;
  readonly participant_epoch:string;readonly switch_id:string;readonly role:'source'|'destination';readonly peer_id:string;
  readonly peer_epoch:string|null;readonly dataset_id:string;readonly state:string;readonly dataset_digest:string|null;
  readonly archive_sha256:string|null;readonly archive_size:string|null;readonly receipt_sha256:string;
}
export interface ReceiptOperation{
  readonly switch_id:string;readonly peer_id:string;readonly dataset_id:string;readonly dataset_digest:string|null;
  readonly archive_sha256:string|null;readonly archive_size:string|null;
}
export const RECEIPT_KEYS=['receipt_version','request_id','command','installation_id','participant_epoch','switch_id','role',
  'peer_id','peer_epoch','dataset_id','state','dataset_digest','archive_sha256','archive_size','receipt_sha256'] as const;
const states={source_seal:['source','export_hold'],destination_arm:['destination','armed'],source_handoff:['source','handed_off'],
  source_cancel:['source','cancel_pending'],destination_discard:['destination','discarded']} as const;
export type PeerReceiptCommand=keyof typeof states;

export function checkPeerReceipt(input:unknown,command:PeerReceiptCommand,localId:string,operation?:ReceiptOperation):ParticipantReceipt{
  requireParticipant(input!==null&&typeof input==='object'&&!Array.isArray(input));
  // Copy the bounded data before checking; callers cannot later mutate a proof.
  const raw=canonicalParticipant(input),value=JSON.parse(new TextDecoder().decode(raw)) as Record<string,unknown>;
  requireParticipant(Object.keys(value).length===RECEIPT_KEYS.length&&RECEIPT_KEYS.every(key=>Object.hasOwn(value,key)));
  const plain={...value};delete plain.receipt_sha256;
  requireParticipant(value.receipt_version==='1'&&value.command===command&&
    participantDigest(value.receipt_sha256)===bytesToHex(sha256(canonicalParticipant(plain))));
  for(const key of ['request_id','switch_id','installation_id','peer_id','dataset_id'])participantUuid(value[key]);
  participantInteger(value.participant_epoch);if(value.peer_epoch!==null)participantInteger(value.peer_epoch);
  requireParticipant(value.peer_id===participantUuid(localId)&&value.installation_id!==localId);
  const expected=states[command];requireParticipant(expected!==undefined&&value.role===expected[0]&&value.state===expected[1]);
  if(value.dataset_digest!==null){
    participantDigest(value.dataset_digest);participantDigest(value.archive_sha256);participantInteger(value.archive_size,67108864n);
  }else requireParticipant(value.archive_sha256===null&&value.archive_size===null);
  if(operation){
    requireParticipant(value.switch_id===operation.switch_id&&value.installation_id===operation.peer_id);
    for(const key of ['dataset_id','dataset_digest','archive_sha256','archive_size'] as const)requireParticipant(value[key]===operation[key]);
  }
  return Object.freeze(value) as unknown as ParticipantReceipt;
}
