"""Sequential bank logins through the built popup and real fixture backend."""
import pytest
pytest.importorskip('backend')
from pathlib import Path

from playwright.sync_api import sync_playwright, expect
from backend import storage
from support import connect
from test_bidv import ORIGIN, BidvBank, bidv_install
from test_integration import service, account, TARGET, SECOND, start_sync, pump_until, state


def profile_key(popup):
    return popup.evaluate("async()=> (await chrome.storage.local.get('view')).view.connection.profile_key")


def profile_form(popup, name, *, rename=False):
    if not rename:
        # Seed legacy explicit shared access to verify compatibility without UI.
        popup.evaluate("async label=>chrome.runtime.sendMessage({type:'create-bank-connection',label})",name)
        popup.reload()
        expect(popup.locator('#connection-name')).to_have_text(name)
        return
    popup.get_by_role('button',name='Rename connection',exact=True).click()
    popup.locator('#profile-name').fill(name)
    popup.get_by_role('button',name='Save connection name',exact=True).click()
    expect(popup.locator('#status')).to_contain_text('Connection name saved')
    expect(popup.locator('#connection-name')).to_have_text(name)


def finish(popup,worker):
    pump_until(popup,worker,lambda:(state(worker) or {}).get('job',{}).get('delivery_state')=='complete',timeout=35)


def test_two_bidv_logins_keep_accounts_ignored_choices_targets_and_sync_history_separate(tmp_path):
    api=BidvBank()
    with service(tmp_path) as (url,path,remote,_),sync_playwright() as p,bidv_install(p,url,api) as (context,worker,bank,popup,identifier):
        bank.goto(ORIGIN+'/tai-khoan?multi&fixtureLogin=a')
        connect(popup,bank,url);expect(popup.locator('.account')).to_have_count(2)
        profile_form(popup,'Personal',rename=True)
        account(popup,TARGET);account(popup,'ignored','11112222')
        first=profile_key(popup)
        start_sync(popup,bank,worker);finish(popup,worker)
        first_job=state(worker)['job']['id']
        expect(popup.locator('#last-sync')).to_be_visible()
        assert sum(map(len,remote.writes))==4

        # A different bank login has never-before-seen accounts. No automatic
        # discovery write may append them to the Personal connection.
        bank.goto(ORIGIN+'/tai-khoan?multi&fixtureLogin=b');bank.bring_to_front();popup.reload()
        expect(popup.locator('.account')).to_have_count(2)
        expect(popup.locator('#profile-picker')).to_have_count(0)
        expect(popup.locator('#sync')).to_be_disabled();expect(popup.locator('#last-sync')).to_be_hidden()
        with storage.transaction(path,read_only=True) as db:
            assert db.execute('SELECT count(*) FROM bank_accounts').fetchone()[0]==4
        profile_form(popup,'Work',rename=True);second=profile_key(popup)
        assert first!=second
        account(popup,SECOND,'87654321');account(popup,'ignored','99990000')
        start_sync(popup,bank,worker);finish(popup,worker)
        assert state(worker)['job']['id']!=first_job
        assert sum(map(len,remote.writes))==8
        assert {call['account'] for call in api.calls}=={'12345678','87654321'}
        with storage.transaction(path,read_only=True) as db:
            expected_history_keys={url+'|'+row[0] for row in db.execute('SELECT id FROM connections')}
        assert set(worker.evaluate("async()=>Object.keys((await chrome.storage.local.get('syncHistory')).syncHistory)"))==expected_history_keys
        # Selecting the other saved profile while still signed into Work fails
        # without changing either connection's membership or sending anything.
        reply=popup.evaluate("async key=>chrome.runtime.sendMessage({type:'select-bank-connection',profileKey:key})",first)
        assert reply=={'ok':False,'error':'bank_connection_changed'}
        assert profile_key(popup)==second

        bank.goto(ORIGIN+'/tai-khoan?multi&fixtureLogin=a');bank.bring_to_front();popup.reload()
        popup.wait_for_function("async key=>(await chrome.storage.local.get('view')).view.connection.profile_key===key",arg=first)
        expect(popup.locator('.account').filter(has_text='12345678').locator('select')).to_have_value(TARGET)
        expect(popup.locator('.account').filter(has_text='11112222').locator('select')).to_have_value('ignored')
        start_sync(popup,bank,worker);finish(popup,worker)
        assert sum(map(len,remote.writes))==8
        assert not bank.locator('[id*=zenimport], [class*=zenimport]').count()
        popup.set_viewport_size({'width':390,'height':760})
        assert popup.evaluate('document.documentElement.scrollWidth<=innerWidth')
        if Path('/results').is_dir():popup.screenshot(path='/results/popup-bank-connections.png',full_page=True)


def test_shared_physical_account_reuses_delivery_journal_and_unlink_is_local_to_connection(tmp_path):
    api=BidvBank()
    with service(tmp_path) as (url,path,remote,_),sync_playwright() as p,bidv_install(p,url,api) as (_,worker,bank,popup,_):
        connect(popup,bank,url);account(popup,TARGET)
        first=profile_key(popup)
        start_sync(popup,bank,worker);finish(popup,worker)
        deleted=next(iter(remote.transactions));del remote.transactions[deleted]
        remote.deletions.append({'object':'transaction','id':deleted})
        profile_form(popup,'Shared account access')
        second=profile_key(popup)
        expect(popup.locator('.account select')).to_have_value(TARGET)
        start_sync(popup,bank,worker);finish(popup,worker)
        assert sum(map(len,remote.writes))==4 and deleted not in remote.transactions
        with storage.transaction(path,read_only=True) as db:
            assert db.execute('SELECT count(*) FROM bank_accounts').fetchone()[0]==1
            assert db.execute('SELECT count(*) FROM connections').fetchone()[0]==2
        popup.locator('.unlink-account').click()
        expect(popup.locator('#status')).to_contain_text('History and sent transactions were kept')
        # The remaining original membership is detected automatically. Unlinking
        # never resets its mapping, transaction IDs, tombstones or receipts.
        popup.wait_for_function("async key=>(await chrome.storage.local.get('view')).view.connection.profile_key===key",arg=first)
        assert second!=first
        start_sync(popup,bank,worker);finish(popup,worker)
        assert sum(map(len,remote.writes))==4 and deleted not in remote.transactions
