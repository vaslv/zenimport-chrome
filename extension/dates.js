export function today(timeZone = 'Asia/Ho_Chi_Minh', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone, year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(now);
  const value = kind => parts.find(part => part.type === kind).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
export function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function daysAgo(days, end = today()) {
  const date = new Date(end + 'T00:00:00Z'); date.setUTCDate(date.getUTCDate() - days); return date.toISOString().slice(0,10);
}
export function monthsAgo(months, end = today()) {
  const date = new Date(end + 'T00:00:00Z'), day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth()+1,0)).getUTCDate();
  date.setUTCDate(Math.min(day,last)); return date.toISOString().slice(0,10);
}
