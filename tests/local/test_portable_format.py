"""Golden format roundtrip through bundled SDK/hash/ZIP code under native MV3 CSP."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from test_runtime import installed


def test_native_bundled_portable_codec_preserves_exact_golden_tables_without_workers(tmp_path):
    golden=json.loads(Path('/app/contracts/business/v1/portable-golden-v2.json').read_text())
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        result=worker.evaluate('''async golden=>{
          const parts=[];let extraWorkers=0;
          globalThis.Worker=class{constructor(){extraWorkers++;throw Error('Worker forbidden in format probe');}};
          const output=await portableProbe.createArchive({datasetId:golden.dataset_id,ownerIds:golden.owner_ids,
            archiveId:'00000000-0000-4000-8000-000000000003',sessionId:'00000000-0000-4000-8000-000000000002',
            createdAt:'2026-10-20T00:00:00.000Z',version:'format-only'},async function*(name){yield* golden.rows[name];},
            {async write(bytes){parts.push(bytes);}});
          const rows=Object.fromEntries(portableProbe.TABLES.map(name=>[name,[]]));
          const input=await portableProbe.readArchive(new Blob(parts),{async manifest(){},async row(name,row){rows[name].push(row);}});
          return {rows,digest:input.manifest.dataset_digest,archiveSha:input.archiveSha256,
            originalSha:output.archiveSha256,extraWorkers,tables:input.manifest.tables};
        }''',golden)
        assert result['digest']==golden['expected_digest']
        assert result['rows']==golden['rows'] and result['tables']==golden['expected_tables']
        assert result['archiveSha']==result['originalSha'] and result['extraWorkers']==0
