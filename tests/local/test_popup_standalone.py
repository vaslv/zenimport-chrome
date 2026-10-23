"""Built product background and popup with a synthetic SDK, never a live account."""
from contextlib import contextmanager
from pathlib import Path
import json
import os
import shutil
import zipfile
from playwright.sync_api import sync_playwright,expect

SDK_STUB='''()=>{
 const actual=globalThis.fetch;globalThis.syntheticSdkCalls=[];
 globalThis.fetch=async(url,options)=>{
  if(!String(url).startsWith('https://api.zenmoney.ru/'))return actual(url,options);
  const data=JSON.parse(options.body);if(data.transaction||data.deletion)throw Error('synthetic_financial_write_forbidden');
  globalThis.syntheticSdkCalls.push({method:options.method,transaction:false,deletion:false});
  if(globalThis.syntheticFailReadAt===globalThis.syntheticSdkCalls.length)throw Error('synthetic-network-failure');
  if(options.headers.Authorization==='Bearer synthetic-invalid')return Response.json({error:'invalid_token'},{status:401});
  return Response.json({serverTimestamp:Math.floor(Date.now()/1000),user:[{id:1}],instrument:[{id:2,shortTitle:'VND'}],
   account:[{id:'10000000-0000-4000-8000-000000000001',title:'Synthetic VND',type:'checking',user:1,instrument:2}],tag:[],transaction:[]});
 };
}'''


@contextmanager
def product(p,tmp_path,with_bank=False,sdk_url=None):
    extension=tmp_path/'extension';shutil.copytree('/app/dist/extension',extension)
    manifest=json.loads((extension/'manifest.json').read_text())
    manifest['host_permissions']=['https://api.zenmoney.ru/*']+(['https://ipay.vietinbank.vn/*'] if with_bank else [])+(['http://127.0.0.1/*'] if sdk_url else [])
    (extension/'manifest.json').write_text(json.dumps(manifest))
    options={'executable_path':os.environ['CHROME_EXECUTABLE']} if os.getenv('CHROME_EXECUTABLE') else {'channel':'chromium'}
    browser=p.chromium.launch_persistent_context(str(tmp_path/'profile'),headless=False,ignore_default_args=['--disable-extensions'],
        args=[f'--disable-extensions-except={extension}',f'--load-extension={extension}','--no-sandbox','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run'],**options)
    try:
        worker=browser.service_workers[0] if browser.service_workers else browser.wait_for_event('serviceworker')
        if sdk_url:
            worker.evaluate('url=>{const actual=globalThis.fetch;globalThis.fetch=(target,options)=>actual(String(target).startsWith("https://api.zenmoney.ru/")?url:target,options);}',sdk_url)
        else:worker.evaluate(SDK_STUB)
        identifier=worker.url.split('/')[2]
        bank=None
        if with_bank:
            browser.route('https://ipay.vietinbank.vn/**',lambda route:route.fulfill(content_type='text/html',body=Path('/app/tests/browser/bank.html').read_text()))
            bank=browser.new_page();bank.goto('https://ipay.vietinbank.vn/payment-history?accountNo=12345678')
        page=browser.new_page();page.goto(f'chrome-extension://{identifier}/popup.html')
        if bank:bank.bring_to_front()
        yield browser,worker,page,identifier
    finally:browser.close()


def test_product_fresh_local_setup_drafts_invalid_token_and_removal(tmp_path):
    with sync_playwright() as p,product(p,tmp_path) as (browser,worker,page,identifier):
        errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        assert worker.evaluate("chrome.runtime.getManifest().incognito")=="not_allowed"
        expect(page.locator('#local-settings')).to_have_attribute('open','')
        expect(page.locator('#storage-mode')).to_have_text('Browser database')
        expect(page.locator('#connection-settings')).not_to_have_attribute('open','')
        expect(page.locator('#migration-settings')).not_to_have_attribute('open','')
        expect(page.locator('#sync')).to_be_disabled()
        expect(page.locator('#status')).to_contain_text('Enter and verify your ZenMoney token')
        page.locator('#local-token').fill('synthetic-draft')
        page.wait_for_function('''async()=>!!(await chrome.storage.session.get('localZenMoneyDraft')).localZenMoneyDraft''')
        page.close();page=browser.new_page();page.goto(f'chrome-extension://{identifier}/popup.html')
        expect(page.locator('#local-token')).to_have_value('synthetic-draft')
        page.locator('#local-token').fill('synthetic-invalid');page.locator('#local-connect').click()
        expect(page.locator('#status')).to_have_text('Check the ZenMoney token.')
        assert worker.evaluate("async()=>{const r=indexedDB.open('zenimport-financial');return new Promise(resolve=>r.onsuccess=()=>{const db=r.result,tx=db.transaction('runtime'),q=tx.objectStore('runtime').get('runtime');q.onsuccess=()=>{resolve(q.result.credentialRef);db.close();};});}") is None
        page.locator('#local-token').fill('synthetic-verified');page.locator('#local-connect').click()
        expect(page.locator('#local-settings')).not_to_have_attribute('open','',timeout=15000)
        expect(page.locator('#local-settings > summary')).to_be_focused()
        page.keyboard.press('Enter');expect(page.locator('#local-owner')).to_contain_text('Verified ZenMoney owner: 1')
        assert page.locator('#local-token').input_value()==''
        page.set_viewport_size({'width':390,'height':700});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        if Path('/results').is_dir():page.screenshot(path='/results/local-setup.png',full_page=True)
        assert page.locator('input:not([type=hidden]),select').evaluate_all('(items)=>items.every(e=>e.hidden || e.labels.length || e.hasAttribute("aria-label"))')
        page.locator('#local-remove').click();expect(page.locator('#local-settings')).to_have_attribute('open','')
        expect(page.locator('#local-remove')).to_be_hidden();expect(page.locator('#sync')).to_be_disabled()
        assert not errors
        assert len(worker.evaluate('syntheticSdkCalls'))==3


