import {decodeJson, encodeJson, ExactDecimal} from 'zenmoney-typescript';
import {DomainError} from './errors.js';
import {ExactMoney} from './money.js';

/** Convert a known financial field, never a binary floating-point amount. */
export function moneyFromWire(value: unknown): ExactMoney {
  if (typeof value === 'bigint' || (typeof value === 'number' && Number.isSafeInteger(value)))
    return ExactMoney.parse(String(value));
  if (!(value instanceof ExactDecimal)) throw new DomainError('invalid_amount');
  const token = value.toString();
  if (token.length > 256) throw new DomainError('amount_overflow');
  const [mantissa, exponent = '0'] = token.toLowerCase().split('e');
  const [integer, fraction = ''] = mantissa.replace(/^-/, '').split('.');
  let digits = (integer + fraction).replace(/^0+/, '');
  if (!digits) return ExactMoney.parse('0');
  let shift = BigInt(exponent) - BigInt(fraction.length);
  while (digits.endsWith('0')) { digits = digits.slice(0, -1); shift++; }
  const point = BigInt(digits.length) + shift;
  if (point > 96n || shift < -96n) throw new DomainError('amount_overflow');
  const position = Number(point);
  const text = position <= 0 ? '0.' + '0'.repeat(-position) + digits :
    position >= digits.length ? digits + '0'.repeat(position - digits.length) : digits.slice(0, position) + '.' + digits.slice(position);
  return ExactMoney.parse((mantissa.startsWith('-') ? '-' : '') + text);
}

export function moneyToWire(value: ExactMoney): ExactDecimal { return new ExactDecimal(value.toString()); }

export function rawRoundtrip(raw: string): string {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 2_000_000) throw new DomainError('invalid_dto');
  try { return encodeJson(decodeJson(raw)); } catch { throw new DomainError('invalid_dto'); }
}

function compareKeys(a: string, b: string): number {
  const left = [...a], right = [...b];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = left[i].codePointAt(0)! - right[i].codePointAt(0)!;
    if (difference) return difference;
  }
  return left.length - right.length;
}

/** Frozen capture-policy canonical DTO: sorted keys and Python ASCII escaping.
 * Portable-v2 canonical encoding is a separate contract and does not use this.
 */
function canonicalBounded(value: unknown, maxBytes:number): string {
  const seen = new Set<object>(); let nodes = 0, bytes = 0;
  const piece = (value: string) => {
    bytes += value.length; // Canonical output is ASCII, so bytes equal code units.
    if (bytes > maxBytes) throw new DomainError('invalid_dto');
    return value;
  };
  const quote = (text: string) => {
    if (text.length > maxBytes) throw new DomainError('invalid_dto');
    // Reject lone surrogates rather than creating nonportable identity strings.
    for (const char of text) { const code = char.codePointAt(0)!; if (code >= 0xd800 && code <= 0xdfff) throw new DomainError('invalid_dto'); }
    return piece(JSON.stringify(text).replace(/[\u007f-\uffff]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')));
  };
  function encode(item: unknown, depth: number): string {
    if (++nodes > 100000 || depth > 64) throw new DomainError('invalid_dto');
    if (item === null) return piece('null');
    if (typeof item === 'string') return quote(item);
    if (typeof item === 'boolean') return piece(String(item));
    if (typeof item === 'number' && Number.isSafeInteger(item) && !Object.is(item, -0)) return piece(String(item));
    if (typeof item !== 'object' || seen.has(item)) throw new DomainError('invalid_dto');
    const array = Array.isArray(item);
    if (Object.getPrototypeOf(item) !== (array ? Array.prototype : Object.prototype) && Object.getPrototypeOf(item) !== null)
      throw new DomainError('invalid_dto');
    if (Object.getOwnPropertySymbols(item).length) throw new DomainError('invalid_dto');
    const fields = Object.getOwnPropertyDescriptors(item);
    if (Object.values(fields).some(field => !('value' in field))) throw new DomainError('invalid_dto');
    seen.add(item);
    let result: string;
    if (array) {
      if (item.length > 100000 || Object.keys(fields).length !== item.length + 1) throw new DomainError('invalid_dto');
      piece('[]' + ','.repeat(Math.max(0, item.length - 1)));
      result = '[' + Array.from({length: item.length}, (_, i) => {
        const field = fields[String(i)];
        if (!field || !field.enumerable) throw new DomainError('invalid_dto');
        return encode(field.value, depth + 1);
      }).join(',') + ']';
    } else {
      const keys = Object.keys(fields);
      if (keys.some(key => !fields[key].enumerable)) throw new DomainError('invalid_dto');
      piece('{}' + ':'.repeat(keys.length) + ','.repeat(Math.max(0, keys.length - 1)));
      result = '{' + keys.sort(compareKeys).map(key => quote(key) + ':' + encode(fields[key].value, depth + 1)).join(',') + '}';
    }
    seen.delete(item); return result;
  }
  const result = encode(value, 0);
  if (new TextEncoder().encode(result).length > maxBytes) throw new DomainError('invalid_dto');
  return result;
}

export function canonicalDto(value:unknown):string{return canonicalBounded(value,2_000_000);}

/** Stored capture expands Unicode to ASCII; its row budget is not HTTP's cap. */
export function canonicalStoredDto(value:unknown):string{return canonicalBounded(value,128*1024*1024);}

export async function dtoDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalDto(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
