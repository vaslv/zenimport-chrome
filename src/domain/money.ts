import {DomainError} from './errors.js';

const INTEGER_DIGITS = 96;
const FRACTION_DIGITS = 96;
const PLAIN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const BANK = /^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/;
const power = (scale: number) => 10n ** BigInt(scale);

/** Finite decimal arithmetic. Number is used only for bounded scale metadata. */
export class ExactMoney {
  private constructor(readonly coefficient: bigint, readonly scale: number) { Object.freeze(this); }

  private static normalized(coefficient: bigint, scale: number): ExactMoney {
    if (coefficient === 0n) return new ExactMoney(0n, 0);
    while (scale > 0 && coefficient % 10n === 0n) { coefficient /= 10n; scale--; }
    const digits = (coefficient < 0n ? -coefficient : coefficient).toString().length;
    if (scale > FRACTION_DIGITS || digits - scale > INTEGER_DIGITS) throw new DomainError('amount_overflow');
    return new ExactMoney(coefficient, scale);
  }

  static parse(text: string): ExactMoney {
    if (typeof text !== 'string' || text.length > 256 || text.match(PLAIN)?.[0] !== text)
      throw new DomainError('invalid_amount');
    const [integer, fraction = ''] = text.replace(/^-/, '').split('.');
    if (integer.length > INTEGER_DIGITS || fraction.length > FRACTION_DIGITS) throw new DomainError('amount_overflow');
    const coefficient = BigInt(integer + fraction) * (text.startsWith('-') ? -1n : 1n);
    return ExactMoney.normalized(coefficient, fraction.length);
  }

  /** Validate lexical currency scale before normalization; never round a bank row. */
  static bank(text: string, scale = 12): ExactMoney {
    if (typeof text !== 'string' || text.length > 37 || text.match(BANK)?.[0] !== text)
      throw new DomainError('invalid_bank_amount');
    if (!Number.isInteger(scale) || scale < 0 || scale > 12 || (text.split('.')[1]?.length ?? 0) > scale)
      throw new DomainError('unsupported_scale');
    const value = ExactMoney.parse(text);
    if (value.sign() !== 1) throw new DomainError('invalid_bank_amount');
    return value;
  }

  static sum(values: Iterable<ExactMoney>): ExactMoney {
    let sum = ExactMoney.parse('0');
    for (const value of values) sum = sum.add(value);
    return sum;
  }

  add(other: ExactMoney): ExactMoney {
    const scale = Math.max(this.scale, other.scale);
    return ExactMoney.normalized(this.coefficient * power(scale - this.scale) +
      other.coefficient * power(scale - other.scale), scale);
  }
  negate(): ExactMoney { return new ExactMoney(-this.coefficient, this.scale); }
  subtract(other: ExactMoney): ExactMoney { return this.add(other.negate()); }
  compare(other: ExactMoney): -1 | 0 | 1 {
    const scale = Math.max(this.scale, other.scale);
    const left = this.coefficient * power(scale - this.scale), right = other.coefficient * power(scale - other.scale);
    return left < right ? -1 : left > right ? 1 : 0;
  }
  equals(other: ExactMoney): boolean { return this.compare(other) === 0; }
  sign(): -1 | 0 | 1 { return this.coefficient < 0n ? -1 : this.coefficient > 0n ? 1 : 0; }
  toString(): string {
    const digits = (this.coefficient < 0n ? -this.coefficient : this.coefficient).toString().padStart(this.scale + 1, '0');
    const value = this.scale ? digits.slice(0, -this.scale) + '.' + digits.slice(-this.scale) : digits;
    return (this.coefficient < 0n ? '-' : '') + value;
  }
  valueOf(): never { throw new TypeError('ExactMoney requires an explicit decimal string'); }
}

export interface Movement {
  income?: string; outcome?: string; incomeAccount?: string | null; outcomeAccount?: string | null;
  incomeInstrument?: string | null; outcomeInstrument?: string | null;
}

/** Both transfer sides are considered, including transfers within one account. */
export function signedMovement(tx: Movement, target: string, instrument: string): ExactMoney | null {
  let result = ExactMoney.parse('0');
  for (const side of ['income', 'outcome'] as const) {
    const amount = ExactMoney.parse(tx[side] ?? '0');
    if (tx[`${side}Account`] === target && amount.sign() !== 0) {
      if (tx[`${side}Instrument`] !== instrument) return null;
      result = result.add(side === 'income' ? amount : amount.negate());
    }
  }
  return result;
}
