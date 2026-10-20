"""One explicitly approved read from an isolated MV3 worker. Never writes to API."""
import argparse
import json
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, '/app/tests/local')
from test_runtime import installed
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--approved-read',action='store_true')
args=parser.parse_args()
if not args.approved_read:raise SystemExit('Explicit read scenario approval is required')
journal=Path('/state/live-read.json')
if journal.exists():raise SystemExit('A prior journal exists; review it before any further API request')
result={'status':'preparing','phase':'setup','dispatch_started':False,'calls':0,'identity_verified':False,'scope':'one read-only full diff'}
journal.write_text(json.dumps(result))
try:
    token=Path('/run/secrets/test-token').read_text().strip()
    expected=str(json.loads(Path('/run/secrets/test-owner.json').read_text())['owner_id'])
    if not token or not expected:raise ValueError('missing_private_configuration')
    with tempfile.TemporaryDirectory(prefix='zenimport-live-mv3-') as directory,sync_playwright() as p:
        root=Path(directory)
        with installed(p,root/'extension',root/'profile',hosts=['https://api.zenmoney.ru/*']) as (context,worker,_,_):
            result.update(status='dispatching',phase='api_read',dispatch_started=True);journal.write_text(json.dumps(result))
            reply=worker.evaluate('token=>probe.readProbe(token)',token)
            result.update(calls=reply.get('calls',0),identity_verified=reply.get('owners')==[expected],browser=context.browser.version)
            passed=reply.get('ok') and result['calls']==1 and result['identity_verified']
            result.update(status='passed' if passed else 'failed')
            if not passed:result['error_code']=reply.get('code','identity_mismatch')
    journal.write_text(json.dumps(result,indent=2));print(json.dumps(result))
    raise SystemExit(0 if passed else 1)
except SystemExit:raise
except Exception as error:
    result.update(status='interrupted',error_type=type(error).__name__);journal.write_text(json.dumps(result,indent=2))
    raise SystemExit('Live read interrupted; inspect the private journal, do not retry automatically') from None
