/** Complete archived facts proof. Fresh identity and protected handoff are separate. */
import type {GraphReader} from './relations.js';
import {validateRelations} from './relations.js';
import {validateAudit} from './audit.js';
import {LegacyFacts} from './legacy-facts.js';
import {validateRecords} from './record-proof.js';
import {validateCapture} from './capture-proof.js';
import {validateHistory} from './history.js';
import {validateMirror} from './mirror-proof.js';
import {jsonEqual} from './json-values.js';
import {validateManifest,requirePortable,PortableError} from './format.js';
import type {PortableManifest} from './format.js';
import type {TableName} from '../storage/schema.generated.js';
import {StorageError} from '../storage/types.js';

export interface GraphSummary{
  readonly datasetId:string;
  readonly datasetDigest:string;
  readonly declaredOwners:readonly string[];
  readonly counts:Readonly<Record<TableName,string>>;
}

export async function validateFinancialGraph(reader:GraphReader,input:PortableManifest,expectedOwners?:readonly string[]):Promise<GraphSummary>{
  const manifest=validateManifest(input);
  try{
    const counts=await validateRelations(reader,manifest);await validateAudit(reader,manifest);
    const legacy=await LegacyFacts.read(reader),records=await validateRecords(reader,legacy);
    await validateCapture(reader,records);await validateHistory(reader);await validateMirror(reader,manifest,legacy);
    if(expectedOwners!==undefined)requirePortable(jsonEqual(manifest.zenmoney_identity.owner_ids,expectedOwners),'destination_owner_mismatch');
    return {datasetId:manifest.dataset_id,datasetDigest:manifest.dataset_digest,declaredOwners:[...manifest.zenmoney_identity.owner_ids],counts};
  }catch(error){
    if(error instanceof PortableError||error instanceof StorageError)throw error;
    throw new PortableError('invalid_financial_graph');
  }
}
