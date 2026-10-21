/** Pure lossless mirror projection; the archived raw response is authoritative. */
import {decodeJson,encodeJson,entityKey,KINDS,ExactDecimal} from 'zenmoney-typescript';
import type {JsonObject} from 'zenmoney-typescript';
import {calendarDate} from '../../domain/dates.js';
import {mirrorAmountText,mirrorFlagText} from '../../domain/python-decimal.js';
import {int64} from '../storage/types.js';
import type {Int64Text} from '../storage/types.js';
import type {RowByTable} from '../storage/schema.generated.js';
import {LocalZenMoneyError} from './errors.js';
import {jsonTruthy} from '../portable/json-values.js';
function fail():never{throw new LocalZenMoneyError('zenmoney_response');}
const object=(value:unknown):value is JsonObject=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&!(value instanceof ExactDecimal);
const stamp=(value:unknown)=>{if(!(typeof value==='bigint'||typeof value==='number'&&Number.isSafeInteger(value))||value<0)fail();return int64(String(value));};
const identifier=(value:unknown)=>{if(!(typeof value==='string'&&value.length>0||typeof value==='bigint'||typeof value==='number'&&Number.isSafeInteger(value)))fail();return String(value);};
export interface PreparedMirror{
  raw:string;cursor:Int64Text;full:boolean;kinds:string[];owners:string[]|null;
  entities:RowByTable['zen_entities'][];movements:RowByTable['zen_movements'][];tags:RowByTable['zen_tags'][];
  tombstones:RowByTable['zen_tombstones'][];deletions:RowByTable['zen_deletions'][];
}
export function prepareMirror(raw:string,requestedCursor:string,full:boolean,runId:string,uuid:()=>string=()=>crypto.randomUUID()):PreparedMirror{
  try{
    const data=decodeJson(raw);if(!object(data)||jsonTruthy(data.error))fail();const cursor=stamp(data.serverTimestamp);
    if(BigInt(cursor)<BigInt(requestedCursor))fail();
    if(full&&!['user','account','instrument','tag','transaction'].every(kind=>Object.hasOwn(data,kind)))fail();
    const result:PreparedMirror={raw,cursor,full,kinds:[],owners:null,entities:[],movements:[],tags:[],tombstones:[],deletions:[]};
    for(const kind of KINDS){
      if(!Object.hasOwn(data,kind))continue;const rows=data[kind];if(!Array.isArray(rows))fail();result.kinds.push(kind);const seen=new Set<string>();
      for(const item of rows as JsonObject[]){
        if(!object(item))fail();const id=entityKey(kind,item);if(seen.has(id))fail();seen.add(id);
        const deleted=int64(mirrorFlagText(item.deleted)??'0'),text=encodeJson(item);
        result.entities.push({kind,id,data:text,changed:item.changed==null?null:stamp(item.changed),deleted,run_id:runId});
        if(deleted==='1')result.tombstones.push({kind,entity_id:id,reason:'soft_delete',data:text});
        if(['transaction','reminder','reminderMarker'].includes(kind)){
          const day=item[kind==='reminder'?'startDate':'date']??null;if(day!==null){if(typeof day!=='string')fail();calendarDate(day as string);}
          const tags=item.tag??[];if(!Array.isArray(tags)||tags.some(tag=>typeof tag!=='string'||!tag)||new Set(tags).size!==tags.length)fail();
          const field=(key:string)=>item[key]==null?null:identifier(item[key]);
          result.movements.push({kind,id,date:day as string|null,income_account:field('incomeAccount'),outcome_account:field('outcomeAccount'),
            income_instrument:field('incomeInstrument'),outcome_instrument:field('outcomeInstrument'),income:mirrorAmountText(item.income),outcome:mirrorAmountText(item.outcome),
            viewed:item.viewed==null?null:int64(mirrorFlagText(item.viewed)),hold:item.hold==null?null:int64(mirrorFlagText(item.hold))});
          (tags as string[]).forEach((tag,i)=>result.tags.push({kind,entity_id:id,tag_id:tag,position:int64(String(i))}));
        }
      }
    }
    if(Object.hasOwn(data,'deletion')&&!Array.isArray(data.deletion))fail();
    for(const item of (data.deletion??[]) as JsonObject[]){
      if(!object(item)||typeof item.object!=='string'||!item.object)fail();const kind=item.object as string,id=identifier(item.id),text=encodeJson(item);
      result.deletions.push({id:uuid(),run_id:runId,kind,entity_id:id,data:text});result.tombstones.push({kind,entity_id:id,reason:'hard_delete',data:text});
    }
    if(full){
      result.owners=result.entities.filter(row=>row.kind==='user'&&row.deleted==='0'&&
        !result.deletions.some(deletion=>deletion.kind==='user'&&deletion.entity_id===row.id)).map(row=>row.id).sort();
      if(!result.owners.length||result.owners.some(id=>!/^[1-9][0-9]*$/.test(id)))fail();
    }
    return result;
  }catch(error){if(error instanceof LocalZenMoneyError)throw error;throw new LocalZenMoneyError('zenmoney_response');}
}
