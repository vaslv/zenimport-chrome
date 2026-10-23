/** Bounded private reads of one optimistic financial source, outside long IDB work. */
import type {RowByTable} from '../storage/schema.generated.js';
import type {RepositoryOwner,FinancialSnapshot} from '../storage/repository-owner.js';
import {SOURCE_TABLES} from './source-tables.js';
import type {SourceTable,SourceRows} from './source-tables.js';
export {SOURCE_TABLES} from './source-tables.js';
export type {SourceTable,SourceRows} from './source-tables.js';
import {cachedSource,rememberSource} from '../storage/source-cache.js';
export interface SourceSnapshot{stamp:FinancialSnapshot;rows:SourceRows}
export async function readSource(owner:RepositoryOwner):Promise<SourceSnapshot>{
  const stamp=await owner.snapshot(),cached=cachedSource(owner.sourceCacheKey,stamp);
  if(cached){await owner.check(stamp);return {stamp,rows:cached};}
  const rows:Partial<Record<SourceTable,readonly RowByTable[SourceTable][]>>={};
  async function load<K extends SourceTable>(table:K){
    const values:RowByTable[K][]=[];let after:string|null=null;
    for(;;){const page:{rows:RowByTable[K][];after:string|null}=await owner.scan(table,stamp,after);values.push(...page.rows);if(page.rows.length<500)break;after=page.after;}
    rows[table]=values;
  }
  for(const table of SOURCE_TABLES)await load(table);
  await owner.check(stamp);rememberSource(owner.sourceCacheKey,stamp,rows as SourceRows);return {stamp,rows:rows as SourceRows};
}
