"""Automatic profile/account identities in the installed private local owner."""
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_mirror import call,ready


def discovery(profile='owner-1',keys=('primary',),complete=True,**changes):
    return dict(bank='bidv',connector_version='1',profile_key=profile,profile_identity='bank',
        capabilities=dict(timezone='Asia/Ho_Chi_Minh',currencies=['VND'],max_window_days=30,earliest_date=None,details='included'),
        accounts_complete=complete,accounts=[dict(source_key=key,identity_scope='bank',label=key,masked_number='••1234',currency='VND',scale=0,supported=True,unsupported_reason=None) for key in keys],label=profile)|changes


def test_native_profiles_share_only_canonical_bank_accounts_and_keep_names(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        ready(worker)
        first=call(worker,'connections-discover',data=discovery());assert first['ok'],first
        a=first['result'];assert a['label']=='owner-1' and a['accounts'][0]['settings_version']=='0'
        second=call(worker,'connections-discover',data=discovery('owner-2',('primary','secondary')));assert second['ok'],second
        b=second['result'];assert a['id']!=b['id'] and a['accounts'][0]['id']==next(row['id'] for row in b['accounts'] if row['source_key']=='primary')
        changed=call(worker,'connections-rename',id=a['id'],label='  Personal BIDV  ');assert changed['result']['label']=='Personal BIDV'
        repeat=call(worker,'connections-discover',data=discovery(label=None));assert repeat['result']['id']==a['id'] and repeat['result']['label']=='Personal BIDV'
        assert len(call(worker,'connections-list')['result']['connections'])==2
        # Profile-scoped account identity must not leak between bank logins.
        value=discovery('owner-3');value['accounts'][0]['identity_scope']='profile'
        scoped=call(worker,'connections-discover',data=value);assert scoped['ok'],scoped
        value['profile_key']='owner-4';another=call(worker,'connections-discover',data=value)
        assert scoped['result']['accounts'][0]['id']!=another['result']['accounts'][0]['id']


def test_native_partial_discovery_complete_absence_and_unlink_are_connection_scoped(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        ready(worker)
        initial=call(worker,'connections-discover',data=discovery(keys=('a','b')))['result']
        partial=call(worker,'connections-discover',data=discovery(keys=('a',),complete=False));assert len(partial['result']['accounts'])==2
        other=call(worker,'connections-discover',data=discovery('other',('b',)))['result']
        complete=call(worker,'connections-discover',data=discovery(keys=('a',)));assert len(complete['result']['accounts'])==1
        assert call(worker,'connections-get',id=other['id'])['result']['accounts'][0]['supported']
        unlinked=call(worker,'connections-unlink',id=other['id'],accountId=other['accounts'][0]['id']);assert unlinked['ok'],unlinked
        assert not unlinked['result']['accounts']
        restored=call(worker,'connections-discover',data=discovery('other',('b',)))['result']
        assert restored['accounts'][0]['id']==other['accounts'][0]['id']
        assert {row['id'] for row in initial['accounts']}=={complete['result']['accounts'][0]['id'],restored['accounts'][0]['id']}


def test_native_discovery_validation_and_failed_write_leave_catalog_unchanged(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        ready(worker);initial=call(worker,'connections-discover',data=discovery())['result']
        bad=discovery(profile_identity='user_selected');reply=call(worker,'connections-discover',data=bad)
        assert reply['code']=='settings_conflict',reply
        bad=discovery();bad['accounts'].append(dict(bad['accounts'][0]))
        assert call(worker,'connections-discover',data=bad)['code']=='validation_error'
        bad=discovery();bad['accounts'][0]['scale']=2
        assert call(worker,'connections-discover',data=bad)['code']=='unsupported_currency'
        bad=discovery();bad['accounts'][0]['password']='must-not-persist'
        assert call(worker,'connections-discover',data=bad)['code']=='validation_error'
        assert call(worker,'connections-get',id=initial['id'])['result']==initial
        viet=call(worker,'connections-discover',data=discovery(bank='vietinbank'))['result']
        bad=discovery(bank='vietinbank',keys=('new','primary'),label='must roll back')
        bad['accounts'][1].update(scale=2,supported=False,unsupported_reason='fixture')
        assert call(worker,'connections-discover',data=bad)['code']=='unsupported_currency'
        assert call(worker,'connections-get',id=viet['id'])['result']==viet
