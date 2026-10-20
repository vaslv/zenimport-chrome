import {DomainError} from './errors.js';

const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const TIMESTAMP = /^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]{1,6})?(Z|[+-]([0-9]{2}):([0-9]{2}))$/;
const daysInMonth = (year: number, month: number) => [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];

export function calendarDate(text: string): string {
  if (typeof text !== 'string' || text.match(DATE)?.[0] !== text) throw new DomainError('invalid_date');
  const [year, month, day] = text.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) throw new DomainError('invalid_date');
  return text;
}

export function shiftMonths(day: string, delta: number): string {
  calendarDate(day);
  if (!Number.isInteger(delta) || Math.abs(delta) > 1200) throw new DomainError('invalid_date');
  const [year, month, date] = day.split('-').map(Number), ordinal = year * 12 + month - 1 + delta;
  const nextYear = Math.floor(ordinal / 12), nextMonth = ordinal % 12 + 1;
  if (nextYear < 1 || nextYear > 9999) throw new DomainError('invalid_date');
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-${String(Math.min(date, daysInMonth(nextYear, nextMonth))).padStart(2, '0')}`;
}

export function localDay(timestamp: string, timezone: string): string {
  if (typeof timestamp !== 'string') throw new DomainError('invalid_date');
  const match = timestamp.match(TIMESTAMP);
  if (!match || match[0] !== timestamp) throw new DomainError('invalid_date');
  calendarDate(match[1]);
  if (+match[2] > 23 || +match[3] > 59 || +match[4] > 59 || +(match[6] ?? '0') > 23 || +(match[7] ?? '0') > 59)
    throw new DomainError('invalid_date');
  const value = new Date(timestamp);
  if (!Number.isFinite(value.getTime())) throw new DomainError('invalid_date');
  let parts: Intl.DateTimeFormatPart[];
  try { parts = new Intl.DateTimeFormat('en-CA', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', era: 'short'}).formatToParts(value); }
  catch { throw new DomainError('invalid_timezone'); }
  const field = (key: string) => parts.find(part => part.type === key)?.value ?? '';
  if (field('era') !== 'AD') throw new DomainError('invalid_date');
  return calendarDate(`${field('year').padStart(4, '0')}-${field('month')}-${field('day')}`);
}
