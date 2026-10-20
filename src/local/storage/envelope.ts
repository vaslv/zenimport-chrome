import {SCHEMA} from './schema.generated.js';
import type {TableName} from './schema.generated.js';
import {validateChecks} from './checks.js';
import {encodeKey,rowKey} from './cells.js';
import {requireStorage} from './types.js';
import type {Scalar,TaggedRow} from './types.js';
import type {FinancialEnvelope} from './database.js';

export function valuesKey(table:TableName,row:TaggedRow,columns:readonly string[],nullable=false):string|undefined{
  const definition=SCHEMA[table];
  const values=columns.map(name=>{
    const index=definition.columns.findIndex(column=>column.name===name);
    requireStorage(index>=0,'schema_unsupported');return row[index];
  });
  if(nullable && values.some(value=>value[0]==='null'))return undefined;
  return encodeKey(values);
}

export function envelope(generation:string,table:TableName,input:unknown):FinancialEnvelope{
  const row=validateChecks(table,input);
  const definition=SCHEMA[table];
  const value:Record<string,unknown>={generation,key:rowKey(table,row),row};
  for(const index of definition.indexes){
    if(index.partial){
      const column=definition.columns.findIndex(column=>column.name===index.partial!.column);
      const field=row[column];
      if(field[0]!=='text' || !(index.partial.values as readonly string[]).includes(field[1]))continue;
    }
    const key=valuesKey(table,row,index.columns,true);
    if(key!==undefined)value[index.key]=key;
  }
  definition.foreignKeys.forEach((foreign,i)=>{
    const key=valuesKey(table,row,foreign.columns,true);
    if(key!==undefined)value['fk'+i]=key;
  });
  return value as unknown as FinancialEnvelope;
}

export function field(table:TableName,row:TaggedRow,name:string):Scalar{
  const index=SCHEMA[table].columns.findIndex(column=>column.name===name);
  requireStorage(index>=0,'schema_unsupported');return row[index];
}

export function textField(table:TableName,row:TaggedRow,name:string):string|null{
  const cell=field(table,row,name);return cell[0]==='null'?null:cell[1];
}
