/** Public capture codes; details, records and credentials never enter errors. */
export type CaptureCode='validation_error'|'unsupported_bank'|'unsupported_currency'|'not_found'|'settings_conflict'|
  'capture_context_changed'|'account_disabled'|'account_unconfigured'|'account_busy'|'capture_busy'|'lease_expired'|
  'idempotency_conflict'|'history_incomplete'|'zenmoney_unavailable'|'zenmoney_account_unavailable'|'delivery_uncertain';
export class CaptureError extends Error{
  constructor(readonly code:CaptureCode,readonly retryable=false){super(code);this.name='CaptureError';}
}
export function requireCapture(value:unknown,code:CaptureCode='validation_error'):asserts value{if(!value)throw new CaptureError(code);}
