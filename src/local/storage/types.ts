/** SQLite integer text stays exact in IndexedDB, SDK boundaries and Chrome DTOs. */
export type Int64Text=string & {readonly __int64:unique symbol};
export type Scalar=readonly ['null'] | readonly ['text',string] | readonly ['integer',Int64Text];
export type TaggedRow=readonly Scalar[];
export type StorageErrorCode='invalid_row'|'invalid_key'|'constraint_violation'|'invariant_violation'|
  'storage_missing'|'storage_corrupt'|'recovery_required'|'schema_unsupported'|'dataset_not_writable'|
  'stale_epoch'|'quota_exceeded';

export class StorageError extends Error{
  constructor(readonly code:StorageErrorCode){super(code);this.name='StorageError';}
}

export function requireStorage(condition:unknown,code:StorageErrorCode='invalid_row'):asserts condition{
  if(!condition)throw new StorageError(code);
}

export function int64(value:unknown):Int64Text{
  requireStorage(typeof value==='string' && value.length<=20 && /^(?:0|-?[1-9][0-9]*)$/.test(value));
  const result=BigInt(value);
  requireStorage(result>=-(1n<<63n) && result<(1n<<63n));
  return value as Int64Text;
}
