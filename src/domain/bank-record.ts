/** Bank wire values and legacy clock projections; no storage or transport. */
import {DomainError} from './errors.js';
import {calendarDate} from './dates.js';

function requireValue(value:unknown):asserts value{if(!value)throw new DomainError('invalid_dto');}
function text(value:unknown,min:number,max:number):string{
  requireValue(typeof value==='string'&&value.length>=min&&value.length<=max*2);let count=0;
  for(const char of value){const code=char.codePointAt(0)!;requireValue(code<0xd800||code>0xdfff);requireValue(++count<=max);}
  requireValue(count>=min);return value;
}
const full=(pattern:RegExp,value:string)=>value.match(pattern)?.[0]===value;
function object(value:unknown):Record<string,unknown>{
  requireValue(value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
  return value as Record<string,unknown>;
}
const rfc=/^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,6}))?(Z|[+-][0-9]{2}:[0-9]{2})$/;
export function timestampProjection(value:unknown):{iso:string;micros:bigint}{
  const raw=text(value,1,40),match=raw.match(rfc);requireValue(match!==null&&match[0]===raw);
  const [,day,hour,minute,second,fraction='',zone]=match;calendarDate(day);
  requireValue(+hour<24&&+minute<60&&+second<60);
  if(zone!=='Z')requireValue(+zone.slice(1,3)<24&&+zone.slice(4)<60);
  const whole=day+'T'+hour+':'+minute+':'+second,ms=Date.parse(whole+zone);requireValue(Number.isSafeInteger(ms));
  const micro=fraction.padEnd(6,'0'),offset=zone==='Z'||zone.slice(1)==='00:00'?'Z':zone;
  return {iso:whole+(BigInt(micro)>0n?'.'+micro:'')+offset,micros:BigInt(ms)*1000n+BigInt(micro)};
}

export interface BankRecordValue{
  external_id:string;identity_kind:'bank'|'fingerprint';identity_version:string;occurred_at:string;local_date:string;
  direction:'expense'|'income';amount:string;currency:string;description:string;beneficiary_account:string|null;
  beneficiary_name:string|null;balance:string|null;details_state:'complete'|'unavailable';details:Record<string,string>;
}
const keys=['external_id','identity_kind','identity_version','occurred_at','local_date','direction','amount','currency','description',
  'beneficiary_account','beneficiary_name','balance','details_state','details'];
const MONEY=/^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/;
const BALANCE=/^-?(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/;
export function bankRecord(input:unknown):BankRecordValue{
  const row=object(input);requireValue(Object.keys(row).every(key=>keys.includes(key)));
  const external_id=text(row.external_id,1,240),identity_version=text(row.identity_version,1,40),description=text(row.description,0,2000);
  requireValue(row.identity_kind==='bank'||row.identity_kind==='fingerprint');
  requireValue(row.direction==='expense'||row.direction==='income');requireValue(row.details_state==='complete'||row.details_state==='unavailable');
  const amount=text(row.amount,1,37);requireValue(full(MONEY,amount)&&/[1-9]/.test(amount));
  const currency=text(row.currency,3,12);requireValue(full(/^[A-Z]{3,12}$/,currency));
  const local_date=calendarDate(text(row.local_date,10,10)),occurred_at=timestampProjection(row.occurred_at).iso;
  const optional=(key:string,max:number)=>row[key]===null||row[key]===undefined?null:text(row[key],0,max);
  const beneficiary_account=optional('beneficiary_account',240),beneficiary_name=optional('beneficiary_name',2000),balance=optional('balance',38);
  if(balance!==null)requireValue(full(BALANCE,balance));
  const details:Record<string,string>=Object.create(null),inputDetails=Object.hasOwn(row,'details')?object(row.details):{};
  requireValue(Object.keys(inputDetails).length<=64);
  for(const [key,value]of Object.entries(inputDetails)){text(key,1,240);details[key]=text(value,0,2000);}
  return {external_id,identity_kind:row.identity_kind,identity_version,occurred_at,local_date,direction:row.direction,amount,currency,description,
    beneficiary_account,beneficiary_name,balance,details_state:row.details_state,details};
}

const formatter=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Ho_Chi_Minh',calendar:'gregory',numberingSystem:'latn',era:'short',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function utc(year:number,month:number,day:number,hour:number,minute:number,second:number):number{
  const date=new Date(0);date.setUTCFullYear(year,month-1,day);date.setUTCHours(hour,minute,second,0);return date.getTime();
}
function offsetAt(ms:number):number{
  const parts=formatter.formatToParts(new Date(ms)),part=(name:string)=>parts.find(value=>value.type===name)!.value;
  const year=+part('year'),astronomical=part('era')==='BC'?1-year:year;
  return (utc(astronomical,+part('month'),+part('day'),+part('hour'),+part('minute'),+part('second'))-ms)/1000;
}
function vietnamOffset(wall:number):number{
  const offsets=[...new Set([-172800000,0,172800000].map(delta=>offsetAt(wall+delta)))];
  const candidates=offsets.map(offset=>({offset,instant:wall-offset*1000})).filter(value=>offsetAt(value.instant)===value.offset).sort((a,b)=>a.instant-b.instant);
  // Python fold=0 chooses the earlier instant in an overlap and the prior
  // offset in a nonexistent clock interval. Vietnam's shifts are isolated.
  return candidates[0]?.offset??offsets[0];
}
const clock=/^([0-9]{1,2}| [0-9])([/-])([0-9]{1,2})\2([0-9]{4})[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2})$/;
/** The caller has already validated the legacy raw object and its details. */
export function legacyOccurred(raw:Record<string,unknown>,bank:string,localDate:string):string|null{
  if(bank!=='vietinbank')return null;
  const details=raw.details!==null&&typeof raw.details==='object'&&!Array.isArray(raw.details)?raw.details as Record<string,unknown>:{};
  for(const value of [details.processDate,raw.date]){
    if(typeof value!=='string')continue;
    const match=value.match(clock);if(!match||match[0]!==value)continue;
    const [,d,,m,y,h,minute,second]=match,day=y+'-'+m.padStart(2,'0')+'-'+d.trim().padStart(2,'0');
    try{calendarDate(day);}catch{continue;}
    if(day!==localDate||+h>23||+minute>59||+second>59)continue;
    const offset=vietnamOffset(utc(+y,+m,+d,+h,+minute,+second)),absolute=Math.abs(offset),pad=(n:number)=>String(n).padStart(2,'0');
    const zone=(offset<0?'-':'+')+pad(Math.floor(absolute/3600))+':'+pad(Math.floor(absolute/60)%60)+(absolute%60?':'+pad(absolute%60):'');
    return day+'T'+pad(+h)+':'+pad(+minute)+':'+pad(+second)+zone;
  }
  return null;
}
