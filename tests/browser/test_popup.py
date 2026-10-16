from pathlib import Path
import pytest
from playwright.sync_api import sync_playwright, expect
from support import PopupBackend, http_server, installed, connect, TOKEN


def test_popup_setup_keyboard_dates_and_no_bank_ui():
    service=PopupBackend()
    with http_server(service) as url, sync_playwright() as p, installed(p,url) as (context,worker,bank,popup,identifier):
        errors=[];popup.on('pageerror',lambda error:errors.append(str(error)))
        expect(popup.locator('#settings')).to_have_attribute('open','')
        expect(popup.locator('#sync')).to_be_disabled()
        connect(popup,bank,url)
        expect(popup.locator('.account')).to_have_count(1)
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
        popup.set_viewport_size({'width':390,'height':700})
        if Path('/results').is_dir():popup.screenshot(path='/results/popup-settings.png',full_page=True)
        assert popup.evaluate('document.documentElement.scrollWidth<=innerWidth')
        popup.locator('#settings summary').focus();popup.keyboard.press('Space')
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
