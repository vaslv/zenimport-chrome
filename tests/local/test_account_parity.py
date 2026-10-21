"""Named account operations against real SQLite and real browser storage."""
import json
import pytest
pytest.importorskip('backend')
from playwright.sync_api import sync_playwright
from backend import storage,accounts
from backend.sync_contracts import DiscoverConnection,AccountSettings
from mirror_factory import Fixture
from test_runtime import installed
from test_mirror import call,full
from test_connections import discovery


def normalized(value):
    if 'accounts' in value:
        return dict(value,id='connection:'+value['profile_key'],accounts=sorted([normalized(row) for row in value['accounts']],key=lambda row:row['source_key']))
    return dict(value,id='account:'+value['source_key']+':'+value['currency'],settings_version=str(value['settings_version']))


def test_actual_python_and_browser_account_discovery_settings_and_bindings_match(tmp_path):
    reference=Fixture(tmp_path/'reference.sqlite3')
    with storage.transaction(reference.path) as db:
        db.execute('DELETE FROM account_bindings');db.execute('DELETE FROM bank_accounts')
    reference.refresh(json.loads(full()))
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        now=reference.now
        for action in ('init','verify','refresh'):
            result=call(worker,action,now=now,raw=full());assert result['ok'],result
        data=discovery(keys=('primary','secondary'))
        with storage.transaction(reference.path) as db:left=accounts.discover(db,DiscoverConnection.model_validate(data),now)
        right=call(worker,'connections-discover',data=data,now=now)['result']
        assert normalized(left)==normalized(right)
        left_id=next(row['id'] for row in left['accounts'] if row['source_key']=='primary')
        right_id=next(row['id'] for row in right['accounts'] if row['source_key']=='primary')
        for version,selection,target,start in [(0,'enabled','a','2026-10-01'),(0,'enabled','a','2026-10-01'),(1,'ignored',None,None),(2,'enabled','a','2026-10-01')]:
            data=dict(expected_version=version,selection=selection,zenmoney_account_id=target,import_start=start)
            with storage.transaction(reference.path) as db:expected=accounts.settings(db,left_id,AccountSettings.model_validate(data),now)
            actual=call(worker,'accounts-configure',id=right_id,data=data,now=now);assert actual['ok'],actual
            assert normalized(expected)==normalized(actual['result'])
        with storage.transaction(reference.path) as db:expected=accounts.rename_connection(db,left['id'],type('Label',(),{'label':'Renamed'})(),now)
        actual=call(worker,'connections-rename',id=right['id'],label='Renamed',now=now)
        assert normalized(expected)==normalized(actual['result'])
        with storage.transaction(reference.path) as db:expected=accounts.unlink_account(db,left['id'],left_id,now)
        actual=call(worker,'connections-unlink',id=right['id'],accountId=right_id,now=now)
        assert normalized(expected)==normalized(actual['result'])
    reference.close()
