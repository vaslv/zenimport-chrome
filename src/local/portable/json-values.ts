import {ExactDecimal} from 'zenmoney-typescript';
import type {JsonObject} from 'zenmoney-typescript';
import {pythonDecimalText} from '../../domain/python-decimal.js';
import {financialJson} from './inspect.js';
import {requirePortable} from './format.js';

export function financialObject(raw:string,code:string):JsonObject{
  const value=financialJson(raw);
  requirePortable(value!==null&&typeof value==='object'&&!Array.isArray(value)&&!(value instanceof ExactDecimal),code);
  return value as JsonObject;
}

/** Reference text for scalar JSON identifiers; structured API IDs fail closed. */
export function scalarText(value:unknown,code:string):string{
  if(value===null||value===undefined)return 'None';
  if(typeof value==='boolean')return value?'True':'False';
  if(value instanceof ExactDecimal)return pythonDecimalText(value);
  requirePortable(typeof value==='string'||typeof value==='bigint'||typeof value==='number'&&Number.isSafeInteger(value),code);
  return String(value);
}

export const tupleText=(...values:string[])=>values.map(value=>value.length+':'+value).join('');

/** Python JSON-value equality for archived facts, independent of dict key order. */
export function jsonEqual(left:unknown,right:unknown,depth=0):boolean{
  if(depth>128)return false;
  if(left===right)return true;
  const numeric=(value:unknown):ExactDecimal|null=>value instanceof ExactDecimal?value:
    typeof value==='bigint'||typeof value==='number'&&Number.isSafeInteger(value)?new ExactDecimal(String(value)):
      typeof value==='boolean'?new ExactDecimal(value?'1':'0'):null;
  const a=numeric(left),b=numeric(right);
  if(a||b)return a!==null&&b!==null&&a.equals(b);
  if(Array.isArray(left)||Array.isArray(right))return Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((value,i)=>jsonEqual(value,right[i],depth+1));
  if(left===null||right===null||typeof left!=='object'||typeof right!=='object')return false;
  const x=left as Record<string,unknown>,y=right as Record<string,unknown>,keys=Object.keys(x);
  return keys.length===Object.keys(y).length&&keys.every(key=>Object.hasOwn(y,key)&&jsonEqual(x[key],y[key],depth+1));
}
