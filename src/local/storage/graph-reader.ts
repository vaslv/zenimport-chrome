/** Private, bounded read view over an immutable inactive format-valid stage. */
import Dexie from 'dexie';
import type {ContextFence,SentinelPort,DatasetSentinel} from '../../control/types.js';
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
import {readAnchor} from './anchor.js';
import {assertImportScope,scopeTables} from './import-scope.js';
import type {ImportPermit} from './import-scope.js';

const same=(left:readonly string[],right:readonly string[])=>left.length===right.length&&left.every((value,i)=>value===right[i]);

export class StageGraphReader implements GraphReader{
  #db:FinancialDatabase;#sentinel:SentinelPort;#fence:ContextFence;#id:string;#writerId:string;#manifest:PortableManifest;
  #manifestText:string;#archiveSha256:string;
  #anchor!:DatasetSentinel;#permit:ImportPermit|undefined;
  private constructor(db:FinancialDatabase,sentinel:SentinelPort,fence:ContextFence,id:string,writerId:string,manifest:PortableManifest,archiveSha256:string,permit?:ImportPermit){
    this.#db=db;this.#sentinel=sentinel;this.#fence={...fence};this.#id=id;this.#writerId=writerId;this.#manifest=manifest;
    this.#manifestText=JSON.stringify(manifest)+'\n';this.#archiveSha256=archiveSha256;
    this.#permit=permit?{...permit}:undefined;
  }
  static async open(db:FinancialDatabase,sentinel:SentinelPort,fence:ContextFence,id:string,permit?:ImportPermit):Promise<StageGraphReader>{
    const stage=stageRecord(await db.stages.get(id));
    requireStorage(['format_valid','graph_valid'].includes(stage.state)&&stage.archiveSha256!==null,'dataset_not_writable');
    const manifest=validateManifest(parseJson(new TextEncoder().encode(stage.manifest)));
    const view=new StageGraphReader(db,sentinel,fence,id,stage.writerId,manifest,stage.archiveSha256,permit);
    // Declare a native async scope so Dexie tracks the complete nested guard.
    await view.#marker();await db.transaction('r',[...scopeTables(db),db.stages],async()=>{await view.#routing();});
    return view;
  }
  get manifest():PortableManifest{return structuredClone(this.#manifest);}
  async #marker():Promise<void>{
    this.#anchor=await readAnchor(this.#sentinel,this.#fence.installationId,true);
  }
  async #routing():Promise<void>{
    const runtime=await assertImportScope(this.#db,this.#fence,this.#anchor,this.#permit);
    const stage=stageRecord(await this.#db.stages.get(this.#id)),dataset=datasetControl(await this.#db.datasets.get(this.#id));
    requireStorage(this.#id!==runtime.activeGeneration&&stage.writerId===this.#writerId&&stage.installationId===runtime.installationId&&
      stage.routingEpoch===runtime.epoch&&((stage.state==='format_valid'&&dataset.lifecycle==='staging')||
        (stage.state==='graph_valid'&&(dataset.lifecycle==='validated'||!!this.#permit&&dataset.lifecycle==='armed')&&stage.graphDigest===this.#manifest.dataset_digest))&&dataset.holdId===(this.#permit?.switchId??null)&&
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
  async *rows<K extends TableName>(table:K,primaryPrefix:readonly Scalar[]=[]):AsyncIterable<RowByTable[K]>{
    const expected=this.#manifest.tables.find(item=>item.name===table);requireStorage(expected!==undefined,'schema_unsupported');
    requireStorage(primaryPrefix.length<=SCHEMA[table].primary.length&&primaryPrefix.every(value=>value[0]!=='null'),'schema_unsupported');
    const prefix=primaryPrefix.length?encodeKey(primaryPrefix):null,whole=primaryPrefix.length===SCHEMA[table].primary.length;
    const lower=prefix===null?Dexie.minKey:prefix+(whole?'':'/'),upper=prefix===null?Dexie.maxKey:prefix+(whole?'':'/\uffff');
    const scanner=prefix===null?new TableScanner(table,async()=>{}):null;let after:string|null=null;
    while(true){
      await this.#marker();
      const values=await this.#db.transaction('r',[...scopeTables(this.#db),this.#db.stages,this.#db.financial(table)],async()=>{
        await this.#routing();
        return this.#db.financial(table).where('[generation+key]').between([this.#id,after??lower],[this.#id,upper],after===null,true).limit(500).toArray();
      });
      if(!values.length)break;
      for(const value of values){const row=this.#row(table,value);if(scanner)await scanner.push(rowBytes(table,value.row).bytes);yield row;}
      after=values[values.length-1].key;
    }
    scanner?.finish(expected);
  }
  async find<K extends TableName>(table:K,columns:readonly string[],values:readonly Scalar[]):Promise<RowByTable[K]|null>{
    requireStorage(columns.length===values.length&&values.every(value=>value[0]!=='null'),'schema_unsupported');
    const definition=SCHEMA[table],primary=same(columns,definition.primary),index=definition.indexes.find(index=>index.unique&&!index.partial&&same(columns,index.columns));
    requireStorage(primary||index!==undefined,'schema_unsupported');
    await this.#marker();
    return this.#db.transaction('r',[...scopeTables(this.#db),this.#db.stages,this.#db.financial(table)],async()=>{
      await this.#routing();const key=encodeKey(values);
      const value=primary?await this.#db.financial(table).get([this.#id,key]):
        await this.#db.financial(table).where('[generation+'+index!.key+']').equals([this.#id,key]).first();
      return value===undefined?null:this.#row(table,value);
    });
  }
}
