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
            self.end_headers();self.wfile.write(reply.content)
        do_POST=request
        do_GET=request
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
