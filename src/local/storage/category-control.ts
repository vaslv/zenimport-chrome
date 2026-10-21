/** Rebuildable cache publication metadata is local, never portable authority. */
import type {FinancialSnapshot} from './source-stamp.js';
import type {FinancialDatabase} from './database.js';
import {requireStorage} from './types.js';
export const CATEGORY_TABLES=['category_evidence','category_payments','category_predictions'] as const;
export type CategoryCounts=Record<typeof CATEGORY_TABLES[number],number>;
export interface CategoryControl{id:string;state:'building'|'ready';source:FinancialSnapshot;counts:CategoryCounts}
export const categoryScope=(generation:string)=>'category-cache:'+generation;
export function categoryControl(value:unknown):CategoryControl{
  requireStorage(value!==null&&typeof value==='object'&&!Array.isArray(value),'storage_corrupt');const row=value as CategoryControl;
  requireStorage(Object.keys(row).sort().join(',')==='counts,id,source,state'&&typeof row.id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.id)&&['building','ready'].includes(row.state)&&
    row.source!==null&&typeof row.source==='object'&&!Array.isArray(row.source)&&row.counts!==null&&typeof row.counts==='object'&&!Array.isArray(row.counts)&&
    Object.keys(row.counts).sort().join(',')===[...CATEGORY_TABLES].sort().join(',')&&CATEGORY_TABLES.every(key=>Number.isSafeInteger(row.counts[key])&&row.counts[key]>=0&&row.counts[key]<=1000000),'storage_corrupt');
  return row;
}
export async function categoriesReady(db:FinancialDatabase,stamp:FinancialSnapshot){
  const value=(await db.applicationState.get(categoryScope(stamp.generation)))?.value;if(value===undefined)return false;
  const control=categoryControl(value);return control.state==='ready'&&JSON.stringify(control.source)===JSON.stringify(stamp);
}
