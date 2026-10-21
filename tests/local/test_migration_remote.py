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


def test_production_mode_controller_transfers_with_verified_candidates_and_atomic_context(tmp_path):
    from test_authority import ok,FIXTURE
    from backend import storage
    harness=DeliveryHarness(tmp_path/'controller.sqlite3');harness.app.state.portable.start()
    try:
        with server(harness) as url,sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (_,worker,page,_):
            ok(worker,'create');ok(worker,'seed',fixture=FIXTURE);ok(worker,'transfer-credential')
            before=ok(worker,'current')['root']
            candidate=ok(worker,'transfer-candidate',url=url,token=TOKEN)
            assert ok(worker,'current')['root']==before
            journal=ok(worker,'transfer-to-server',credentialRef=candidate['ref'])
            for _ in range(400):
                result=ok(worker,'transfer-step')
                assert result['state'] not in ('blocked','busy'),result
                if result['state']=='complete':break
                if result['state']=='waiting':page.wait_for_timeout(30)
            else:raise AssertionError(ok(worker,'transfer-current'))
            assert ok(worker,'current')['root']['activeMode']=='remote'
            descriptor=ok(worker,'remote-context');assert descriptor['url']==url and not descriptor['legacy']
            assert not harness.remote.writes
            with storage.transaction(harness.path,read_only=True) as db:
                assert db.execute('SELECT awaiting_sync FROM migration_installation').fetchone()[0]==1
                assert db.execute('SELECT count(*) FROM bank_transactions').fetchone()[0]==len(FIXTURE['rows']['bank_transactions'])
            # Imported server stays fenced until an actual explicit Sync. Reject
            # before a new journal/reservation, preserving the completed operation.
            from test_authority import call as authority_call
            assert authority_call(worker,'transfer-to-browser')['code']=='migration_paused'
            assert ok(worker,'current')['root']['pendingSwitchId'] is None
            assert ok(worker,'transfer-current')['phase']=='complete'
            with storage.transaction(harness.path,read_only=True) as db:
                connection=db.execute('SELECT id FROM connections LIMIT 1').fetchone()[0]
            sync=harness.start(connection);assert sync.status_code==202,sync.text
            # Preparation stops that capture; it never calls the financial worker.
            second=ok(worker,'transfer-to-browser')
            assert second['plan']['sourceId']==candidate['identity']['installation_id']
            for _ in range(400):
                result=ok(worker,'transfer-step')
                assert result['state'] not in ('blocked','busy'),result
                if result['state']=='complete':break
                if result['state']=='waiting':page.wait_for_timeout(30)
            else:raise AssertionError(ok(worker,'transfer-current'))
            root=ok(worker,'current')['root'];assert root['activeMode']=='local' and root['activeGeneration']!=before['activeGeneration']
            assert not harness.remote.writes
            with storage.transaction(harness.path,read_only=True) as db:
                assert db.execute('SELECT state FROM migration_installation').fetchone()[0]=='handed_off'
    finally:harness.close()


def test_production_reverse_transfer_requires_shared_pause_consent_and_stops_server_capture(tmp_path):
    from test_authority import ok,call as authority_call
    from uuid import uuid4
    from backend import storage
    harness=DeliveryHarness(tmp_path/'controller-active.sqlite3');harness.app.state.portable.start()
    connection=harness.ready();job=harness.start(connection['id']).json()
    try:
        with server(harness) as url,sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (_,worker,page,_):
            # Use an actual verified legacy credential record, selected remote-only.
            ok(worker,'create')
            candidate=ok(worker,'transfer-candidate',url=url,token=TOKEN)
            ok(worker,'create-remote','remote-profile',credentialRef=candidate['ref'],url=url,peerId=candidate['contextId'])
            assert authority_call(worker,'transfer-to-browser','remote-profile',mode='no-consent')['code']=='migration_paused'
            assert ok(worker,'transfer-current','remote-profile') is None
            ok(worker,'transfer-to-browser','remote-profile')
            for _ in range(400):
                result=ok(worker,'transfer-step','remote-profile')
                assert result['state'] not in ('blocked','busy'),result
                if result['state']=='complete':break
                if result['state']=='waiting':page.wait_for_timeout(30)
            else:raise AssertionError(ok(worker,'transfer-current','remote-profile'))
            assert ok(worker,'current','remote-profile')['root']['activeMode']=='local'
            assert not harness.remote.writes
            with storage.transaction(harness.path,read_only=True) as db:
                assert db.execute('SELECT capture_state FROM capture_jobs WHERE id=?',(job['id'],)).fetchone()[0]=='cancelled'
                assert not db.execute("SELECT 1 FROM capture_intervals WHERE state='complete'").fetchone()
    finally:harness.close()


