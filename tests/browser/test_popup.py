from pathlib import Path
from uuid import uuid4
import threading
import pytest
from playwright.sync_api import sync_playwright, expect
from support import PopupBackend, http_server, installed, connect, TOKEN, run_clock


def test_popup_setup_keyboard_dates_and_no_bank_ui():
    service=PopupBackend()
    with http_server(service) as url, sync_playwright() as p, installed(p,url) as (context,worker,bank,popup,identifier):
        errors=[];popup.on('pageerror',lambda error:errors.append(str(error)))
        expect(popup.locator('#settings')).to_have_attribute('open','')
        expect(popup.locator('#sync')).to_be_disabled()
        connect(popup,bank,url)
        expect(popup.locator('.account')).to_have_count(1)
        expect(popup.locator('#server-form')).to_be_hidden()
        expect(popup.locator('.account select option')).to_have_count(3) # unset, ignored, same currency
        assert popup.locator('.account input[type=date]').input_value()
        popup.get_by_role('button',name='6 месяцев',exact=True).is_hidden() # unset, no accidental default target
        popup.locator('.account select').select_option('target-vnd')
        expect(popup.get_by_role('button',name='6 месяцев',exact=True)).to_be_visible()
        first_date=popup.locator('.account input[type=date]').input_value()
        popup.get_by_role('button',name='6 месяцев',exact=True).click()
        assert popup.locator('.account input[type=date]').input_value()<first_date
        popup.get_by_role('button',name='30 дней',exact=True).click()
        assert popup.locator('.account input[type=date]').input_value()==first_date
        popup.get_by_role('button',name='Сохранить счёт',exact=True).click()
        expect(popup.locator('#sync')).to_be_enabled()
        expect(popup.locator('#settings')).not_to_have_attribute('open','')
        popup.locator('#settings > summary').click()
        popup.set_viewport_size({'width':390,'height':700})
        if Path('/results').is_dir():popup.screenshot(path='/results/popup-settings.png',full_page=True)
        assert popup.evaluate('document.documentElement.scrollWidth<=innerWidth')
        popup.locator('#settings > summary').focus();popup.keyboard.press('Space')
        expect(popup.locator('#server-form')).to_be_hidden()
        if Path('/results').is_dir():popup.screenshot(path='/results/popup-compact.png',clip=popup.locator('main').bounding_box())
        assert not bank.locator('[id*=zenimport], [class*=zenimport]').count()
        assert not [call for call in service.calls if call[1]=='/api/v1/jobs']
        # The content world cannot read backend configuration.
        assert worker.evaluate("async()=>{const [{result}]=await chrome.scripting.executeScript({target:{tabId:(await chrome.tabs.query({url:'https://ipay.vietinbank.vn/*'}))[0].id},func:async()=>{try{return await chrome.storage.local.get('config')}catch{return {denied:true}}}});return !result?.config}")
        popup.reload();popup.locator('#settings').evaluate('(e)=>e.open=true');bank.bring_to_front();popup.locator('#refresh-accounts').click()
        expect(popup.locator('.account select')).to_have_value('target-vnd')
        popup.locator('.account select').select_option('ignored');popup.get_by_role('button',name='Сохранить счёт',exact=True).click()
        expect(popup.locator('#sync')).to_be_disabled()
        assert not errors


def test_incompatible_backend_and_unsupported_page_do_not_start_jobs():
    service=PopupBackend();service.version=2
    with http_server(service) as url, sync_playwright() as p, installed(p,url) as (_,_,bank,popup,_):
        connect(popup,bank,url)
        expect(popup.locator('#status')).to_contain_text('несовместимы')
        expect(popup.locator('#sync')).to_be_disabled()
        assert not [call for call in service.calls if call[1]=='/api/v1/jobs']


