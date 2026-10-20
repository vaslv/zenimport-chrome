/** Raw mirror and exact movement projections; no API call or owner adoption. */
import {entityKey} from 'zenmoney-typescript';
import type {JsonObject} from 'zenmoney-typescript';
import {calendarDate} from '../../domain/dates.js';
import {mirrorAmountText,mirrorFlagText} from '../../domain/python-decimal.js';
import type {GraphReader} from './relations.js';
import type {PortableManifest} from './format.js';
import {requirePortable,utf8} from './format.js';
import {financialObject,jsonEqual,scalarText,tupleText} from './json-values.js';
import {LegacyFacts} from './legacy-facts.js';
import {int64} from '../storage/types.js';
import type {LegacyValue,LegacyTag} from './legacy-facts.js';

const text=(value:string)=>['text',value] as const;
const movementKinds=new Set(['transaction','reminder','reminderMarker']);
const compareText=(left:string,right:string)=>{
  const a=utf8.encode(left),b=utf8.encode(right);for(let i=0;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i])return a[i]-b[i];return a.length-b.length;
};
function compareLegacy(left:LegacyValue,right:LegacyValue):number{
  if(left===right)return 0;if(left===null)return -1;if(right===null)return 1;
  if(typeof left==='bigint')return typeof right==='bigint'?left<right?-1:1:-1;
  if(typeof right==='bigint')return 1;return compareText(left,right);
}
const orderedTags=(tags:readonly LegacyTag[])=>[...tags].sort((left,right)=>compareLegacy(left.position,right.position)||compareLegacy(left.tag,right.tag)).map(value=>[value.tag,value.position]);
const identity=(kind:string,data:JsonObject,id:string)=>requirePortable(entityKey(kind,data)===id,'invalid_entity_identity');

export async function validateMirror(reader:GraphReader,manifest:PortableManifest,legacy:LegacyFacts):Promise<void>{
  requirePortable(await reader.find('zen_mirror_state',['id'],[['integer',int64('1')]])!==null,'missing_mirror_context');
  const tags=new Map<string,LegacyTag[]>(),owners:string[]=[];
  for await(const row of reader.rows('zen_tags')){
    const key=tupleText(row.kind,row.entity_id),values=tags.get(key)??[];
    values.push({tag:row.tag_id,position:BigInt(row.position)});tags.set(key,values);
  }
  for await(const entity of reader.rows('zen_entities')){
    if(movementKinds.has(entity.kind))requirePortable(await reader.find('zen_movements',['kind','id'],[text(entity.kind),text(entity.id)])!==null,'missing_mirror_projection');
    if(entity.deleted==='0'){
      identity(entity.kind,financialObject(entity.data,'invalid_entity_identity'),entity.id);
      if(entity.kind==='user')owners.push(entity.id);
    }
  }
  for await(const row of reader.rows('zen_movements')){
    const entity=await reader.find('zen_entities',['kind','id'],[text(row.kind),text(row.id)]);requirePortable(entity!==null,'invalid_relationship');
    const data=financialObject(entity.data,'invalid_mirror_projection');identity(row.kind,data,row.id);
    const actual=[row.date,row.income_account,row.outcome_account,row.income_instrument,row.outcome_instrument,row.income,row.outcome,
      row.viewed===null?null:BigInt(row.viewed),row.hold===null?null:BigInt(row.hold)];
    const all=legacy.movements(row.kind,row.id,entity.data),proofs=all.filter(proof=>jsonEqual(proof.projection,actual));
    const historical=entity.run_id===null?all.length>0:entity.run_id.startsWith('legacy:');
    const actualTags=orderedTags(tags.get(tupleText(row.kind,row.id))??[]);
    if(proofs.length||historical){
      requirePortable(proofs.length>0,'invalid_legacy_projection');
      requirePortable(proofs.some(proof=>jsonEqual(actualTags,orderedTags(legacy.tags(proof.sourceDigest,row.kind,row.id)))),'invalid_legacy_tags');
      continue;
    }
    const day=data[row.kind==='reminder'?'startDate':'date']??null;
    if(day!==null){requirePortable(typeof day==='string','invalid_mirror_projection');calendarDate(day);}
    const expected=[day,...['incomeAccount','outcomeAccount','incomeInstrument','outcomeInstrument'].map(field=>data[field]===null||data[field]===undefined?null:scalarText(data[field],'invalid_mirror_projection')),
      ...['income','outcome'].map(field=>mirrorAmountText(data[field])),
      ...['viewed','hold'].map(field=>{const value=row.kind==='transaction'?mirrorFlagText(data[field]):null;return value===null?null:BigInt(value);})];
    requirePortable(jsonEqual(expected,actual),'invalid_mirror_projection');
    const rawTags=data.tag??[];requirePortable(Array.isArray(rawTags)&&rawTags.every(tag=>typeof tag==='string'),'invalid_mirror_tags');
    requirePortable(jsonEqual(actualTags,rawTags.map((tag,i)=>[tag,BigInt(i)])),'invalid_mirror_tags');
  }
  for await(const row of reader.rows('zen_tombstones')){
    const data=financialObject(row.data,'invalid_tombstone');
    if(data.id!==null&&data.id!==undefined)requirePortable(scalarText(data.id,'invalid_tombstone')===row.entity_id,'invalid_tombstone');
    if(data.object!==null&&data.object!==undefined)requirePortable(data.object===row.kind,'invalid_tombstone');
  }
  requirePortable(jsonEqual(owners.sort(compareText),manifest.zenmoney_identity.owner_ids),'declared_owner_mismatch');
}
