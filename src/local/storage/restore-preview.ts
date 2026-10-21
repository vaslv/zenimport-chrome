/** A fresh SDK projection is used only for preview, never to rewrite archive facts. */
import type {GraphReader} from '../portable/relations.js';
import {SOURCE_TABLES} from '../reconciliation/source.js';
import type {SourceRows,SourceTable,SourceSnapshot} from '../reconciliation/source.js';
import type {RowByTable} from './schema.generated.js';
import {sourceFacts} from '../reconciliation/facts.js';
import {buildReport} from '../reports/build.js';
import {CaptureError} from '../capture/errors.js';
import {prepareMirror} from '../zenmoney/projection.js';
import {int64,requireStorage} from './types.js';
import type {RestoreIntent,RestorePreview} from './restore-control.js';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
export async function restorePreview(reader:GraphReader,intent:RestoreIntent,raw:string,sourceHash:string,now:string):Promise<RestorePreview>{
  const values:Partial<Record<SourceTable,readonly RowByTable[SourceTable][]>>={};
  for(const table of SOURCE_TABLES){const rows=[];for await(const row of reader.rows(table))rows.push(row);values[table]=rows;}
  const old=values as SourceRows,projection=crypto.randomUUID(),fresh=prepareMirror(raw,'0',true,projection);
  requireStorage(JSON.stringify(fresh.owners)===JSON.stringify(JSON.parse(intent.manifest).zenmoney_identity.owner_ids),'dataset_not_writable');
  const rows:SourceRows={...old,zen_entities:fresh.entities,zen_tombstones:[...old.zen_tombstones,...fresh.tombstones],
    zen_mirror_state:[{...old.zen_mirror_state[0],id:int64('1'),source_hash:sourceHash,cursor:fresh.cursor,generation:int64('1'),ready:int64('1'),needs_full:int64('0'),refreshed_at:int64(now),error_code:null}]};
  // This transient read stamp is never accepted by a repository/writer. It binds
  // the existing report algorithm to the actual SDK snapshot and archived facts.
  const source:SourceSnapshot={rows,stamp:{generation:intent.generation,epoch:String(BigInt(intent.initialRoot.epoch)+1n),credentialEpoch:intent.initialRoot.credentialEpoch,
    credentialRef:intent.credentialRef,participantId:intent.participantId,participantEpoch:'1',revision:'0',projection,mirror:JSON.stringify(rows.zen_mirror_state[0]),
    mirrorControl:JSON.stringify({lease:null,failures:'0',nextAt:'0',error:null,projectionGeneration:projection,forceFull:false})}};
  const facts=sourceFacts(source),missing=new Set<string>(),extras=new Set<string>(),unchecked=new Set<string>();
  for(const connection of rows.connections){
    try{const report=buildReport(source,facts,{connection_id:connection.id},now);
      for(const day of report.days){for(const row of day.bank_operations)missing.add(row.id);for(const row of day.operations)extras.add(JSON.stringify([day.account_id,row.id]));}
      for(const account of report.accounts)if(account.status!=='ready'||account.unchecked_days>0)unchecked.add(account.id);
    }catch(error){if(!(error instanceof CaptureError))throw error;for(const account of rows.bank_accounts)if(rows.connection_accounts.some(link=>link.connection_id===connection.id&&link.account_id===account.id))unchecked.add(account.id);}
  }
  return {id:crypto.randomUUID(),archiveSha256:intent.archiveSha256,sdkSha256:bytesToHex(sha256(new TextEncoder().encode(raw))),cursor:fresh.cursor,sourceHash,checkedAt:now,
    bankTransactions:String(rows.bank_transactions.length),zenTransactions:String(facts.transactions.size),missingBank:missing.size,extraZen:extras.size,uncheckedAccounts:unchecked.size};
}
