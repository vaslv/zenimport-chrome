"""Exact raw/projection parity against Python, using one shared native sequence."""
import json
from decimal import Decimal
import pytest
pytest.importorskip('backend')
from playwright.sync_api import sync_playwright
from backend import storage
from mirror_factory import Fixture,snapshot,movement
from zenmoney_api.protocol import encode_json,decode_json
from test_runtime import installed
from test_mirror import call

TABLES=('zen_entities','zen_movements','zen_tags','zen_tombstones','zen_deletions','zen_sync_runs')


def normalize(table,row):
    row=dict(row)
    # UUID generators are implementation-specific here; raw financial IDs and
    # all amounts/cursor values remain untouched. Link existence is checked in
    # each implementation by its storage owner, not normalized into equivalence.
    if table in ('zen_entities','zen_deletions'):row.pop('run_id')
    if table in ('zen_deletions','zen_sync_runs'):row.pop('id')
    for key in ('changed','deleted','position','received_at','requested_cursor','response_cursor','viewed','hold'):
        if key in row and row[key] is not None:row[key]=str(row[key])
    for key in ('data',):
        if key in row:row[key]=decode_json(row[key].encode())
    return row


def test_native_mirror_matches_python_full_partial_delete_and_raw_decimal_projection(tmp_path):
    reference=Fixture(tmp_path/'reference.sqlite3')
    original=snapshot(transaction=[movement('expense',amount=Decimal('123456789012345678901234.123456789012')),
        movement('fx',incomeAccount='other',incomeInstrument=3,income=Decimal('1.00000000000000000001'),outcome=27000),
        movement('soft',deleted=True)],reminder=[dict(id='reminder',startDate='2026-10-01',income=0,outcome=Decimal('3.00'),tag=['x'],viewed=True,hold=False)])
    original['futureCollection']=[dict(unknown=Decimal('1E-90'))]
    sequence=[original,dict(serverTimestamp=101,account=[dict(id='zen-vnd',instrument=2,type='checking',title='Mobile change')]),
        dict(serverTimestamp=102,deletion=[dict(object='transaction',id='fx',stamp=102,unknown=Decimal('1E-90'))]),
        snapshot(cursor=103,transaction=[])]
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        assert call(worker,'init')['ok']
        assert call(worker,'verify',raw=encode_json(original).decode())['ok']
        for index,data in enumerate(sequence):
            raw=encode_json(data)
            # Last response is full: same-owner token rotation requires the same
            # full reset in the Python reference before applying this snapshot.
            if index==3:
                assert call(worker,'verify',token='rotated',raw=raw.decode())['ok']
                # Python's forceFetch is driven by needs_full, not force=True.
                with storage.transaction(reference.path) as db:db.execute('UPDATE zen_mirror_state SET needs_full=1')
            reference.refresh(raw)
            result=call(worker,'refresh',raw=raw.decode(),now=reference.now);assert result['ok'],result
            with storage.transaction(reference.path,read_only=True) as db:
                for table in TABLES:
                    left=[normalize(table,row) for row in result['tables'][table]]
                    right=[normalize(table,row) for row in db.execute('SELECT * FROM '+table)]
                    assert sorted(left,key=repr)==sorted(right,key=repr),(index,table)
                assert result['tables']['zen_mirror_state'][0]['cursor']==str(data['serverTimestamp'])
    reference.close()
