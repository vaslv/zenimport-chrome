"""Isolated browser fixtures. No connection to a real bank or ZenMoney."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import platform
import shutil
import tempfile
import threading
from uuid import uuid4

ORIGIN = 'https://ipay.vietinbank.vn'
TOKEN = 'fixture-backend-token-never-real'
BANK = Path(__file__).with_name('bank.html').read_text()

class PopupBackend:
    def __init__(self):
        self.accounts = {}
        self.connection_id = str(uuid4())
        self.calls = []
        self.version = 1
    def request(self, method, path, body):
        self.calls.append((method,path,body))
        if path == '/api/v1/info':
            return {'api_version':self.version}
        if path == '/api/v1/zenmoney/accounts':
            return {'accounts':[{'id':'target-vnd','title':'Fixture VND '+'Long account title '*8,'currency':'VND','instrument':2},
                {'id':'target-usd','title':'Fixture USD','currency':'USD','instrument':3}]}
        if path == '/api/v1/connections/discover':
            for raw in body['accounts']:
                self.accounts.setdefault(raw['source_key'],raw|{'id':str(uuid4()),'selection':'unconfigured','settings_version':0,
                    'zenmoney_account_id':None,'import_start':None,'last_complete_end':None})
            return {'id':self.connection_id,'bank':body['bank'],'accounts_complete':False,'accounts':list(self.accounts.values())}
        if '/settings' in path:
            for account in self.accounts.values():
                if account['id'] == path.split('/')[4]:
                    account.update({key:value for key,value in body.items() if key!='expected_version'})
                    account['settings_version']+=1
                    return account
        raise AssertionError((method,path,body))

@contextmanager
def http_server(service):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def do_GET(self): self.respond()
        def do_PUT(self): self.respond()
        def do_POST(self): self.respond()
        def respond(self):
            if self.headers.get('Authorization') != 'Bearer '+getattr(service,'token',TOKEN):
                self.send_response(401);self.send_header('Content-Type','application/json');self.end_headers()
                self.wfile.write(json.dumps({'error':{'code':'unauthorized'}}).encode());return
            length=int(self.headers.get('Content-Length','0'))
            body=json.loads(self.rfile.read(length)) if length else None
            try: value=service.request(self.command,self.path,body); status=200
            except AssertionError: value={'error':{'code':'not_found'}}; status=404
            self.send_response(status); self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(value).encode())
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try: yield f'http://127.0.0.1:{server.server_port}'
    finally: server.shutdown();server.server_close();thread.join()

@contextmanager
def installed(playwright, url, bank_api=None, *, bank_origin=ORIGIN, bank_html=BANK, bank_url=None):
    with tempfile.TemporaryDirectory() as temporary:
        extension=Path(temporary)/'extension';shutil.copytree('/app/dist/extension',extension)
        manifest=json.loads((extension/'manifest.json').read_text())
        # Test-only installation grants exactly these two fixture origins to
        # avoid Chrome's native install/permission prompt in headless mode.
        # All shipped JavaScript and the artifact are otherwise unchanged.
        manifest['host_permissions']=['http://127.0.0.1/*',bank_origin+'/*']
        (extension/'manifest.json').write_text(json.dumps(manifest))
        context=playwright.chromium.launch_persistent_context(str(Path(temporary)/'profile'),channel='chromium',headless=True,
            args=[f'--disable-extensions-except={extension}',f'--load-extension={extension}','--no-sandbox'],viewport={'width':1000,'height':800})
        # Stable calendar; bank MAIN and ISOLATED worlds must share real elapsed time.
        # Only extension pages need a shifted Date.now for relative-date assertions.
        context.add_init_script("""(() => {const Original=Date;const skew=Original.parse('2026-10-16T05:00:00Z')-Original.now();globalThis.Date=class extends Original{constructor(...args){super(...(args.length?args:[Original.now()+skew]));}static now(){return Original.now()+(location.protocol==='chrome-extension:'?skew:0);}};})();""")
        if Path('/results').is_dir():
            Path('/results/runtime.json').write_text(json.dumps({'chromium':context.browser.version,'playwright':'1.58.0','python':platform.python_version(),'architecture':platform.machine()},sort_keys=True))
        context.route(bank_origin+'/**' ,lambda route:route.fulfill(content_type='text/html',body=bank_html))
        if bank_api: context.route('https://api-ipay.vietinbank.vn/**' if bank_origin==ORIGIN else bank_origin+'/w2/process',bank_api)
        worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        identifier=worker.url.split('/')[2]
        bank=context.new_page();bank.goto(bank_url or (bank_origin+'/payment-history?accountNo=12345678'))
        popup=context.new_page();popup.goto(f'chrome-extension://{identifier}/popup.html');bank.bring_to_front()
        yield context,worker,bank,popup,identifier
        context.close()

def connect(popup,bank,url):
    popup.locator('#url').fill(url);popup.locator('#token').fill(TOKEN)
    bank.bring_to_front();popup.locator('#server-form button').click()

def run_clock(popup,worker):
    # Wake the real alarm listener early instead of sleeping for Chrome's 30s
    # minimum. All collection/lease/pump logic remains the production worker.
    worker.evaluate("chrome.alarms.create('capture',{when:Date.now()+100})")
    popup.wait_for_timeout(300)
