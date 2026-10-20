import {SCHEMA} from './schema.generated.js';
import type {TableName,RowByTable} from './schema.generated.js';
import {int64,requireStorage} from './types.js';
import type {Scalar,TaggedRow} from './types.js';

function validText(value:unknown):asserts value is string{
  requireStorage(typeof value==='string');
  for(let i=0;i<value.length;i++){
    const code=value.charCodeAt(i);
    if(code>=0xd800 && code<=0xdbff){
      requireStorage(i+1<value.length && value.charCodeAt(i+1)>=0xdc00 && value.charCodeAt(i+1)<=0xdfff);i++;
    }else requireStorage(code<0xdc00 || code>0xdfff);
  }
}

/** Validate shape/types; financial and relational invariants are a separate gate. */
export function validateCells(table:TableName,value:unknown):TaggedRow{
  requireStorage(Object.hasOwn(SCHEMA,table));
  const columns=SCHEMA[table].columns;
  requireStorage(Array.isArray(value) && value.length===columns.length && Object.keys(value).length===value.length);
  return columns.map((column,index):Scalar=>{
    const cell=value[index];
    requireStorage(Array.isArray(cell) && Object.keys(cell).length===cell.length);
    if(cell[0]==='null'){
      requireStorage(cell.length===1 && !column.required);return ['null'];
    }
    requireStorage(cell.length===2);
    if(column.type==='INTEGER'){
      requireStorage(cell[0]==='integer');return ['integer',int64(cell[1])];
    }
    requireStorage(cell[0]==='text');validText(cell[1]);return ['text',cell[1]];
  });
}

export function packRow<K extends TableName>(table:K,fields:RowByTable[K]):TaggedRow{
  requireStorage(typeof fields==='object' && fields!==null && !Array.isArray(fields));
  const columns=SCHEMA[table].columns;
  requireStorage(Object.keys(fields).length===columns.length && columns.every(column=>Object.hasOwn(fields,column.name)));
  const values=fields as Record<string,unknown>;
  return validateCells(table,columns.map(column=>{
    const value=values[column.name];
    return value===null?['null']:[column.type==='INTEGER'?'integer':'text',value];
  }));
}

export function unpackRow<K extends TableName>(table:K,input:unknown):RowByTable[K]{
  const row=validateCells(table,input);
  return Object.fromEntries(SCHEMA[table].columns.map((column,i)=>[column.name,row[i][0]==='null'?null:row[i][1]])) as RowByTable[K];
}

function component(cell:Scalar):string{
  requireStorage(cell[0]!=='null','invalid_key');
  if(cell[0]==='integer')return (BigInt(cell[1])+(1n<<63n)).toString(16).padStart(16,'0');
  validText(cell[1]);
  return Array.from(new TextEncoder().encode(cell[1]),byte=>byte.toString(16).padStart(2,'0')).join('');
}

/** ASCII keys preserve SQLite UTF-8 text/signed-integer tuple ordering in IDB. */
export function encodeKey(cells:readonly Scalar[]):string{
  requireStorage(cells.length>0,'invalid_key');return cells.map(component).join('/');
}

export function rowKey(table:TableName,input:unknown):string{
  const row=validateCells(table,input),definition=SCHEMA[table];
  return encodeKey(definition.primary.map(name=>row[definition.columns.findIndex(column=>column.name===name)]));
}
