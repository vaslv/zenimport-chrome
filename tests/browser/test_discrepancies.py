from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from playwright.sync_api import sync_playwright, expect
from support import PopupBackend, http_server, installed, connect, TOKEN


class ReportBackend(PopupBackend):
    fail=False
    def request(self,method,path,body):
        if '/discrepancies?' not in path:return super().request(method,path,body)
        self.calls.append((method,path,body))
        if self.fail:raise AssertionError('offline fixture')
        account=next(iter(self.accounts.values()))
        return {'bank':'vietinbank','connection_id':self.connection_id,'from_date':'2026-10-01','to_date':'2026-10-16',
            'refreshed_at':'2026-10-16T05:00:00Z',
            'accounts':[{'id':account['id'],'title':'Fixture VietinBank','currency':'VND','zenmoney_title':'Fixture VND',
                'status':'ready','checked_days':15,'unchecked_days':1}],
            'days':[{'date':'2026-10-15','account_id':account['id'],'bank_total':'-100','zenmoney_total':'-200','difference':'-100',
                'bank_operations':[{'id':'missing','amount':'-75','payee':'','comment':'Bank-only fixture','categories':[],'created':None}],
                'operations':[{'id':'extra','amount':'-100','payee':'<img src=x onerror="window.pwned=1">',
                    'comment':'Additional transaction','categories':['Groceries'],'created':1792040000}]}]}


def test_popup_opens_read_only_bank_scoped_report_and_safe_responsive_page():
    service=ReportBackend()
    with http_server(service) as url, sync_playwright() as p, installed(p,url) as (context,worker,bank,popup,_):
        connect(popup,bank,url)
        expect(popup.locator('.account')).to_have_count(1)
        popup.locator('.account select').select_option('target-vnd')
        popup.get_by_role('button',name='Save account',exact=True).click()
        expect(popup.locator('#discrepancies')).to_be_enabled()
        with context.expect_page() as opened:popup.locator('#discrepancies').click()
        page=opened.value
        expect(page.locator('#summary')).to_contain_text('Bank: 1 · ZenMoney: 1')
        from urllib.parse import parse_qs
        query=parse_qs(urlsplit(page.url).query)
        assert query['connection']==[service.connection_id]
        assert query['context']==[service.dataset_id]
        expect(page.locator('.day-title')).to_contain_text('15 October 2026')
        expect(page.locator('.operation')).to_have_count(2)
        expect(page.locator('[data-source=bank]')).to_contain_text('Bank-only fixture')
        expect(page.locator('[data-source=zenmoney]')).to_contain_text('Additional transaction')
        expect(page.locator('.totals')).to_contain_text('Difference: −100 VND')
        expect(page.locator('.coverage')).to_contain_text('Days without complete bank history: 1')
        assert page.locator('img').count()==0 and page.evaluate('window.pwned') is None
        assert TOKEN not in page.content()
        assert page.locator('button').count()==1 # Refresh only; no financial editing.
        denied=page.evaluate("async()=>chrome.runtime.sendMessage({type:'start'})")
        assert denied=={'ok':False,'error':'unauthorized'}
        assert not [call for call in service.calls if call[0]=='POST' and call[1]=='/api/v1/jobs']
        assert not bank.locator('[id*=zenimport], [class*=zenimport]').count()
        page.set_viewport_size({'width':1100,'height':750})
        if Path('/results').is_dir():page.screenshot(path='/results/discrepancies-desktop.png',full_page=True)
        page.set_viewport_size({'width':390,'height':800})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        if Path('/results').is_dir():page.screenshot(path='/results/discrepancies-mobile.png',full_page=True)
        page.locator('#from').fill('2026-10-02');page.locator('#account').select_option(next(iter(service.accounts.values()))['id'])
        page.locator('#refresh').click()
        expect(page.locator('#refresh')).to_be_enabled()
        query=parse_qs(urlsplit(service.calls[-1][1]).query)
        assert query['from_date']==['2026-10-02'] and query['refresh']==['true']
        assert query['account_id']==[next(iter(service.accounts.values()))['id']]
        service.fail=True;page.locator('#refresh').click()
        expect(page.locator('#status')).to_have_attribute('data-tone','error')
        expect(page.locator('.operation')).to_have_count(0)
        service.fail=False;page.reload()
        expect(page.locator('.operation')).to_have_count(2)
