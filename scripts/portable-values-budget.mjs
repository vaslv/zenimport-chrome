/** Offline resource regression: invalid identifiers need no character array. */
import {metadataValue,financialJson} from '../.local/contracts/portable-format.mjs';
if(process.argv[2]==='fanout'){
  try{financialJson('['+'0,'.repeat(5000000)+'0]');throw Error('oversized_fanout_accepted');}
  catch(error){if(error.code!=='json_budget_exceeded')throw error;}
  console.log('PASS: excessive fanout rejected before parsed allocation');
  process.exit(0);
}
const raw=JSON.stringify(['x'.repeat(16*1024*1024)]);
try{
  metadataValue('legacy:category_fresh_ids',raw,'00000000-0000-4000-8000-000000000001');
  throw Error('oversized_identifier_accepted');
}catch(error){
  if(error.code!=='invalid_metadata')throw error;
  console.log('PASS: invalid identifier rejected under the bounded heap');
}
