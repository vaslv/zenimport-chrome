"""Protocol integrity in a genuine MV3 worker; no authority or network granted."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from test_runtime import installed


def test_native_participant_receipts_and_canonical_bytes_match_python_observations(tmp_path):
    vectors=json.loads(Path('/app/contracts/business/v1/participant-wire-vectors.json').read_text())
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        result=worker.evaluate('''vectors=>{
          for(const item of vectors.receipts){
            let accepted=false;
            try{portableProbe.checkPeerReceipt(item.value,item.command,item.local_id,item.operation??undefined);accepted=true;}
            catch(error){if(error.code!=='migration_invalid')throw error;}
            if(accepted!==item.accepted)throw Error('receipt-reference-mismatch');
          }
          for(const item of vectors.canonical){
            let hex=null;
            try{hex=[...portableProbe.canonicalParticipant(item.value)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
            catch(error){if(error.code!=='migration_invalid')throw error;}
            if(hex!==item.hex)throw Error('canonical-reference-mismatch');
          }
          return {receipts:vectors.receipts.length,canonical:vectors.canonical.length};
        }''',vectors)
        assert result==dict(receipts=len(vectors['receipts']),canonical=len(vectors['canonical']))
