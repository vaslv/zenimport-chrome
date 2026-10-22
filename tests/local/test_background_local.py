"""Installed trusted background dispatch with native storage and synthetic SDK only."""
from uuid import uuid4
from playwright.sync_api import sync_playwright
from test_runtime import installed,prepare_extension


def send(page,type,context=None,**fields):
    scope={k:v for k,v in context.items() if k!='operation_id'} if context else None
    return page.evaluate('data=>chrome.runtime.sendMessage(data)',dict(type=type,operation_id=str(uuid4()),**({'context':scope} if scope else {}),**fields))


def test_trusted_background_configures_local_credentials_and_rejects_other_extension_pages(tmp_path):
    prepare_extension(tmp_path/'ext');(tmp_path/'ext'/'popup.html').write_text('<!doctype html><title>Trusted dispatch fixture</title>')
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (browser,worker,page,identifier):
        result=worker.evaluate('()=>applicationProbe.run("install-background",{name:"background-local",mode:"standalone"})');assert result['ok'],result
        assert send(page,'status')==dict(ok=False,error='unauthorized')
        popup=browser.new_page();popup.goto(f'chrome-extension://{identifier}/popup.html')
        state=send(popup,'status');assert state['ok'] and state['storage']['mode']=='local' and not state['configured']
        original=state['context'];before=worker.evaluate('()=>applicationProbe.run("status",{name:"background-local",mode:"standalone"})')['reads']
        assert send(popup,'local-draft',original,token='synthetic-draft')['ok']
        assert send(popup,'local-draft',original)['token']=='synthetic-draft'
        proof=send(popup,'local-configure',original,token='synthetic-verified',proof={'decision':'activate'});assert proof==dict(ok=False,error='validation_error')
        configured=send(popup,'local-configure',original,token='synthetic-verified');assert configured['ok'],configured
        current=configured['context'];assert current['credential_epoch']!=original['credential_epoch'] and current['generation']==original['generation']
        assert send(popup,'local-remove',original)==dict(ok=False,error='stale_context')
        status=send(popup,'status');assert status['configured'] and status['url']=='' and status['storage']['local']['owners']==['1']
        assert 'synthetic-verified' not in str(status) and not status['storage']['local']['ready']
        assert worker.evaluate('()=>chrome.alarms.get("zenimport-local-delivery")') is not None
        assert send(popup,'local-remove',current)['ok']
        assert not send(popup,'status')['configured']
        assert worker.evaluate('()=>chrome.alarms.get("zenimport-local-delivery")') is None
        after=worker.evaluate('()=>applicationProbe.run("status",{name:"background-local",mode:"standalone"})')['reads'];assert after==before+1


def test_background_resumes_a_durable_backup_after_full_chrome_restart_without_acknowledging_it(tmp_path):
    extension,profile=tmp_path/'ext',tmp_path/'profile';id=str(uuid4())
    prepare_extension(extension);(extension/'popup.html').write_text('<!doctype html><title>Trusted dispatch fixture</title>')
    with sync_playwright() as p:
        with installed(p,extension,profile) as (browser,worker,_,identifier):
            assert worker.evaluate('()=>applicationProbe.run("install-background",{name:"background-local",mode:"standalone"})')['ok']
            page=browser.new_page();page.goto(f'chrome-extension://{identifier}/popup.html')
            status=send(page,'status');configured=send(page,'local-configure',status['context'],token='synthetic-verified');assert configured['ok']
            assert send(page,'catalog',configured['context'])['ok']
            started=send(page,'archive-export-begin',configured['context'],kind='local',id=id,generation=configured['context']['generation'])
            assert started['ok'] and started['result']['state']=='building',started
            assert worker.evaluate('()=>chrome.alarms.get("zenimport-storage-control")') is not None
        with installed(p,extension,profile,known_id=identifier) as (browser,worker,_,_):
            assert worker.evaluate('()=>applicationProbe.run("install-background",{name:"background-local",mode:"standalone"})')['ok']
            # Genuine alarm event, not a direct call to the control owner.
            worker.evaluate('()=>chrome.alarms.create("zenimport-storage-control",{when:Date.now()+300,periodInMinutes:.5})')
            page=browser.new_page();page.goto(f'chrome-extension://{identifier}/popup.html')
            page.wait_for_function('''async()=>{
                const state=await chrome.runtime.sendMessage({type:'status',operation_id:crypto.randomUUID()});
                return state.ok && !state.storage.controls.pending && state.storage.archives.backups.some(b=>b.phase==='ready');
            }''')
            result=send(page,'status');backup=next(b for b in result['storage']['archives']['backups'] if b['id']==id)
            assert not backup['acknowledged'] and result['storage']['mode']=='local'
            assert worker.evaluate('()=>chrome.alarms.get("zenimport-storage-control")') is None
