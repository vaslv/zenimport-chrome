/** Isolated L1 probes. This entry is never packaged with the product extension. */
import Dexie from 'dexie';
import type {Table} from 'dexie';
import {decodeJson,encodeJson,ZenMoneyClient,ZenMoneyError} from 'zenmoney-typescript';

interface Meta {id:string;value:unknown}
interface RecordRow {id:string;dataset:string;external_id:string;raw:string}
interface Receipt {id:string;record_id:string}
class ProbeDatabase extends Dexie {
  readonly meta:Table<Meta,string>;
  readonly records:Table<RecordRow,string>;
  readonly receipts:Table<Receipt,string>;
  constructor(name:string) {
    super(name,{chromeTransactionDurability:'strict'});
    this.version(1).stores({meta:'id',records:'id,&[dataset+external_id],dataset',receipts:'id,record_id'});
    this.meta=this.table('meta');this.records=this.table('records');this.receipts=this.table('receipts');
  }
}

export async function exactRoundtrip(name:string,raw:string) {
  const db=new ProbeDatabase(name);
  try {
    await db.transaction('rw',db.records,db.meta,async()=>{
      await db.records.put({id:'exact',dataset:'a',external_id:'exact',raw});
      await db.meta.put({id:'generation',value:'1'});
    });
    const stored=await db.records.get('exact');
    return {wire:encodeJson(decodeJson(stored!.raw)),generation:(await db.meta.get('generation'))!.value};
  }finally{db.close();}
}

export async function atomicFailure(name:string,quota=false) {
  const db=new ProbeDatabase(name);
  try {
    await db.records.put({id:'original',dataset:'a',external_id:'same',raw:'{}'});
    let code='';
    try {
      await db.transaction('rw',db.records,db.receipts,async()=>{
        await db.records.add({id:'new',dataset:'a',external_id:'new',raw:'{}'});
        await db.receipts.add({id:'new-receipt',record_id:'new'});
        if(quota)throw new DOMException('Injected disk exhaustion','QuotaExceededError');
        await db.records.add({id:'collision',dataset:'a',external_id:'same',raw:'{}'});
      });
    }catch(error){code=error instanceof Error?error.name:'unknown';}
    return {code,records:await db.records.count(),receipts:await db.receipts.count()};
  }finally{db.close();}
}

export async function databaseState(name:string) {
  const db=new ProbeDatabase(name);
  try{return {records:await db.records.count(),receipts:await db.receipts.count(),generation:(await db.meta.get('generation'))?.value??null};}
  finally{db.close();}
}

export async function bulkSeed(name:string,count:number,payloadBytes=256) {
  if(!Number.isSafeInteger(count)||count<1||count>100000||payloadBytes>2048||payloadBytes<1)throw Error('probe_limit');
  const db=new ProbeDatabase(name),start=performance.now();let maxChunkMs=0;
  try {
    for(let offset=0;offset<count;offset+=1000) {
      const rows=Array.from({length:Math.min(1000,count-offset)},(_,i)=>({id:String(offset+i),dataset:'a',external_id:String(offset+i),raw:'x'.repeat(payloadBytes)}));
      const before=performance.now();
      await db.records.bulkPut(rows);
      maxChunkMs=Math.max(maxChunkMs,performance.now()-before);
    }
    return {records:await db.records.count(),elapsedMs:performance.now()-start,maxChunkMs,logicalPayloadBytes:count*payloadBytes};
  }finally{db.close();}
}

export async function upgradeProbe(name:string,fail=false) {
  const first=new ProbeDatabase(name);await first.meta.put({id:'preserved',value:'yes'});
  const second=new Dexie(name);
  second.version(1).stores({meta:'id',records:'id,&[dataset+external_id],dataset',receipts:'id,record_id'});
  second.version(2).stores({meta:'id,value'}).upgrade(()=>{if(fail)throw Error('injected_upgrade_failure');});
  let failed=false;
  try{await second.open();}catch{failed=true;}
  const priorClosed=!first.isOpen();second.close();first.close();
  const reopened=fail?new ProbeDatabase(name):new Dexie(name);
  try{await reopened.open();return {failed,priorClosed,value:(await reopened.table('meta').get('preserved')).value,version:reopened.verno};}
  finally{reopened.close();}
}

export async function nativeQuotaWrite(name:string,bytes:number) {
  const db=new ProbeDatabase(name);let code='';
  try {
    try{await db.transaction('rw',db.records,db.receipts,async()=>{
      await db.receipts.add({id:'quota-receipt',record_id:'quota'});
      await db.records.add({id:'quota',dataset:'a',external_id:'quota',raw:'x'.repeat(bytes)});
    });}catch(error){code=error instanceof Error?error.name:'unknown';}
    return {code,records:await db.records.count(),receipts:await db.receipts.count()};
  }finally{db.close();}
}

export async function readProbe(token:string,endpoint:string|null=null,timeoutMs=20000) {
  let calls=0;
  const fetcher:typeof fetch=(url,options)=>{
    if(url!=='https://api.zenmoney.ru/v8/diff/'||options?.method!=='POST')throw Error('unexpected_endpoint');
    const body=JSON.parse(String(options.body)) as Record<string,unknown>;
    if(Object.keys(body).some(key=>!['currentClientTimestamp','serverTimestamp','forceFetch'].includes(key)))throw Error('write_forbidden_in_read_probe');
    if(endpoint && !/^http:\/\/127\.0\.0\.1:\d+\/(?:sdk|slow)$/.test(endpoint))throw Error('unexpected_fixture');
    calls++;return fetch(endpoint??url,options);
  };
  const client=new ZenMoneyClient({token,fetch:fetcher,timeoutMs});
  try {
    const diff=await client.readDiff({serverTimestamp:0});
    const users=Array.isArray(diff.data.user)?diff.data.user:[];
    const owners=users.map(row=>typeof row==='object'&&row!==null&&'id' in row?String(row.id):'').filter(Boolean).sort();
    return {ok:true,calls,owners,cursor:String(diff.serverTimestamp),
      exact:diff.data.fixtureExact===undefined?null:String(diff.data.fixtureExact),
      integer:diff.data.fixtureInteger===undefined?null:String(diff.data.fixtureInteger)};
  }catch(error){return {ok:false,calls,code:error instanceof ZenMoneyError?error.code:'probe_error'};}
  finally{client.close();}
}
