/** Private, bounded read view over an immutable inactive format-valid stage. */
import Dexie from 'dexie';
import type {ContextFence,SentinelPort} from '../../control/types.js';
import {runtimeControl,datasetControl} from '../../control/validation.js';
import type {GraphReader} from '../portable/relations.js';
import {SCHEMA} from './schema.generated.js';
import type {TableName,RowByTable} from './schema.generated.js';
import type {Scalar} from './types.js';
import {requireStorage} from './types.js';
import {encodeKey,unpackRow,rowKey} from './cells.js';
import {envelope} from './envelope.js';
import {stageRecord} from './stage-types.js';
import type {FinancialDatabase,FinancialEnvelope} from './database.js';
import type {PortableManifest} from '../portable/format.js';
import {parseJson,validateManifest,TableScanner,rowBytes} from '../portable/format.js';

const same=(left:readonly string[],right:readonly string[])=>left.length===right.length&&left.every((value,i)=>value===right[i]);

export class StageGraphReader implements GraphReader{
  #db:FinancialDatabase;#sentinel:SentinelPort;#fence:ContextFence;#id:string;#writerId:string;#manifest:PortableManifest;
  #manifestText:string;#archiveSha256:string;
  private constructor(db:FinancialDatabase,sentinel:SentinelPort,fence:ContextFence,id:string,writerId:string,manifest:PortableManifest,archiveSha256:string){
    this.#db=db;this.#sentinel=sentinel;this.#fence={...fence};this.#id=id;this.#writerId=writerId;this.#manifest=manifest;
    this.#manifestText=JSON.stringify(manifest)+'\n';this.#archiveSha256=archiveSha256;
  }
  static async open(db:FinancialDatabase,sentinel:SentinelPort,fence:ContextFence,id:string):Promise<StageGraphReader>{
    const stage=stageRecord(await db.stages.get(id));
    requireStorage(stage.state==='format_valid'&&stage.archiveSha256!==null,'dataset_not_writable');
    const manifest=validateManifest(parseJson(new TextEncoder().encode(stage.manifest)));
    const view=new StageGraphReader(db,sentinel,fence,id,stage.writerId,manifest,stage.archiveSha256);
    await view.#marker();await db.transaction('r',db.runtime,db.datasets,db.stages,()=>view.#routing());
    return view;
  }
  get manifest():PortableManifest{return structuredClone(this.#manifest);}
  async #marker():Promise<void>{
    const marker=await this.#sentinel.read();
    requireStorage(marker!==null&&marker.state==='ready'&&marker.installationId===this.#fence.installationId&&marker.financialMayHaveStarted,'recovery_required');
    requireStorage(marker.generation===this.#fence.generation,'stale_epoch');
  }
  async #routing():Promise<void>{
    const runtime=runtimeControl(await this.#db.runtime.get('runtime'));
    requireStorage(runtime.installationId===this.#fence.installationId&&runtime.activeMode==='local'&&runtime.activeGeneration===this.#fence.generation&&
      runtime.epoch===this.#fence.epoch&&runtime.pendingSwitchId===null,'stale_epoch');
    const active=datasetControl(await this.#db.datasets.get(this.#fence.generation));
    requireStorage(active.lifecycle==='active'&&active.holdId===null,'dataset_not_writable');
    const stage=stageRecord(await this.#db.stages.get(this.#id)),dataset=datasetControl(await this.#db.datasets.get(this.#id));
    requireStorage(this.#id!==runtime.activeGeneration&&stage.writerId===this.#writerId&&stage.installationId===runtime.installationId&&
      stage.routingEpoch===runtime.epoch&&stage.state==='format_valid'&&dataset.lifecycle==='staging'&&dataset.holdId===null&&
      dataset.datasetId===this.#manifest.dataset_id&&same(dataset.ownerIds,this.#manifest.zenmoney_identity.owner_ids)&&
      stage.manifest===this.#manifestText&&stage.archiveSha256===this.#archiveSha256,'dataset_not_writable');
    requireStorage(BigInt(stage.rowCount)===this.#manifest.tables.reduce((sum,item)=>sum+BigInt(item.rows),0n)&&
      BigInt(stage.byteCount)===this.#manifest.tables.reduce((sum,item)=>sum+BigInt(item.bytes),0n),'storage_corrupt');
  }
  #row<K extends TableName>(table:K,value:FinancialEnvelope):RowByTable[K]{
    requireStorage(value.generation===this.#id&&rowKey(table,value.row)===value.key,'storage_corrupt');
    const expected=envelope(this.#id,table,value.row);
    requireStorage(Object.keys(expected).length===Object.keys(value).length&&
      Object.keys(expected).every(key=>key==='row'||value[key]===expected[key]),'storage_corrupt');
    return unpackRow(table,value.row);
  }
  async *rows<K extends TableName>(table:K):AsyncIterable<RowByTable[K]>{
    const expected=this.#manifest.tables.find(item=>item.name===table);requireStorage(expected!==undefined,'schema_unsupported');
    const scanner=new TableScanner(table,async()=>{});let after:string|null=null;
    while(true){
      await this.#marker();
      const values=await this.#db.transaction('r',this.#db.runtime,this.#db.datasets,this.#db.stages,this.#db.financial(table),async()=>{
        await this.#routing();
        return this.#db.financial(table).where('[generation+key]').between([this.#id,after??Dexie.minKey],[this.#id,Dexie.maxKey],after===null,true).limit(500).toArray();
      });
      if(!values.length)break;
      for(const value of values){const row=this.#row(table,value);await scanner.push(rowBytes(table,value.row).bytes);yield row;}
      after=values[values.length-1].key;
    }
    scanner.finish(expected);
  }
  async find<K extends TableName>(table:K,columns:readonly string[],values:readonly Scalar[]):Promise<RowByTable[K]|null>{
    requireStorage(columns.length===values.length&&values.every(value=>value[0]!=='null'),'schema_unsupported');
    const definition=SCHEMA[table],primary=same(columns,definition.primary),index=definition.indexes.find(index=>index.unique&&!index.partial&&same(columns,index.columns));
    requireStorage(primary||index!==undefined,'schema_unsupported');
    await this.#marker();
    return this.#db.transaction('r',this.#db.runtime,this.#db.datasets,this.#db.stages,this.#db.financial(table),async()=>{
      await this.#routing();const key=encodeKey(values);
      const value=primary?await this.#db.financial(table).get([this.#id,key]):
        await this.#db.financial(table).where('[generation+'+index!.key+']').equals([this.#id,key]).first();
      return value===undefined?null:this.#row(table,value);
    });
  }
}
