/** Physical mirror versions are private; portable tables remain one logical graph. */
import type {FinancialDatabase} from './database.js';
import type {TableName} from './schema.generated.js';
import {requireStorage} from './types.js';
export const MIRROR_TABLES=['zen_entities','zen_movements','zen_tags','zen_sync_runs','zen_deletions','zen_tombstones'] as const;
export function isMirrorTable(table:TableName){return (MIRROR_TABLES as readonly string[]).includes(table);}
export async function mirrorScope(db:FinancialDatabase,generation:string):Promise<string>{
  const control=(await db.applicationState.get('mirror:'+generation))?.value;
  const scope=control?.projectionGeneration;if(scope===undefined||scope===null)return generation;
  requireStorage(typeof scope==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(scope)&&scope!==generation,'storage_corrupt');
  const version=(await db.applicationState.get('mirror-view:'+scope))?.value;
  requireStorage(version?.generation===generation&&version.state==='active','storage_corrupt');return scope;
}
