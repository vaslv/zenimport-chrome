/** Offline native interop bridge; excluded from product assets and RPC handlers. */
import type {ContextFence,SentinelPort} from '../../control/types.js';
import {FinancialDatabase} from './database.js';
import {copyInactiveStage} from './inactive-copy.js';

export async function archiveProbe(name:string,port:SentinelPort,fence:ContextFence,id:string){
  const db=new FinancialDatabase(name,false),parts:Uint8Array[]=[];await db.open();
  try{
    const result=await copyInactiveStage(db,port,fence,id,'2026-10-21T00:00:00.000Z',{
      async write(part){parts.push(part.slice());},
    });
    let raw='';for(const part of parts)for(let offset=0;offset<part.length;offset+=8192)raw+=String.fromCharCode(...part.subarray(offset,offset+8192));
    return {datasetDigest:result.manifest.dataset_digest,archiveSha256:result.archiveSha256,base64:btoa(raw)};
  }finally{db.close();}
}
