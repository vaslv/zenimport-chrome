/** Bounded private reads of one optimistic financial source, outside long IDB work. */
import type {RowByTable} from '../storage/schema.generated.js';
import type {RepositoryOwner,FinancialSnapshot} from '../storage/repository-owner.js';
export const SOURCE_TABLES=[
  'bank_accounts','bank_transactions','bank_versions','bank_processing','bank_exclusions','zen_exclusions',
  'processing_receipts','processing_targets','deliveries','delivery_attempts','delivery_authorizations',
  'link_groups','link_bank_members','link_zen_members','account_bindings','category_choices','recipient_rules',
  'zen_entities','zen_tombstones','zen_mirror_state','connections','connection_accounts','connection_discovery','coverage','capture_intervals','captured_records',
] as const;
export type SourceTable=typeof SOURCE_TABLES[number];
export type SourceRows={readonly [K in SourceTable]:readonly RowByTable[K][]};
export interface SourceSnapshot{stamp:FinancialSnapshot;rows:SourceRows}
export async function readSource(owner:RepositoryOwner):Promise<SourceSnapshot>{
  const stamp=await owner.snapshot(),rows:Partial<Record<SourceTable,readonly RowByTable[SourceTable][]>>={};
  async function load<K extends SourceTable>(table:K){
    const values:RowByTable[K][]=[];let after:string|null=null;
    for(;;){const page:{rows:RowByTable[K][];after:string|null}=await owner.scan(table,stamp,after);values.push(...page.rows);if(page.rows.length<500)break;after=page.after;}
    rows[table]=values;
  }
  for(const table of SOURCE_TABLES)await load(table);
  await owner.check(stamp);return {stamp,rows:rows as SourceRows};
}
