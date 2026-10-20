/** Offline resource regression: invalid identifiers need no character array. */
import {metadataValue} from '../.local/contracts/portable-format.mjs';
const raw=JSON.stringify(['x'.repeat(16*1024*1024)]);
try{
  metadataValue('legacy:category_fresh_ids',raw,'00000000-0000-4000-8000-000000000001');
  throw Error('oversized_identifier_accepted');
}catch(error){
  if(error.code!=='invalid_metadata')throw error;
  console.log('PASS: invalid identifier rejected under the bounded heap');
}
