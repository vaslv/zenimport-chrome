/** Inclusive calendar coverage, contiguous frontier and explicit reimport policy. */
import {calendarDate} from './dates.js';
import {DomainError} from './errors.js';
export type DayRange=readonly [string,string];
const min=(a:string,b:string)=>a<b?a:b,max=(a:string,b:string)=>a>b?a:b;
export function shiftDays(value:string,days:number){
  calendarDate(value);if(!Number.isSafeInteger(days)||Math.abs(days)>3660000)throw new DomainError('invalid_date');
  const date=new Date(value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+days);
  const result=date.toISOString().slice(0,10);return calendarDate(result);
}
function checked(ranges:readonly DayRange[]){
  if(ranges.length>100000)throw new DomainError('invalid_dto');
  return ranges.map(([left,right])=>{calendarDate(left);calendarDate(right);if(left>right)throw new DomainError('invalid_date');return [left,right] as DayRange;}).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:a[1]>b[1]?1:0);
}
export function frontier(start:string,coverage:readonly DayRange[]):string|null{
  calendarDate(start);let cursor=start;
  for(const [left,right] of checked(coverage)){if(left>cursor)break;if(right>=cursor)cursor=shiftDays(right,1);}
  return cursor>start?shiftDays(cursor,-1):null;
}
export function plannedRanges(start:string,end:string,coverage:readonly DayRange[],forced:string|null):DayRange[]{
  calendarDate(start);calendarDate(end);if(start>end)throw new DomainError('invalid_date');
  if(forced!==null){calendarDate(forced);if(forced>end)throw new DomainError('invalid_date');return [[forced,end]];}
  const contiguous=frontier(start,coverage);
  if(contiguous!==null&&contiguous>=end)return [[max(start,shiftDays(min(contiguous,end),-14)),end]];
  let cursor=contiguous?max(start,shiftDays(contiguous,-14)):start;const result:DayRange[]=[];
  const overlapEnd=contiguous?min(contiguous,end):null;
  if(overlapEnd&&cursor<=overlapEnd){result.push([cursor,overlapEnd]);cursor=shiftDays(overlapEnd,1);}
  for(const [left,right] of checked(coverage)){
    if(right<cursor||left>end)continue;
    if(left>cursor)result.push([cursor,min(end,shiftDays(left,-1))]);
    cursor=max(cursor,shiftDays(right,1));
  }
  if(cursor<=end)result.push([cursor,end]);return result;
}
export function mergeRanges(ranges:readonly DayRange[]):DayRange[]{
  const result:DayRange[]=[];for(const [left,right]of checked(ranges)){
    const last=result.at(-1);
    if(last&&left<=shiftDays(last[1],1))result[result.length-1]=[last[0],max(last[1],right)];else result.push([left,right]);
  }return result;
}
export function chunks(ranges:readonly DayRange[],days:number):DayRange[]{
  if(!Number.isSafeInteger(days)||days<1||days>366)throw new DomainError('invalid_dto');
  const result:DayRange[]=[];for(let [left,right]of checked(ranges))while(left<=right){
    const end=min(right,shiftDays(left,days-1));result.push([left,end]);if(result.length>10000)throw new DomainError('invalid_dto');left=shiftDays(end,1);
  }return result;
}
export function subtractRange(ranges:readonly DayRange[],start:string,end:string):DayRange[]{
  checked([[start,end]]);const result:DayRange[]=[];for(const [left,right]of checked(ranges)){
    if(right<start||left>end)result.push([left,right]);else{
      if(left<start)result.push([left,shiftDays(start,-1)]);if(right>end)result.push([shiftDays(end,1),right]);
    }
  }return result;
}
