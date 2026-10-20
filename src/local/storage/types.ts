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

export function storageFailure(error:unknown):StorageError{
  if(error instanceof StorageError)return error;
  const pending:unknown[]=[error],seen=new Set<object>(),names=new Set<string>();let budget=1024;
  while(pending.length&&budget-->0){
    const value=pending.shift();if(!(value instanceof Error)||seen.has(value))continue;seen.add(value);
    if(value instanceof StorageError)return value;
    names.add(value.name);
    const nested=value as Error & {inner?:unknown;failures?:unknown[]};
    if(nested.inner!==undefined)pending.push(nested.inner);
    if(value.name==='BulkError'&&Array.isArray(nested.failures))pending.push(...nested.failures.slice(0,500));
  }
  return new StorageError(names.has('QuotaExceededError')?'quota_exceeded':names.has('VersionError')?'schema_unsupported':
    names.has('ConstraintError')?'constraint_violation':'storage_corrupt');
}
