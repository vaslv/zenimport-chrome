export type DomainErrorCode = 'invalid_amount' | 'amount_overflow' | 'unsupported_scale' |
  'invalid_bank_amount' | 'invalid_date' | 'invalid_timezone' | 'unsupported_unicode' |
  'invalid_dto' | 'unsupported_command' | 'unsupported_scenario';

/** Stable codes cross the application boundary; inputs and secrets never do. */
export class DomainError extends Error {
  constructor(readonly code: DomainErrorCode) { super(code); this.name = 'DomainError'; }
}
