/** Credential screening and classified audit values, with no owner adoption. */
import {ExactDecimal} from 'zenmoney-typescript';
import {archiveJson} from './json.js';
import type {JsonValue} from 'zenmoney-typescript';
import {int64} from '../storage/types.js';
import {PortableError,requirePortable,object,uuidValue} from './format.js';
import {VALIDATION,PYTHON_WORD_RANGES} from './validation.generated.js';

const SECRET_KEYS=new Set('password passwd token accesstoken refreshtoken apitoken clientsecret authorization auth cookie cookies sessioncookie zenmoneytoken backendtoken servertoken'.split(' '));
const SPACE='[\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const NESTED_JSON_PREFIX=new RegExp('^'+SPACE.replace(']','\\ufeff]')+'+','u');
const wordClass='['+PYTHON_WORD_RANGES.map(([start,end])=>'\\u{'+start.toString(16)+'}'+(start===end?'':'-\\u{'+end.toString(16)+'}')).join('')+']';
function insensitive(word:string):string{
  return [...word].map(letter=>letter==='i'?'[iI\u0130\u0131]':letter==='k'?'[kK\u212a]':letter==='s'?'[sS\u017f]':
    /[a-z]/.test(letter)?'['+letter+letter.toUpperCase()+']':letter).join('');
}
// Explicit Python re.I folds keep the frozen Unicode-15 word boundary outside
// case-insensitive matching. Otherwise newer case partners could join that set.
// A real lookbehind also avoids skipping overlapping matches after a false start.
const assignments=['access_token','password','authorization','cookie'].map(insensitive);
assignments.push(insensitive('api')+'[_-]?'+insensitive('token'));
const SECRET_TEXT=new RegExp('(?<!'+wordClass+')(?:'+insensitive('bearer')+SPACE+'+[A-Za-z0-9._~+/\u0130\u0131\u017f\u212a-]{12,}|(?:'+
  assignments.join('|')+')'+SPACE+'*[:=]'+SPACE+'*'+SPACE.replace('[','[^')+'+)','gu');

export function credentialText(text:string):boolean{
  SECRET_TEXT.lastIndex=0;return SECRET_TEXT.test(text);
}

export function financialJson(raw:string):JsonValue{
  let value:JsonValue;
  try{value=archiveJson(raw) as JsonValue;}catch{throw new PortableError('invalid_financial_json');}
  const stack:{value:JsonValue;depth:number}[]=[{value,depth:0}];let visited=0;
  while(stack.length){
    const item=stack.pop()!;requirePortable(++visited<=5000000&&item.depth<=128,'json_budget_exceeded');
    if(Array.isArray(item.value)){
      requirePortable(visited+stack.length+item.value.length<=5000000,'json_budget_exceeded');
      for(const child of item.value)stack.push({value:child,depth:item.depth+1});
    }else if(item.value!==null&&typeof item.value==='object'&&!(item.value instanceof ExactDecimal)){
      requirePortable(visited+stack.length+Object.keys(item.value).length<=5000000,'json_budget_exceeded');
      for(const [key,child]of Object.entries(item.value)){
        requirePortable(!SECRET_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g,'')),'credential_material');
        stack.push({value:child!,depth:item.depth+1});
      }
    }else if(typeof item.value==='string'){
      requirePortable(!credentialText(item.value),'credential_material');
      const candidate=item.value.replace(NESTED_JSON_PREFIX,'');
      if(/^[{\[]/.test(candidate)){
        let nested:JsonValue;try{nested=archiveJson(candidate) as JsonValue;}catch{continue;}
        stack.push({value:nested,depth:item.depth+1});
      }
    }
  }
  return value;
}

function counter(value:unknown,code:string):void{
  requirePortable(typeof value==='string'&&value.length<=19&&/^(?:0|[1-9][0-9]*)$/.test(value),code);
  try{requirePortable(BigInt(int64(value))>=0n,code);}catch{throw new PortableError(code);}
}
function ids(value:unknown):boolean{return Array.isArray(value)&&value.every(item=>typeof item==='string'&&item.length>0&&item.length<=480&&[...item].length<=240);}

export function metadataValue(key:string,value:unknown,datasetId:string):void{
  requirePortable(Object.hasOwn(VALIDATION.metadata,key)&&typeof value==='string','unclassified_metadata');
  const kind=VALIDATION.metadata[key as keyof typeof VALIDATION.metadata];
  requirePortable(!credentialText(value),'credential_material');
  switch(kind){
    case 'dataset_uuid':requirePortable(value===datasetId,'lineage_mismatch');return;
    case 'legacy_hold_audit':requirePortable(['exported','imported'].includes(value),'invalid_metadata');return;
    case 'sha256':requirePortable(/^[0-9a-f]{64}$/.test(value),'invalid_metadata');return;
    case 'started_flag':requirePortable(value==='1','invalid_metadata');return;
    case 'counter_audit':counter(value,'invalid_metadata');return;
    case 'boolean_audit':requirePortable(['0','1'].includes(value),'invalid_metadata');return;
    case 'mode_audit':requirePortable(['demo','live'].includes(value),'invalid_metadata');return;
  }
  const data=financialJson(value);
  if(kind==='id_list_audit'){requirePortable(ids(data),'invalid_metadata');return;}
  if(kind==='catalog_ids_audit'){
    requirePortable(data!==null&&typeof data==='object'&&!Array.isArray(data)&&!(data instanceof ExactDecimal)&&
      Object.keys(data).sort().join(',')==='account,instrument,tag'&&Object.values(data).every(ids),'invalid_metadata');return;
  }
  requirePortable(kind==='portable_import_history'&&Array.isArray(data)&&data.length<=10000,'invalid_import_provenance');
  const seen=new Set<string>();
  for(const value of data){
    const entry=object(value,['archive_id','archive_sha256','dataset_digest','export_session_id','accepted_at'],'invalid_import_provenance');
    for(const field of ['archive_id','export_session_id'])requirePortable(uuidValue(entry[field]),'invalid_import_provenance');
    for(const field of ['archive_sha256','dataset_digest'])requirePortable(typeof entry[field]==='string'&&/^[0-9a-f]{64}$/.test(entry[field] as string),'invalid_import_provenance');
    counter(entry.accepted_at,'invalid_import_provenance');
    requirePortable(!seen.has(entry.archive_id as string),'invalid_import_provenance');seen.add(entry.archive_id as string);
  }
}