def test_native_action_popup_keeps_intrinsic_width():
    """Native action targets are not exposed as Playwright context pages."""
    import base64
    import json
    service=PopupBackend()
    with http_server(service) as url, sync_playwright() as p, installed(p,url) as (context,worker,bank,tab,identifier):
        tab.close();bank.bring_to_front()
        cdp=context.new_cdp_session(bank)
        worker.evaluate('chrome.action.openPopup()')
        targets=cdp.send('Target.getTargets')['targetInfos']
        target=next(t for t in targets if t['type']=='page' and t['url']==f'chrome-extension://{identifier}/popup.html')
        session=cdp.send('Target.attachToTarget',{'targetId':target['targetId'],'flatten':False})['sessionId']
        responses={}
        def receive(event):
            if event['sessionId']==session:
                message=json.loads(event['message'])
                if 'id' in message:responses[message['id']]=message
        cdp.on('Target.receivedMessageFromTarget',receive)
        def command(method,params=None):
            number=len(responses)+1
            cdp.send('Target.sendMessageToTarget',{'sessionId':session,'message':json.dumps({'id':number,'method':method,'params':params or {}})})
            for _ in range(100):
                if number in responses:break
                bank.wait_for_timeout(50)
            result=responses[number]
            assert 'error' not in result,result
            return result['result']
        expression="""(() => {
            const fits=id=>{const e=document.getElementById(id);return e.scrollWidth<=e.clientWidth};
            return {ready:document.getElementById('settings').open,width:innerWidth,
                fits:document.documentElement.scrollWidth<=innerWidth&&fits('sync')&&fits('refresh-accounts'),
                input:document.getElementById('url').getBoundingClientRect().width};
        })()"""
        for _ in range(100):
            layout=command('Runtime.evaluate',{'expression':expression,'returnByValue':True})['result'].get('value',{})
            if layout.get('ready'):break
            bank.wait_for_timeout(50)
        assert layout.get('ready'),layout
        assert layout['width']==390,layout
        assert layout['fits'],layout
        assert layout['input']>=340,layout
        if Path('/results').is_dir():
            screenshot=command('Page.captureScreenshot',{'captureBeyondViewport':True})['data']
            Path('/results/popup-native.png').write_bytes(base64.b64decode(screenshot))


@pytest.mark.parametrize('first', ['url', 'token'])
def test_connection_draft_survives_popup_closure_and_failed_connection(first):
    service=PopupBackend()
    with http_server(service) as url, sync_playwright() as p, installed(p,url) as (context,worker,bank,popup,identifier):
        values={'url':url,'token':TOKEN}
        def reopen(old):
            old.close()
            fresh=context.new_page();fresh.goto(f'chrome-extension://{identifier}/popup.html')
            bank.bring_to_front()
            return fresh
        # Close immediately after each paste, without waiting for a save button.
        popup.locator('#'+first).fill(values[first])
        popup=reopen(popup)
        expect(popup.locator('#'+first)).to_have_value(values[first])
        second='token' if first=='url' else 'url'
        popup.locator('#'+second).fill(values[second])
        popup=reopen(popup)
        for field,value in values.items():expect(popup.locator('#'+field)).to_have_value(value)
        assert not worker.evaluate("async()=> (await chrome.storage.local.get('config')).config")
        assert not service.calls # Drafts do not connect or authorize synchronization.
        assert worker.evaluate("async()=>{const [{result}]=await chrome.scripting.executeScript({target:{tabId:(await chrome.tabs.query({url:'https://ipay.vietinbank.vn/*'}))[0].id},func:async()=>{try{return !(await chrome.storage.session.get('connectionDraft')).connectionDraft}catch{return true}}});return result}")
        service.version=2
        popup.locator('#connect').click()
        expect(popup.locator('#status')).to_contain_text('несовместимы')
        popup=reopen(popup)
        for field,value in values.items():expect(popup.locator('#'+field)).to_have_value(value)
        service.version=1
        popup.locator('#connect').click()
        expect(popup.locator('.account')).to_have_count(1)
        expect(popup.locator('#token')).to_have_value('')
        assert not worker.evaluate("async()=> (await chrome.storage.session.get('connectionDraft')).connectionDraft")
        popup=reopen(popup)
        expect(popup.locator('#url')).to_have_value(url)
        expect(popup.locator('#token')).to_have_value('')
        assert not [call for call in service.calls if call[1]=='/api/v1/jobs']


