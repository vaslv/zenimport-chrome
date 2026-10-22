"""Backups read the published mirror, including retained inactive datasets."""
import base64
from io import BytesIO
import json
from uuid import uuid4
from zipfile import ZipFile
import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_mirror import call as mirror, full, many
from test_authority import ok


@pytest.mark.parametrize('entry',['direct','facade','retired'])
def test_backup_uses_published_projection_after_large_full_refresh(tmp_path,entry):
    name='l6-mirror'
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        assert mirror(worker,'init')['ok']
        assert mirror(worker,'verify')['ok']
        transactions=json.loads(many(1000))['transaction']
        saved=mirror(worker,'refresh',raw=full(101,transaction=transactions),summary=True)
        assert saved['ok'] and saved['tables']['zen_movements']==1000,saved
        generation=saved['root']['activeGeneration']
        assert saved['projection']!=generation
        # Reclaim the obsolete projection before exercising the backup owner.
        for _ in range(200):
            collected=mirror(worker,'collect',now=100000)
            assert collected['ok'],collected
            if collected['result']['complete']:break
        else:pytest.fail('Mirror cleanup did not complete')
        # The fixtures namespace their sentinel independently. Copy both marker
        # slots so the actual owners open the same synthetic database.
        worker.evaluate("""async name=>{
          const keys=['localDatasetSentinel','localDatasetSentinelActivity'];
          const values=await chrome.storage.local.get(keys.map(key=>'l6:'+name+':'+key));
          await chrome.storage.local.set(Object.fromEntries(keys.map(key=>[
            'l4-authority:'+name+':'+key,values['l6:'+name+':'+key]])));
        }""",name)
        if entry=='retired':
            # Model a retained local generation after selecting another writer.
            worker.evaluate("""name=>new Promise((resolve,reject)=>{
              const request=indexedDB.open(name);request.onsuccess=()=>{
                const db=request.result,tx=db.transaction(['runtime','datasets'],'readwrite');
                const roots=tx.objectStore('runtime'),read=roots.get('runtime');
                read.onsuccess=()=>{const root=read.result,rows=tx.objectStore('datasets'),value=rows.get(root.activeGeneration);
                  value.onsuccess=()=>{rows.put({...value.result,lifecycle:'retired'});
                    roots.put({...root,activeMode:'remote',activeGeneration:null,credentialRef:crypto.randomUUID()});};};
                tx.oncomplete=()=>{db.close();resolve(true);};tx.onabort=()=>reject(tx.error);
              };
            })""",name)
        ok(worker,'open',name)
        before=ok(worker,'current',name)['root'];id=str(uuid4())
        if entry=='facade':
            begun=ok(worker,'local-archive-backup-begin',name,requestId=id,generation=generation)
            assert begun['state']=='building'
        else:ok(worker,'backup-begin',name,requestId=id,generation=generation)
        ready=ok(worker,'backup-build',name,requestId=id)
        assert ready['phase']=='ready'
        data=b''.join(base64.b64decode(ok(worker,'backup-chunk',name,requestId=id,number=i)) for i in range(ready['chunks']))
        with ZipFile(BytesIO(data)) as archive:
            manifest=json.loads(archive.read('manifest.json'))
            entities=[json.loads(line) for line in archive.read('tables/zen_entities.ndjson').splitlines()]
            movements=archive.read('tables/zen_movements.ndjson').splitlines()
        assert manifest['zenmoney_identity']['owner_ids']==['1']
        assert len(movements)==1000 and len(entities)==1003
        after=ok(worker,'current',name)['root']
        if entry=='retired':assert after==before
        else:assert after==before|{'epoch':str(int(before['epoch'])+2)}
