/** Exact local catalog DTOs; instrument IDs never pass through Number. */
import {decodeJson} from 'zenmoney-typescript';
import type {JsonObject} from 'zenmoney-typescript';
import type {LocalCredentials} from './credentials.js';
import type {LocalMirror} from './mirror.js';
import type {MirrorRepository} from '../storage/mirror-repository.js';
import {LocalZenMoneyError} from './errors.js';
import {jsonTruthy} from '../portable/json-values.js';
export interface LocalAccountCatalog{refreshed_at:string;accounts:{id:string;title:string;currency:string;instrument:string}[]}
export class LocalCatalog{
  constructor(private store:MirrorRepository,private credentials:LocalCredentials,private mirror:LocalMirror,private clock:()=>number){}
  async get():Promise<LocalAccountCatalog>{
    await this.mirror.refresh();const credential=await this.credentials.current(),status=await this.store.status(credential.hash,String(Math.floor(this.clock())));
    if(!status.ready)throw new LocalZenMoneyError('zenmoney_unavailable');
    const rows=await this.store.catalog(credential.root),instruments=new Map(rows.filter(row=>row.kind==='instrument').map(row=>[row.id,decodeJson(row.data) as JsonObject]));
    const accounts=[];
    for(const row of rows.filter(row=>row.kind==='account').sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
      const value=decodeJson(row.data) as JsonObject,instrument=value.instrument;
      if(!(typeof instrument==='bigint'||typeof instrument==='number'&&Number.isSafeInteger(instrument))||instrument<=0)continue;
      const currency=instruments.get(String(instrument));
      if(jsonTruthy(value.deleted)||jsonTruthy(value.archive)||!['cash','ccard','checking','deposit','emoney'].includes(value.type as string)||!currency||jsonTruthy(currency.deleted)||
        typeof currency.shortTitle!=='string'||!currency.shortTitle)continue;
      accounts.push({id:row.id,title:typeof value.title==='string'?value.title:'',currency:currency.shortTitle,instrument:String(instrument)});
    }
    return {refreshed_at:new Date(Number(status.state.refreshed_at)*1000).toISOString(),accounts};
  }
}
