import {fold, unassigned} from './unicode-data.js';
import {DomainError} from './errors.js';

function known(code: number): boolean {
  let low = 0, high = unassigned.length;
  while (low < high) {
    const middle = (low + high) >>> 1, [start, end] = unassigned[middle];
    if (code < start) high = middle;
    else if (code > end) low = middle + 1;
    else return false;
  }
  return true;
}

/** Python Unicode 15 NFKC + full casefold + split, not JavaScript lowercasing. */
export function normalized(value: string | null | undefined): string {
  const text = value ?? '';
  if (typeof text !== 'string' || text.length > 32768 || [...text].length > 16384) throw new DomainError('invalid_dto');
  for (const char of text) if (!known(char.codePointAt(0)!)) throw new DomainError('unsupported_unicode');
  let result = '';
  for (const char of text.normalize('NFKC')) result += fold[char] ?? char;
  // Python str.split includes U+001C..001F/U+0085, but excludes U+FEFF.
  return result.split(/[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/u).filter(Boolean).join(' ');
}

export function recipient(row: {beneficiary_account?: string | null; beneficiary_name?: string | null; description?: string | null}): string | null {
  const account = normalized(row.beneficiary_account), name = normalized(row.beneficiary_name), description = normalized(row.description);
  return account ? 'account:' + account : name ? 'name:' + name : [...description].length >= 6 ? 'description:' + description : null;
}
