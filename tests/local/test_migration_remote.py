"""Native privileged fetch against the actual isolated Python migration API."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import threading
import pytest
pytest.importorskip('backend')
from delivery_factory import DeliveryHarness
from capture_factory import TOKEN
from playwright.sync_api import sync_playwright
from test_runtime import installed


@contextmanager
def server(harness):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def request(self):
            raw=self.rfile.read(int(self.headers.get('Content-Length','0')))
            reply=harness.client.request(self.command,self.path,content=raw,headers={'Authorization':self.headers.get('Authorization',''),'Content-Type':'application/json'})
            self.send_response(reply.status_code)
            self.send_header('Content-Type',reply.headers.get('content-type','application/json'))
            self.send_header('Content-Length',str(len(reply.content)))
            if 'x-chunk-sha256' in reply.headers:self.send_header('x-chunk-sha256',reply.headers['x-chunk-sha256'])
            self.end_headers();self.wfile.write(reply.content)
        do_POST=request
        do_GET=request
        do_PUT=request
    http=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
    try:yield 'http://127.0.0.1:'+str(http.server_port)
    finally:http.shutdown();http.server_close();thread.join()


def call(worker,action,url,**options):return worker.evaluate('data=>migrationProbe.run(data.action,data.args)',dict(action=action,args=dict(url=url,token=TOKEN)|options))


def test_native_gateway_checks_fresh_server_owner_without_financial_writes(tmp_path):
    harness=DeliveryHarness(tmp_path/'remote.sqlite3')
    try:
        with server(harness) as url,sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (_,worker,_,_):
            before=len(harness.remote.reads);identity=call(worker,'identity',url);assert identity['ok'],identity
            assert identity['result']['owner_ids']==['1'] and len(harness.remote.reads)==before+1
            assert identity['result']['can_import'] and not harness.remote.writes
            cap=call(worker,'capabilities',url);assert cap['ok'] and cap['result']['installation_id']==identity['result']['installation_id'],cap
            denied=call(worker,'identity',url,permission=False);assert denied==dict(ok=False,code='permission_required')
            unauthorized=call(worker,'identity',url,token='invalid-fixture-token');assert unauthorized==dict(ok=False,code='unauthorized'),unauthorized
            assert len(harness.remote.reads)==before+1 and not harness.remote.writes
    finally:harness.close()


def test_native_runner_transfers_a_real_archive_to_python_without_financial_writes(tmp_path):
    from uuid import uuid4
    from test_authority import ok,FIXTURE
    from backend import storage
    harness=DeliveryHarness(tmp_path/'target.sqlite3')
    harness.app.state.portable.start()
    try:
        with server(harness) as url,sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (_,worker,page,_):
            ok(worker,'create');ok(worker,'seed',fixture=FIXTURE);ok(worker,'rotate-for-setup',credentialRef=str(uuid4()))
            identity=ok(worker,'remote-peer',url=url,token=TOKEN)
            assert identity['can_import'] and identity['owner_ids']==['1']
            switch=str(uuid4())
            ok(worker,'journal-create',switchId=switch,peerId=identity['installation_id'],credentialRef=str(uuid4()))
            for _ in range(400):
                result=ok(worker,'journal-run',now='1792540800')
                assert result['state'] not in ('blocked','busy'),result
                if result['state']=='complete':break
                if result['state']=='waiting':page.wait_for_timeout(30)
            else:raise AssertionError(ok(worker,'journal-current'))
            journal=ok(worker,'journal-current')
            assert journal['phase']=='complete' and not harness.remote.writes
            with storage.transaction(harness.path,read_only=True) as db:
                current=dict(db.execute('SELECT * FROM migration_installation WHERE id=1').fetchone())
                assert current['state']=='active' and current['awaiting_sync']==1
                assert db.execute('SELECT count(*) FROM bank_transactions').fetchone()[0]==len(FIXTURE['rows']['bank_transactions'])
            assert ok(worker,'current')['root']['activeMode']=='remote'
    finally:harness.close()


def test_real_python_source_transfers_into_a_fresh_remote_browser_profile(tmp_path):
    from uuid import uuid4
    from test_authority import ok
    from backend import storage
    harness=DeliveryHarness(tmp_path/'source.sqlite3')
    job,first,auth,_=harness.capture(count=3)
    for account in job['accounts']:
        for interval in account['intervals']:
            if interval['id']==first['id']:continue
            assert harness.page(job,interval,auth).status_code==200
            assert harness.complete(job,interval,auth).status_code==200
    harness.worker.run_once()
    # Fake SDK's lock diagnostic is test-only, not portable financial metadata.
    with storage.transaction(harness.path) as db:db.execute("DELETE FROM service_meta WHERE key='fixture-network-write-lock-free'")
    financial_writes=len(harness.remote.writes)
    harness.app.state.portable.start()
    try:
        with server(harness) as url,sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (_,worker,page,_):
            remote_ref=str(uuid4())
            ok(worker,'create-remote',url=url,peerId=str(uuid4()),credentialRef=remote_ref)
            identity=ok(worker,'remote-peer',url=url,token=TOKEN)
            switch=str(uuid4())
            ok(worker,'journal-create',switchId=switch,peerId=identity['installation_id'],credentialRef=str(uuid4()),mode='remote-to-local')
            for _ in range(400):
                result=ok(worker,'journal-run',now='1792540800');assert result['state'] not in ('blocked','busy'),result
                if result['state']=='complete':break
                if result['state']=='waiting':page.wait_for_timeout(30)
            else:raise AssertionError(ok(worker,'journal-current'))
            current=ok(worker,'current')['root'];assert current['activeMode']=='local'
            data=ok(worker,'inspect');assert len(data['rows']['bank_transactions'])==3
            participant=next(row for row in data['participants'] if row['generation']==current['activeGeneration'])
            assert participant['awaitingSync'] and participant['state']=='active'
            assert len(harness.remote.writes)==financial_writes
            with storage.transaction(harness.path,read_only=True) as db:
                assert db.execute('SELECT state FROM migration_installation WHERE id=1').fetchone()[0]=='handed_off'
    finally:harness.close()


def test_real_python_destination_discards_before_native_source_resumes(tmp_path):
    from uuid import uuid4
    from test_authority import ok,FIXTURE
    from backend import storage
    harness=DeliveryHarness(tmp_path/'cancel-target.sqlite3');harness.app.state.portable.start()
    try:
        with server(harness) as url,sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (_,worker,page,_):
            ok(worker,'create');ok(worker,'seed',fixture=FIXTURE);ok(worker,'rotate-for-setup',credentialRef=str(uuid4()))
            before=ok(worker,'inspect')['rows'];identity=ok(worker,'remote-peer',url=url,token=TOKEN);switch=str(uuid4())
            ok(worker,'journal-create',switchId=switch,peerId=identity['installation_id'],credentialRef=str(uuid4()))
            for _ in range(400):
                if ok(worker,'journal-current')['phase']=='destination_verified':break
                result=ok(worker,'journal-run',now='1792540800');assert result['state'] not in ('blocked','busy'),result
                if result['state']=='waiting':page.wait_for_timeout(30)
            else:raise AssertionError('arm did not finish')
            assert ok(worker,'journal-cancel',switchId=switch,requestId=str(uuid4()))=='requested'
            for _ in range(100):
                result=ok(worker,'journal-run',now='1792540800');assert result['state'] not in ('blocked','busy'),result
                if result['state']=='cancelled':break
            else:raise AssertionError(result)
            assert ok(worker,'current')['root']['activeMode']=='local'
            assert ok(worker,'inspect')['rows']==before and not harness.remote.writes
            with storage.transaction(harness.path,read_only=True) as db:
                assert db.execute('SELECT state FROM migration_operations WHERE switch_id=?',(switch,)).fetchone()[0]=='discarded'
    finally:harness.close()