def test_settings_default_to_collapsed_but_reopen_for_new_accounts():
    service=PopupBackend()
    with http_server(service) as url, sync_playwright() as p, installed(p,url) as (context,worker,bank,popup,identifier):
        connect(popup,bank,url)
        expect(popup.locator('.account')).to_have_count(1)
        expect(popup.locator('#settings')).to_have_attribute('open','')
        expect(popup.locator('#server-form')).to_be_hidden()
        popup.locator('.account select').select_option('target-vnd')
        popup.get_by_role('button',name='Сохранить счёт',exact=True).click()
        expect(popup.locator('#settings')).not_to_have_attribute('open','')
        popup.reload()
        expect(popup.locator('#sync')).to_be_enabled()
        expect(popup.locator('#settings')).not_to_have_attribute('open','')
        popup.locator('#settings > summary').click()
        expect(popup.locator('#server-form')).to_be_hidden()
        popup.locator('#connection-settings > summary').click()
        expect(popup.locator('#server-form')).to_be_visible()
        # A later-discovered account needs a decision; the server connection does not.
        service.accounts['87654321']=dict(next(iter(service.accounts.values())),id=str(uuid4()),source_key='87654321',
            label='Second fixture account',masked_number='••4321',selection='unconfigured',settings_version=0,
            zenmoney_account_id=None,import_start=None)
        popup.reload()
        expect(popup.locator('.account')).to_have_count(2)
        expect(popup.locator('#settings')).to_have_attribute('open','')
        expect(popup.locator('#server-form')).to_be_hidden()
        popup.locator('.account').nth(1).locator('select').select_option('ignored')
        popup.locator('.account').nth(1).get_by_role('button',name='Сохранить счёт',exact=True).click()
        expect(popup.locator('#settings')).not_to_have_attribute('open','')
        service.version=2
        popup.reload()
        expect(popup.locator('#status')).to_contain_text('несовместимы')
        expect(popup.locator('#server-form')).to_be_visible()


def test_account_save_shows_pending_error_and_confirmation_at_the_button():
    class SlowSettings(PopupBackend):
        def __init__(self):
            super().__init__();self.started=threading.Event();self.release=threading.Event();self.reject=True
        def request(self,method,path,body):
            if path.endswith('/settings'):
                self.started.set()
                assert self.release.wait(10)
                if self.reject:raise AssertionError('fixture failure')
            return super().request(method,path,body)
    service=SlowSettings()
    with http_server(service) as url, sync_playwright() as p, installed(p,url) as (_,worker,bank,popup,_):
        connect(popup,bank,url)
        expect(popup.locator('.account')).to_have_count(1)
        popup.locator('.account select').select_option('target-vnd')
        popup.set_viewport_size({'width':390,'height':300})
        popup.get_by_role('button',name='Сохранить счёт',exact=True).click()
        expect(popup.get_by_role('button',name='Сохраняем…',exact=True)).to_be_disabled()
        expect(popup.locator('.account-status')).to_be_visible()
        expect(popup.locator('.account-status')).to_contain_text('Сохраняем счёт')
        expect(popup.locator('.account select')).to_be_disabled()
        assert service.started.is_set()
        if Path('/results').is_dir():popup.screenshot(path='/results/account-saving.png')
        service.release.set()
        expect(popup.locator('.account-status')).to_have_attribute('data-tone','error')
        expect(popup.locator('.account-status')).to_be_visible()
        expect(popup.get_by_role('button',name='Сохранить счёт',exact=True)).to_be_enabled()
        expect(popup.locator('.account select')).to_have_value('target-vnd')
        service.reject=False
        popup.get_by_role('button',name='Сохранить счёт',exact=True).click()
        expect(popup.locator('#settings')).not_to_have_attribute('open','')
        popup.locator('#settings > summary').click()
        expect(popup.get_by_role('button',name='Сохранено',exact=True)).to_be_disabled()
        expect(popup.locator('.account-status')).to_contain_text('Счёт сохранён')
        expect(popup.locator('.account-status')).to_have_attribute('data-tone','success')
        popup.reload()
        expect(popup.locator('#sync')).to_be_enabled()
        popup.locator('#settings > summary').click()
        expect(popup.get_by_role('button',name='Сохранено',exact=True)).to_be_disabled()
        popup.locator('.account input[type=date]').fill('2026-04-16')
        expect(popup.get_by_role('button',name='Сохранить счёт',exact=True)).to_be_enabled()
        expect(popup.locator('.account-status')).to_be_hidden()
        assert not [call for call in service.calls if call[1]=='/api/v1/jobs']


