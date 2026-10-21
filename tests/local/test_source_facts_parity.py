"""Raw API tokens use the same actual Python decoding, without rounded adapters."""
import pytest
pytest.importorskip('backend')
from decimal import Decimal
from playwright.sync_api import sync_playwright
from backend import storage,predictions
from mirror_factory import Fixture,snapshot,movement
from zenmoney_api.protocol import encode_json
from test_prediction_parity import reviewed,tagged
from test_runtime import installed
from test_mirror import call


def test_actual_python_raw_mirror_and_native_domain_boundary_match(tmp_path):
    reference=Fixture(tmp_path/'reference.sqlite3')
    data=snapshot(transaction=[movement('exact',amount=Decimal('123456789012345678901234.123456789012')),
        movement('quantum',amount=Decimal('100.0000000000000')),movement('tiny',amount=Decimal('1E-90')),
        movement('fx',incomeAccount='other',income=Decimal('1.00000000000000000001'),incomeInstrument=3,outcome=27000)],
        tag=[dict(id='nullable',title='Category',showIncome=None,showOutcome=Decimal('0.0'))])
    try:
        raw=encode_json(data);reference.refresh(raw)
        with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
            assert call(worker,'init')['ok'];assert call(worker,'verify',raw=raw.decode())['ok']
            assert call(worker,'refresh',raw=raw.decode(),now=reference.now)['ok']
            result=call(worker,'source-facts',now=reference.now);assert result['ok'],result
            with storage.transaction(reference.path,read_only=True) as db:
                expected=[(k,reviewed(v)) for k,v in predictions.entities(db,'transaction').items()]
                assert sorted(result['result']['reviewed'])==sorted([list(row) for row in expected])
                assert sorted(result['result']['tags'])==sorted([[k,tagged(v)] for k,v in predictions.entities(db,'tag').items()])
    finally:reference.close()