@pytest.mark.parametrize('saved_start,quota',[(False,False),(True,False),(True,True)])
def test_competing_server_transfer_cancels_only_unused_native_slot(tmp_path,saved_start,quota):
    from test_authority import ok,call as authority_call
    from uuid import uuid4
    from backend import storage
    harness=DeliveryHarness(tmp_path/'competing.sqlite3');harness.ready()
    try:
        with server(harness) as url,sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (_,worker,_,_):
            ok(worker,'create');candidate=ok(worker,'transfer-candidate',url=url,token=TOKEN)
            before=ok(worker,'create-remote','remote-profile',credentialRef=candidate['ref'],url=url,peerId=candidate['contextId'])['root']
            journal=ok(worker,'transfer-to-browser','remote-profile');switch=journal['plan']['id']
            assert ok(worker,'transfer-step','remote-profile')['state']=='progress'
            reserved=ok(worker,'current','remote-profile')['root'];assert reserved['pendingSwitchId']==switch
            if saved_start:
                lease=ok(worker,'journal-claim','remote-profile',switchId=switch,now='1792540800')
                old=ok(worker,'journal-command','remote-profile',lease=lease,now='1792540800')
            foreign=str(uuid4());cap=harness.client.get('/api/v1/migration/portable/capabilities').json()
            body=dict(request_id=str(uuid4()),switch_id=foreign,expected_epoch=cap['participant_epoch'],peer_id=str(uuid4()))
            reply=harness.client.post('/api/v1/migration/portable/commands/source_start',json=body);assert reply.status_code==202,reply.text
            if quota:
                rejected=authority_call(worker,'transfer-cancel','remote-profile',switchId=switch,requestId=str(uuid4()),mode='quota-cancel')
                assert rejected['code']=='quota_exceeded'
                assert ok(worker,'current','remote-profile')['root']==reserved
                assert ok(worker,'journal-rejected','remote-profile',switchId=switch)==[]
                assert ok(worker,'transfer-current','remote-profile')['commands'][0]['request']==old
            cancelled=ok(worker,'transfer-cancel','remote-profile',switchId=switch,requestId=str(uuid4()))
            assert cancelled=='cancelled'
            root=ok(worker,'current','remote-profile')['root'];assert root['activeMode']=='remote' and root['pendingSwitchId'] is None
            assert root['credentialRef']==before['credentialRef'] and int(root['epoch'])==int(before['epoch'])+2
            assert ok(worker,'transfer-current','remote-profile')['commands']==[]
            if saved_start:
                audit=ok(worker,'journal-rejected','remote-profile',switchId=switch)
                assert len(audit)==1 and audit[0]['value']['request']==old
                assert audit[0]['value']['reason']=='foreign_source_epoch'
            with storage.transaction(harness.path,read_only=True) as db:
                current=db.execute('SELECT * FROM migration_installation').fetchone()
                assert current['state']=='export_hold' and current['operation_id']==foreign
                assert db.execute('SELECT count(*) FROM migration_operations').fetchone()[0]==1
            assert not harness.remote.writes
    finally:harness.close()