def test_product_exports_verified_zip_and_requires_a_separate_download_confirmation(tmp_path):
    with sync_playwright() as p,product(p,tmp_path) as (_,worker,page,_):
        page.locator('#local-token').fill('synthetic-verified');page.locator('#local-connect').click()
        expect(page.locator('#local-settings')).not_to_have_attribute('open','',timeout=15000)
        page.locator('#migration-settings > summary').click();expect(page.locator('#export-data')).to_be_enabled()
        page.locator('#export-data').click()
        expect(page.locator('#migration-status')).to_have_text('Preparing a consistent backup. Progress is saved if this window closes.')
        worker.evaluate('()=>chrome.alarms.create("zenimport-storage-control",{when:Date.now()+200,periodInMinutes:.5})')
        try:expect(page.locator('#archive-download')).to_be_visible(timeout=15000)
        except AssertionError:
            print('Migration UI:',page.locator('#migration-status').inner_text())
            print('Product state:',page.evaluate('()=>chrome.runtime.sendMessage({type:"status",operation_id:crypto.randomUUID()})'))
            raise
        expect(page.locator('#ack-download')).to_be_disabled()
        with page.expect_download() as info:page.locator('#download-data').click()
        download=info.value;path=tmp_path/'backup.zip';download.save_as(path)
        with zipfile.ZipFile(path) as archive:
            assert 'manifest.json' in archive.namelist()
            assert b'synthetic-verified' not in b''.join(archive.read(name) for name in archive.namelist())
        expect(page.locator('#ack-download')).to_be_enabled()
        page.locator('#ack-download').click();expect(page.locator('#migration-status')).to_contain_text('Backup confirmed')
        page.reload();expect(page.locator('#archive-ready')).to_contain_text('saved')
        expect(page.locator('#ack-download')).to_be_disabled()
        assert len(worker.evaluate('syntheticSdkCalls'))==2


def test_committed_local_token_recovers_after_first_catalog_failure_without_reopening(tmp_path):
    with sync_playwright() as p,product(p,tmp_path,with_bank=True) as (_,worker,page,_):
        worker.evaluate('()=>{globalThis.syntheticFailReadAt=2;}')
        page.locator('#local-token').fill('synthetic-verified');page.locator('#local-connect').click()
        expect(page.locator('#local-owner')).to_contain_text('Verified ZenMoney owner: 1',timeout=15000)
        expect(page.locator('#account-settings')).to_be_visible(timeout=15000)
        # A failed mirror read deliberately persists a ten-second retry deadline.
        # Setup must remain committed and expose a usable retry in this same popup.
        expect(page.locator('#refresh-accounts')).to_be_enabled()
        page.wait_for_timeout(11000)
        page.locator('#account-settings > summary').evaluate('(e)=>e.parentElement.open=true')
        page.locator('#refresh-accounts').click()
        expect(page.locator('.account select')).to_contain_text('Synthetic VND',timeout=15000)
        assert len(worker.evaluate('syntheticSdkCalls'))>=3
        assert page.locator('#local-token').input_value()==''


def test_product_migration_error_survives_successful_unchanged_status_polling(tmp_path):
    with sync_playwright() as p,product(p,tmp_path) as (_,worker,page,_):
        page.locator('#local-token').fill('synthetic-verified');page.locator('#local-connect').click()
        expect(page.locator('#local-settings')).not_to_have_attribute('open','',timeout=15000)
        page.locator('#migration-settings > summary').click()
        page.locator('#retired-writers').check();page.locator('#snapshot-loss').check()
        page.evaluate("""()=>{globalThis.completedStatusPolls=0;const actual=chrome.runtime.sendMessage.bind(chrome.runtime);
          chrome.runtime.sendMessage=async(...args)=>{const result=await actual(...args);
            if(args[0].type==='status')completedStatusPolls++;return result;};}""")
        page.locator('#migration-file').set_input_files({'name':'invalid.zip','mimeType':'application/zip','buffer':b'not a zip'})
        expect(page.locator('#migration-status')).to_have_attribute('data-tone','error')
        message=page.locator('#migration-status').inner_text()
        assert message
        before=page.evaluate('completedStatusPolls')
        page.wait_for_function('before=>completedStatusPolls>=before+2',arg=before)
        expect(page.locator('#migration-status')).to_have_text(message)
        expect(page.locator('#migration-status')).to_have_attribute('data-tone','error')
