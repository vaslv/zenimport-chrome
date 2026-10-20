/** Storage-private Dexie owner. Application handlers never receive table handles. */
import Dexie from 'dexie';
import type {Table} from 'dexie';
import type {DatasetControl,RuntimeControl} from '../../control/types.js';
import {SCHEMA} from './schema.generated.js';
import type {TableName} from './schema.generated.js';
import type {TaggedRow} from './types.js';

export interface FinancialEnvelope{
  readonly generation:string;
  readonly key:string;
  readonly row:TaggedRow;
  readonly [index:string]:unknown;
}

export function financialStoreName(table:TableName):string{return 'f_'+table;}

function stores():Record<string,string>{
  const values:Record<string,string>={runtime:'id',datasets:'generation,datasetId,lifecycle'};
  for(const [name,table]of Object.entries(SCHEMA)){
    const indexes=table.indexes.map(index=>(index.unique?'&':'')+'[generation+'+index.key+']');
    values[financialStoreName(name as TableName)]=['[generation+key]','generation',...indexes].join(',');
  }
  return values;
}

export class FinancialDatabase extends Dexie{
  readonly runtime:Table<RuntimeControl,string>;
  readonly datasets:Table<DatasetControl,string>;
  constructor(name:string,allowCreate:boolean){
    super(name,{autoOpen:false,chromeTransactionDurability:'strict',cache:'disabled'});
    this.version(1).stores(stores());
    this.runtime=this.table('runtime');this.datasets=this.table('datasets');
    this.on('versionchange',()=>{this.close();return false;});
    this.on('populate',()=>{if(!allowCreate)throw Error('storage_missing');});
  }
  financial(table:TableName):Table<FinancialEnvelope,[string,string]>{return this.table(financialStoreName(table));}
}
