/** Storage-private Dexie owner. Application handlers never receive table handles. */
import Dexie from 'dexie';
import type {Table} from 'dexie';
import type {DatasetControl,RuntimeControl} from '../../control/types.js';
import {SCHEMA} from './schema.generated.js';
import type {TableName} from './schema.generated.js';
import type {TaggedRow} from './types.js';
import {envelope} from './envelope.js';
import {requireStorage} from './types.js';
import {runtimeControl,datasetControl} from '../../control/validation.js';
import type {StageRecord} from './stage-types.js';
import {upgradeStageV3} from './stage-types.js';

export interface FinancialEnvelope{
  readonly generation:string;
  readonly key:string;
  readonly row:TaggedRow;
  readonly [index:string]:unknown;
}

export function financialStoreName(table:TableName):string{return 'f_'+table;}

export function storeDefinitions(foreignIndexes=false):Record<string,string>{
  const values:Record<string,string>={runtime:'id',datasets:'generation,datasetId,lifecycle'};
  for(const [name,table]of Object.entries(SCHEMA)){
    const indexes=table.indexes.map(index=>(index.unique?'&':'')+'[generation+'+index.key+']');
    if(foreignIndexes)table.foreignKeys.forEach((_,i)=>indexes.push('[generation+fk'+i+']'));
    values[financialStoreName(name as TableName)]=['[generation+key]','generation',...indexes].join(',');
  }
  return values;
}

export class FinancialDatabase extends Dexie{
  readonly runtime:Table<RuntimeControl,string>;
  readonly datasets:Table<DatasetControl,string>;
  readonly stages:Table<StageRecord,string>;
  constructor(name:string,allowCreate:boolean){
    super(name,{autoOpen:false,chromeTransactionDurability:'strict',cache:'disabled'});
    this.version(1).stores(storeDefinitions());
    this.version(2).stores(storeDefinitions(true)).upgrade(async transaction=>{
      const runtime=runtimeControl(await transaction.table('runtime').get('runtime'));
      const generations=new Set<string>();
      await transaction.table('datasets').each(value=>{generations.add(datasetControl(value).generation);});
      requireStorage(runtime.installationId.length===36,'storage_corrupt');
      for(const name of Object.keys(SCHEMA) as TableName[]){
        await transaction.table(financialStoreName(name)).toCollection().modify((value:FinancialEnvelope)=>{
          requireStorage(generations.has(value.generation),'storage_corrupt');
          const updated=envelope(value.generation,name,value.row);
          requireStorage(updated.key===value.key,'storage_corrupt');
          for(const key of Object.keys(value))delete (value as Record<string,unknown>)[key];
          for(const [key,item]of Object.entries(updated))(value as Record<string,unknown>)[key]=item;
        });
      }
    });
    this.version(3).stores({...storeDefinitions(true),portable_stages:'id,state,createdAt'});
    this.version(4).stores({...storeDefinitions(true),portable_stages:'id,state,createdAt'}).upgrade(transaction=>
      transaction.table('portable_stages').toCollection().modify(value=>{Object.assign(value,upgradeStageV3(value));}));
    this.runtime=this.table('runtime');this.datasets=this.table('datasets');
    this.stages=this.table('portable_stages');
    this.on('versionchange',()=>{this.close();return false;});
    this.on('populate',()=>{if(!allowCreate)throw Error('storage_missing');});
  }
  financial(table:TableName):Table<FinancialEnvelope,[string,string]>{return this.table(financialStoreName(table));}
}