@pytest.mark.parametrize('history,used,fault',[(False,True,'normal'),(True,True,'quota-route'),(True,False,'drop-join-reply')])
def test_no_import_join_retires_local_copy_without_touching_shared_server(tmp_path,history,used,fault):
    from test_authority import ok,call as authority_call,FIXTURE
    from uuid import uuid4
    from backend import storage
    harness=DeliveryHarness(tmp_path/'join.sqlite3')
    if used:harness.capture(count=3)
    try:
        with server(harness) as url,sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (context,worker,page,_):
            ok(worker,'create')
            if history:ok(worker,'seed',fixture=FIXTURE);ok(worker,'transfer-credential')
            before=ok(worker,'current')['root'];local=ok(worker,'inspect')['rows']
            candidate=ok(worker,'transfer-candidate',url=url,token=TOKEN);assert candidate['identity']['can_import'] is not used
            with storage.transaction(harness.path,read_only=True) as db:
                remote_before=[tuple(row) for row in db.execute('SELECT * FROM bank_transactions ORDER BY id')]
                jobs_before=[tuple(row) for row in db.execute('SELECT * FROM capture_jobs ORDER BY id')]
                participant_before=tuple(db.execute('SELECT * FROM migration_installation').fetchone())
            command=str(uuid4())
            denied=authority_call(worker,'transfer-join',credentialRef=candidate['ref'],requestId=command,mode='no-consent')
            assert denied['code']=='migration_paused' and ok(worker,'transfer-join-current') is None
            intent=ok(worker,'transfer-join',credentialRef=candidate['ref'],requestId=command)
            assert ok(worker,'current')['root']==before
            assert ok(worker,'transfer-join',credentialRef=candidate['ref'],requestId=command)==intent
            if history:
                blocked=authority_call(worker,'journal-create',switchId=str(uuid4()),peerId=str(uuid4()),credentialRef=str(uuid4()))
                assert blocked['code']=='migration_busy'
            if fault=='quota-route':
                rejected=authority_call(worker,'transfer-step',mode=fault);assert rejected['code']=='quota_exceeded'
                assert ok(worker,'current')['root']==before
                assert ok(worker,'transfer-join-current')['phase']=='quiescing'
                assert next(row for row in ok(worker,'inspect')['datasets'] if row['generation']==before['activeGeneration'])['lifecycle']=='active'
            if fault=='drop-join-reply':
                assert authority_call(worker,'transfer-step',mode=fault)['code']=='backend_unavailable'
                session=context.new_cdp_session(page)
                target=next(row for row in session.send('Target.getTargets')['targetInfos'] if row['type']=='service_worker' and row['url']==worker.url)
                assert session.send('Target.closeTarget',dict(targetId=target['targetId']))['success']
                page.evaluate('()=>chrome.runtime.sendMessage({type:"probe-wake"})');ok(page,'open');worker=page
                assert ok(worker,'transfer-join',credentialRef=candidate['ref'],requestId=command)['phase']=='complete'
            else:assert ok(worker,'transfer-step')['state']=='complete'
            root=ok(worker,'current')['root'];assert root['activeMode']=='remote' and root['activeGeneration'] is None
            assert root['credentialRef']==candidate['ref'] and int(root['epoch'])==int(before['epoch'])+1
            descriptor=ok(worker,'remote-context')
            assert descriptor['installationId']==candidate['identity']['installation_id'] and descriptor['datasetId']==candidate['identity']['dataset_id']
            retained=ok(worker,'inspect',generation=before['activeGeneration'])
            assert retained['rows']==local
            assert next(row for row in retained['datasets'] if row['generation']==before['activeGeneration'])['lifecycle']=='retired'
            assert not authority_call(worker,'write',generation=before['activeGeneration'])['ok']
            assert not harness.remote.writes
            with storage.transaction(harness.path,read_only=True) as db:
                assert [tuple(row) for row in db.execute('SELECT * FROM bank_transactions ORDER BY id')]==remote_before
                assert [tuple(row) for row in db.execute('SELECT * FROM capture_jobs ORDER BY id')]==jobs_before
                assert tuple(db.execute('SELECT * FROM migration_installation').fetchone())==participant_before
                assert db.execute('SELECT count(*) FROM migration_operations').fetchone()[0]==0
    finally:harness.close()


def test_cancelled_join_fences_late_quiescence_and_can_recover_after_token_rotation(tmp_path):
    from test_authority import ok,call as authority_call,FIXTURE
    from uuid import uuid4
    harness=DeliveryHarness(tmp_path/'join-cancel.sqlite3');harness.capture(count=1)
    try:
        with server(harness) as url,sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (_,worker,_,_):
            ok(worker,'create');ok(worker,'seed',fixture=FIXTURE);ok(worker,'transfer-credential')
            before=ok(worker,'current')['root'];candidate=ok(worker,'transfer-candidate',url=url,token=TOKEN);command=str(uuid4())
            ok(worker,'transfer-join',credentialRef=candidate['ref'],requestId=command)
            ok(worker,'credential',credentialRef=str(uuid4()))
            assert ok(worker,'transfer-join-cancel',requestId=command)['phase']=='cancelled'
            current=ok(worker,'current')['root'];facts=ok(worker,'inspect')['rows']
            assert authority_call(worker,'quiesce-local',request=current,requestId=command,mode='join')['code']=='migration_busy'
            assert ok(worker,'inspect')['rows']==facts
            assert current['activeMode']=='local' and current['activeGeneration']==before['activeGeneration']
            assert not harness.remote.writes
    finally:harness.close()


@pytest.mark.parametrize('change',['owner','dataset'])
def test_server_change_during_no_import_join_never_selects_another_context(tmp_path,change):
    from test_authority import ok,call as authority_call,FIXTURE
    from uuid import uuid4
    from backend import storage
    harness=DeliveryHarness(tmp_path/'join-changed.sqlite3');harness.capture(count=1)
    try:
        with server(harness) as url,sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (_,worker,_,_):
            ok(worker,'create');ok(worker,'seed',fixture=FIXTURE);ok(worker,'transfer-credential')
            before=ok(worker,'current')['root'];candidate=ok(worker,'transfer-candidate',url=url,token=TOKEN);command=str(uuid4())
            ok(worker,'transfer-join',credentialRef=candidate['ref'],requestId=command)
            if change=='owner':harness.remote.data['user']=[{'id':2}]
            else:
                with storage.transaction(harness.path) as db:db.execute("UPDATE service_meta SET value=? WHERE key='instance_id'",(str(uuid4()),))
            refused=authority_call(worker,'transfer-step')
            assert refused['code']==('migration_wrong_account' if change=='owner' else 'migration_invalid')
            assert ok(worker,'current')['root']==before
            assert ok(worker,'transfer-join-current')['phase']=='quiescing'
            assert ok(worker,'transfer-join-cancel',requestId=command)['phase']=='cancelled'
            assert not harness.remote.writes
    finally:harness.close()


