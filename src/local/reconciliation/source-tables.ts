import type {RowByTable} from '../storage/schema.generated.js';
export const SOURCE_TABLES=[
  'bank_accounts','bank_transactions','bank_versions','bank_processing','bank_exclusions','zen_exclusions',
  'processing_receipts','processing_targets','deliveries','delivery_attempts','delivery_authorizations',
  'link_groups','link_bank_members','link_zen_members','account_bindings','category_choices','recipient_rules',
  'capture_errors','capture_jobs','job_accounts','zen_entities','zen_tombstones','zen_mirror_state','connections','connection_accounts','connection_discovery','coverage','capture_intervals','captured_records',
] as const;
export type SourceTable=typeof SOURCE_TABLES[number];
export type SourceRows={readonly [K in SourceTable]:readonly RowByTable[K][]};
