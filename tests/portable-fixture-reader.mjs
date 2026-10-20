/** Read-only in-memory fixture adapter, independent of native IndexedDB indexes. */
import {readFileSync} from 'node:fs';
import {rowKey,unpackRow} from '../.local/contracts/storage-cells.mjs';
export const current=JSON.parse(readFileSync('contracts/business/v1/portable-financial-v2.json','utf8'));
export const legacy=JSON.parse(readFileSync('contracts/business/v1/portable-legacy-v2.json','utf8'));
const schema=JSON.parse(readFileSync('contracts/business/v1/sqlite-v7.json','utf8'));
const policy=JSON.parse(readFileSync('contracts/business/v1/portable-policy.json','utf8'));
export const definitions=Object.fromEntries(Object.entries(policy.logical_tables).map(([name,value])=>[name,schema.tables[value.source]]));
export const offset=(name,column)=>definitions[name].columns.findIndex(value=>value.name===column);
export function reader(rows){
  return {
    async *rows(table,prefix=[]){
      const keys=definitions[table].columns.filter(column=>column.pk).sort((a,b)=>a.pk-b.pk).map(column=>column.name);
      const ordered=[...rows[table]].filter(row=>prefix.every((value,i)=>JSON.stringify(row[offset(table,keys[i])])===JSON.stringify(value)));
      ordered.sort((a,b)=>rowKey(table,a)<rowKey(table,b)?-1:1);
      for(const row of ordered)yield unpackRow(table,row);
    },
    async find(table,columns,values){
      const row=rows[table].find(row=>columns.every((column,i)=>JSON.stringify(row[offset(table,column)])===JSON.stringify(values[i])));
      return row===undefined?null:unpackRow(table,row);
    },
  };
}
