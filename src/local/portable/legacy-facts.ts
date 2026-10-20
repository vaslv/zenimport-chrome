/** Derived historical proof indexes. Built only after classified audit validation. */
import type {GraphReader} from './relations.js';
import {financialJson} from './inspect.js';
import {legacyCell} from './audit.js';
import {requirePortable} from './format.js';
import {VALIDATION} from './validation.generated.js';
import {jsonEqual,scalarText,tupleText} from './json-values.js';

export type LegacyValue=string|bigint|null;
export interface LegacyMovement{
  readonly sourceDigest:string;
  readonly projection:readonly LegacyValue[];
}
export interface LegacyTag{readonly tag:LegacyValue;readonly position:LegacyValue}
const tables=new Map<string,readonly string[]>(VALIDATION.legacy_objects.filter(value=>value.type==='table').map(value=>[value.name,value.columns!]));
const kinds:Record<string,string>={zen_transaction:'transaction',zen_reminder:'reminder',zen_reminder_marker:'reminderMarker'};

export class LegacyFacts{
  #banks=new Map<string,Record<string,LegacyValue>[]>();
  #movements=new Map<string,LegacyMovement[]>();
  #tags=new Map<string,LegacyTag[]>();
  private constructor(){}
  static async read(reader:GraphReader):Promise<LegacyFacts>{
    const facts=new LegacyFacts(),tagKeys=new Set<string>();
    for await(const row of reader.rows('legacy_rows')){
      const source=row.table_name.replace(/_tags$/,''),kind=Object.hasOwn(kinds,source)?kinds[source]:undefined;
      if(row.table_name!=='bank_transactions'&&!kind)continue;
      const names=tables.get(row.table_name);
      requirePortable(names!==undefined,'unclassified_legacy_object');
      const values=financialJson(row.values_json);requirePortable(Array.isArray(values)&&values.length===names.length,'invalid_legacy_row');
      const cells:readonly unknown[]=values;
      function field(name:string):LegacyValue{
        const index=names!.indexOf(name);requirePortable(index>=0,'unclassified_legacy_column');return legacyCell(cells[index]);
      }
      if(row.table_name==='bank_transactions'){
        const original=Object.fromEntries(names.map((name,i)=>[name,legacyCell(values[i])]));
        const key=scalarText(original.id,'invalid_legacy_proof'),list=facts.#banks.get(key)??[];list.push(original);facts.#banks.set(key,list);
      }else if(row.table_name.endsWith('_tags')){
        const id=scalarText(field(kind==='transaction'?'transaction_id':'owner_id'),'invalid_legacy_row'),tag=field('tag_id'),position=field('position');
        const key=tupleText(row.source_digest,kind,id),unique=tupleText(key,scalarText(tag,'invalid_legacy_row'));
        requirePortable(!tagKeys.has(unique),'invalid_legacy_audit');tagKeys.add(unique);
        const list=facts.#tags.get(key)??[];list.push({tag,position});facts.#tags.set(key,list);
      }else{
        const id=scalarText(field('id'),'invalid_legacy_row'),data=field('data');requirePortable(typeof data==='string','invalid_legacy_row');
        const projection=[field(kind==='reminder'?'start_date':'date'),...['income_account','outcome_account','income_instrument','outcome_instrument','income','outcome'].map(field),
          ...['viewed','hold'].map(name=>kind==='transaction'?field(name):null)];
        const key=tupleText(kind,id,data),list=facts.#movements.get(key)??[];
        if(!list.some(proof=>proof.sourceDigest===row.source_digest&&jsonEqual(proof.projection,projection)))list.push({sourceDigest:row.source_digest,projection});
        facts.#movements.set(key,list);
      }
    }
    return facts;
  }
  bankOriginals(id:string):readonly Readonly<Record<string,LegacyValue>>[]{return this.#banks.get(id)??[];}
  movements(kind:string,id:string,data:string):readonly LegacyMovement[]{return this.#movements.get(tupleText(kind,id,data))??[];}
  tags(digest:string,kind:string,id:string):readonly LegacyTag[]{return this.#tags.get(tupleText(digest,kind,id))??[];}
}