def test_reverse_migration_rejects_replaced_selected_dataset_without_fallback(tmp_path):
    from test_authority import ok,call as authority_call
    from uuid import uuid4
    from backend import storage
    harness=DeliveryHarness(tmp_path/'joined-drift.sqlite3');harness.capture(count=1)
    try:
        with server(harness) as url,sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (_,worker,_,_):
            ok(worker,'create');candidate=ok(worker,'transfer-candidate',url=url,token=TOKEN)
            ok(worker,'transfer-join',credentialRef=candidate['ref'],requestId=str(uuid4()))
            assert ok(worker,'transfer-step')['state']=='complete'
            selected=ok(worker,'current')['root']
            with storage.transaction(harness.path) as db:db.execute("UPDATE service_meta SET value=? WHERE key='instance_id'",(str(uuid4()),))
            assert authority_call(worker,'transfer-to-browser')['code']=='migration_invalid'
            assert ok(worker,'current')['root']==selected and selected['activeMode']=='remote'
            assert ok(worker,'transfer-current') is None
            assert not harness.remote.writes
    finally:harness.close()


@pytest.mark.parametrize('moment',['before_reserve','after_prepare'])
def test_source_lineage_remains_bound_after_reverse_request(tmp_path,moment):
    from test_authority import ok,call as authority_call
    from uuid import uuid4
    from backend import storage
    harness=DeliveryHarness(tmp_path/'source-lineage.sqlite3');harness.ready();harness.app.state.portable.start()
    try:
        with server(harness) as url,sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile',hosts=('http://127.0.0.1/*',)) as (_,worker,page,_):
            ok(worker,'create');candidate=ok(worker,'transfer-candidate',url=url,token=TOKEN)
            before=ok(worker,'create-remote','remote-profile',credentialRef=candidate['ref'],url=url,peerId=candidate['contextId'])['root']
            requested=ok(worker,'transfer-to-browser','remote-profile');switch=requested['plan']['id']
            assert ok(worker,'remote-context','remote-profile')['datasetId']==candidate['identity']['dataset_id']
            if moment=='after_prepare':
                for _ in range(3):assert ok(worker,'transfer-step','remote-profile')['state']=='progress'
                assert ok(worker,'transfer-current','remote-profile')['phase']=='source_quiescing'
            replaced=str(uuid4())
            with storage.transaction(harness.path) as db:db.execute("UPDATE service_meta SET value=? WHERE key='instance_id'",(replaced,))
            if moment=='before_reserve':
                assert ok(worker,'transfer-step','remote-profile')['code']=='migration_invalid'
                assert ok(worker,'current','remote-profile')['root']==before
                assert ok(worker,'transfer-cancel','remote-profile',switchId=switch,requestId=str(uuid4()))=='cancelled'
            else:
                for _ in range(300):
                    result=ok(worker,'transfer-step','remote-profile')
                    assert result['state'] not in ('blocked','busy'),result
                    if result['state']=='cancelled':break
                    if result['state']=='waiting':page.wait_for_timeout(20)
                else:raise AssertionError(ok(worker,'transfer-current','remote-profile'))
                journal=ok(worker,'transfer-current','remote-profile')
                assert not any(row['command'].startswith('destination_') and row['command']!='destination_discard' for row in journal['commands'])
                assert not any(row['command']=='source_handoff' for row in journal['receipts'])
                assert any(row['command']=='source_resume' and row['dataset_id']==replaced for row in journal['receipts'])
            root=ok(worker,'current','remote-profile')['root'];assert root['activeMode']=='remote' and root['pendingSwitchId'] is None
            assert root['credentialRef']==before['credentialRef']
            assert ok(worker,'remote-context','remote-profile')['datasetId']==candidate['identity']['dataset_id']
            with storage.transaction(harness.path,read_only=True) as db:
                assert db.execute('SELECT state FROM migration_installation').fetchone()[0]=='active'
                assert db.execute("SELECT value FROM service_meta WHERE key='instance_id'").fetchone()[0]==replaced
            assert not harness.remote.writes
    finally:harness.close()
