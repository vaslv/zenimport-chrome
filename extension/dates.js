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

// Display in the browser's local time zone; bank calendar helpers above are separate.
export function syncTime(value, now = Date.now()) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const seconds = Math.max(0, Math.floor((now-time)/1000));
  const [amount,unit] = seconds<60 ? [0,'second'] : seconds<3600 ? [Math.floor(seconds/60),'minute'] :
    seconds<86400 ? [Math.floor(seconds/3600),'hour'] : [Math.floor(seconds/86400),'day'];
  return {
    date: new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(time),
    ago: seconds<60 ? 'just now' : new Intl.RelativeTimeFormat('en-GB',{numeric:'always'}).format(-amount,unit),
  };
}