def test_last_successful_sync_survives_reopening_failed_runs_and_is_scoped_to_connection():
    class SyncBackend(PopupBackend):
        def __init__(self):
            super().__init__()
            self.job={'id':'fixture-job','capture_state':'complete','delivery_state':'waiting','accounts':[],
                'delivery':{'delivered':0,'suppressed':0,'pending':1,'uncertain':0},'errors':[]}
        def request(self,method,path,body):
            if path=='/api/v1/jobs/fixture-job':return self.job
            return super().request(method,path,body)
    service=SyncBackend()
    with http_server(service) as url, sync_playwright() as p, installed(p,url) as (_,worker,bank,popup,_):
        connect(popup,bank,url)
        expect(popup.locator('.account')).to_have_count(1)
        popup.locator('.account select').select_option('target-vnd')
        popup.get_by_role('button',name='Сохранить счёт',exact=True).click()
        expect(popup.locator('#sync')).to_be_enabled()
        expect(popup.locator('#last-sync')).to_be_hidden()
        worker.evaluate("""async()=>{
          const {view}=await chrome.storage.local.get('view');
          Date.now=()=>Date.parse('2026-10-16T05:00:00Z');
          await chrome.storage.local.set({capture:{phase:'complete',connection:view.connection,bank:view.bank,
            startedAt:'2026-10-16T04:00:00Z',command:{},job:{id:'fixture-job',delivery_state:'waiting'}}});
        }""")
        # Fire via real alarm without a long wall-clock wait.
        run_clock(popup,worker)
        expect(popup.locator('#status')).to_contain_text('Сервер отправляет')
        expect(popup.locator('#last-sync')).to_be_hidden()
        service.job['delivery_state']='complete'
        service.job['delivery'].update(pending=0)
        run_clock(popup,worker)
        expect(popup.locator('#last-sync')).to_contain_text('16 октября 2026')
        expect(popup.locator('#last-sync')).to_contain_text('только что')
        saved=worker.evaluate("async()=> (await chrome.storage.local.get('syncHistory')).syncHistory")
        assert list(saved.values())==['2026-10-16T05:00:00.000Z']
        popup.reload()
        expect(popup.locator('#last-sync')).to_contain_text('16 октября 2026')
        popup.evaluate("Date.now=()=>Date.parse('2026-10-16T07:00:00Z')")
        expect(popup.locator('#last-sync')).to_contain_text('2 часа назад')
        if Path('/results').is_dir():popup.screenshot(path='/results/popup-last-sync.png',clip=popup.locator('main').bounding_box())
        worker.evaluate("""async()=>{
          const {capture}=await chrome.storage.local.get('capture');
          await chrome.storage.local.set({capture:{...capture,completedAt:undefined,phase:'failed',error:'history_incomplete'}});
        }""")
        expect(popup.locator('#status')).to_contain_text('Сбор прерван')
        expect(popup.locator('#last-sync')).to_contain_text('2 часа назад')
        assert worker.evaluate("async()=> (await chrome.storage.local.get('syncHistory')).syncHistory")==saved
        service.connection_id=str(uuid4())
        popup.reload()
        expect(popup.locator('#sync')).to_be_enabled()
        expect(popup.locator('#last-sync')).to_be_hidden()
        service.connection_id=next(iter(saved)).split('|')[-1]
        popup.reload()
        expect(popup.locator('#last-sync')).to_contain_text('16 октября 2026')
        bank.goto('about:blank');bank.bring_to_front();popup.reload()
        expect(popup.locator('#status')).to_contain_text('Откройте историю')
        expect(popup.locator('#last-sync')).to_be_hidden()
        assert not [call for call in service.calls if call[0]=='POST' and call[1]=='/api/v1/jobs']
