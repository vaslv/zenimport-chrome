"""Actual IDB constraints and transaction boundaries, using synthetic rows only."""
import json
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_storage import call

SCHEMA=json.loads(Path('/app/contracts/business/v1/sqlite-v7.json').read_text())['tables']
ALIASES={'dataset_metadata':'service_meta','source_schema_migrations':'schema_migrations','source_capture_leases':'account_capture_locks'}


def row(table,**changes):
    fields={c['name']:('0' if c['type']=='INTEGER' else '') if c['logical_required'] else None
            for c in SCHEMA[ALIASES.get(table,table)]['columns']}
    assert set(changes)<=fields.keys()
    return fields|changes


def insert(table,**fields):return dict(kind='insert',table=table,fields=row(table,**fields))
def key(*parts):return [['text',part] for part in parts]
def get(table,*parts):return dict(kind='get',table=table,primary=key(*parts))
def remove(table,*parts):return dict(kind='remove',table=table,primary=key(*parts))
def replace(table,fields,*parts):return dict(kind='replace',table=table,primary=key(*parts),fields=fields)


@pytest.fixture
def kernel(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,_,page,_):
        opened=call(page,'open');assert opened['ok'],opened
        def run(*operations,**options):
            return call(page,'kernel',fence=opened['value']['context'],operations=list(operations),**options)
        yield run,page,opened['value']['context']


ACCOUNT=dict(id='a',bank='fixture',identity_scope='bank',source_key='primary',currency='VND',
             scale='0',supported='1',selection='enabled',zenmoney_account_id='z-a',import_start='2026-10-01')
CONNECTION=dict(id='c',bank='fixture',profile_key='owner',profile_identity='bank',connector_version='1',capabilities_json='{}')
BANK=dict(id='b',account_id='a',external_id='bank-1',identity_kind='bank',identity_version='v1',
          local_date='2026-10-20',direction='expense',amount='9007199254740993.000000000001',currency='VND',
          raw_json='{"exact":9007199254740993.000000000001}',revision='1')
JOB=dict(id='j',connection_id='c',request_id='r',request_json='{}',end_date='2026-10-20',capture_state='complete',delivery_state='pending')


def base(run):
    result=run(insert('bank_accounts',**ACCOUNT),insert('connections',**CONNECTION),insert('bank_transactions',**BANK),
               insert('capture_jobs',**JOB),insert('bank_versions',bank_id='b',revision='1',data_json='{}',raw_json=BANK['raw_json']))
    assert result['ok'],result


def proof(run):
    base(run)
    result=run(insert('job_accounts',job_id='j',account_id='a',target_id='z-a',import_start='2026-10-01',authorized_start='2026-10-01'),
        insert('capture_intervals',id='i',job_id='j',account_id='a',start_date='2026-10-01',end_date='2026-10-20',state='complete',total_pages='1',total_records='1'),
        insert('capture_pages',interval_id='i',page_number='1',digest='fixture',records_count='1',payload_json='{}'),
        insert('captured_records',interval_id='i',page_number='1',bank_id='b',revision='1'),
        insert('delivery_authorizations',bank_id='b',revision='1',job_id='j',interval_id='i',target_id='z-a'),
        insert('deliveries',bank_id='b',zen_id='z-transaction',payload='{"outcome":9007199254740993.000000000001}',state='attempting',ever_attempted='1'))
    assert result['ok'],result


def test_native_fk_uniqueness_check_and_caught_error_abort_every_store(kernel):
    run,page,_=kernel;base(run)
    for bad in [insert('bank_transactions',**(BANK|{'id':'other'})),
                insert('bank_transactions',**(BANK|{'id':'other','external_id':'other','account_id':'absent'})),
                insert('bank_transactions',**(BANK|{'id':'other','external_id':'other','amount':'0'}))]:
        bad['catch']=True
        result=run(insert('dataset_metadata',key='must-rollback',value='yes'),bad)
        assert not result['ok'],result
        assert run(get('dataset_metadata','must-rollback'),get('bank_transactions','other'))=={'ok':True,'value':[None,None]}
    assert call(page,'state')['value']['marker']['financialMayHaveStarted']


def test_native_nullable_unique_and_partial_capture_indexes(kernel):
    run,_,_=kernel;base(run)
    # Nullable optional columns do not fabricate uniqueness collisions.
    assert run(insert('bank_accounts',**(ACCOUNT|{'id':'a2','source_key':'second','selection':'ignored','zenmoney_account_id':None})))['ok']
    assert run(insert('capture_jobs',**(JOB|{'id':'j2','request_id':'r2','capture_state':'planned'})))['ok']
    result=run(insert('capture_jobs',**(JOB|{'id':'j3','request_id':'r3','capture_state':'paused'})))
    assert result=={'ok':False,'code':'constraint_violation'},result
    assert run(insert('capture_jobs',**(JOB|{'id':'j4','request_id':'r4','capture_state':'complete'})))['ok']


def test_native_attempted_uuid_payload_authorization_and_terminal_state_are_permanent(kernel):
    run,_,_=kernel;proof(run)
    original=run(get('deliveries','z-transaction'),get('delivery_authorizations','b'))['value']
    delivery,authorization=original
    operations=[remove('delivery_authorizations','b'),replace('delivery_authorizations',authorization|{'source_hash':'changed'},'b'),
        remove('deliveries','z-transaction'),replace('deliveries',delivery|{'payload':'{}'},'z-transaction'),
        replace('deliveries',delivery|{'zen_id':'another'},'z-transaction'),
        replace('bank_transactions',row('bank_transactions',**(BANK|{'external_id':'changed'})),'b')]
    for operation in operations:
        assert run(operation)=={'ok':False,'code':'invariant_violation'},operation
        assert run(get('deliveries','z-transaction'),get('delivery_authorizations','b'))['value']==original
    assert run(insert('bank_processing',bank_id='b',state='delivered',reason='verified'))['ok']
    assert not run(replace('bank_processing',row('bank_processing',bank_id='b',state='pending'),'b'))['ok']
    assert not run(remove('bank_processing','b'))['ok']


def test_native_capture_proof_requires_the_same_job_account_and_revision(kernel):
    run,_,_=kernel;base(run)
    interval=insert('capture_intervals',id='i',job_id='j',account_id='a',start_date='2026-10-01',end_date='2026-10-20',state='complete')
    assert run(interval)=={'ok':False,'code':'invariant_violation'}
    assert run(insert('job_accounts',job_id='j',account_id='a',target_id='z-a'),interval)['ok']
    assert not run(insert('delivery_authorizations',bank_id='b',revision='1',job_id='j',interval_id='i',target_id='wrong'))['ok']
    assert not run(replace('capture_intervals',interval['fields']|{'total_pages':'2'},'i'))['ok']


def test_native_acknowledged_facts_and_attempt_journal_are_append_only(kernel):
    run,_,_=kernel;proof(run)
    assert run(insert('delivery_attempts',id='attempt',bank_id='b',zen_id='z-transaction',outcome='intent',payload='{}'),
        insert('job_context',job_id='j',connector_version='1',timezone='UTC',capabilities_json='{}'),
        insert('job_requests',request_id='request',job_id='j',request_json='{}'),
        insert('processing_receipts',bank_id='b',zen_id='z-transaction'),
        insert('processing_targets',bank_id='b',zen_id='z-transaction',target_id='z-a'),
        insert('zen_tombstones',kind='transaction',entity_id='deleted',data='{}'))['ok']
    cases=[('delivery_attempts',key('attempt')),('job_context',key('j')),('job_requests',key('request')),
        ('processing_receipts',key('b','z-transaction')),('processing_targets',key('b','z-transaction')),
        ('job_accounts',key('j','a')),('capture_pages',[['text','i'],['integer','1']]),
        ('bank_versions',[['text','b'],['integer','1']]),('captured_records',key('i','b'))]
    for table,primary in cases:
        original=run(dict(kind='get',table=table,primary=primary))['value'][0]
        assert run(dict(kind='replace',table=table,primary=primary,fields=original))=={'ok':False,'code':'invariant_violation'}
        assert run(dict(kind='remove',table=table,primary=primary))=={'ok':False,'code':'invariant_violation'}
    assert run(remove('zen_tombstones','transaction','deleted'))=={'ok':False,'code':'invariant_violation'}


def test_native_projection_cascade_restrict_and_generation_isolation(kernel):
    run,_,_=kernel;base(run)
    assert not run(remove('bank_accounts','a'))['ok']
    assert run(insert('zen_entities',kind='transaction',id='zen',data='{}'),
        insert('zen_tags',kind='transaction',entity_id='zen',tag_id='tag',position='0'),
        insert('zen_movements',kind='transaction',id='zen'))['ok']
    assert run(remove('zen_entities','transaction','zen'),get('zen_movements','transaction','zen'),
               get('zen_tags','transaction','zen','tag'))=={'ok':True,'value':[None,None]}
    assert run(mode='foreign-generation',table='bank_accounts')['ok']
    assert not run(insert('account_bindings',id='binding',account_id='a',zenmoney_account_id='z-a'))['ok']


def test_native_transaction_handle_and_routing_epoch_cannot_escape(kernel):
    run,_,_=kernel
    assert run(mode='escape')=={'ok':False,'code':'stale_epoch'}
    assert run(get('dataset_metadata','escaped'))=={'ok':True,'value':[None]}
    assert run(mode='control',patch={'epoch':'2'})['ok']
    assert run(insert('dataset_metadata',key='stale',value='no'))=={'ok':False,'code':'stale_epoch'}


def test_native_upgrade_preserves_exact_payload_and_failure_retains_old_version(kernel):
    run,_,_=kernel;base(run)
    result=run(mode='upgrade',table='bank_transactions');assert result['ok'],result
    value=result['value'];assert value['code'] is None and value['version']==2
    columns=[c['name'] for c in SCHEMA['bank_transactions']['columns']]
    assert value['rows'][0]['row'][columns.index('raw_json')]==['text',BANK['raw_json']]
    assert value['rows'][0]['fk0']
    failed=run(mode='failed-upgrade',table='delivery_schedule');assert failed['ok'],failed
    assert failed['value']['code']=='invalid_row' and failed['value']['version']==1


def test_native_quota_failure_rolls_back_financial_rows_and_control_together(kernel):
    run,page,_=kernel
    assert run(mode='quota-transaction')=={'ok':False,'code':'quota_exceeded'}
    state=call(page,'state')['value']
    assert state['marker']['financialMayHaveStarted'] and not state['runtime']['financialMayHaveStarted']
    assert run(get('dataset_metadata','partial-write'))=={'ok':True,'value':[None]}


def test_native_worker_death_inside_financial_transaction_preserves_no_prefix(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (context,worker,page,_):
        fence=call(page,'open')['value']['context']
        worker.evaluate('fence=>{globalThis.paused=storageProbe.run("kernel",{name:"l4-financial",fence,mode:"pause-transaction"});return true;}',fence)
        for _ in range(100):
            if call(page,'kernel-checkpoint').get('value') is True:break
            page.wait_for_timeout(20)
        assert call(page,'kernel-checkpoint')=={'ok':True,'value':True}
        session=context.new_cdp_session(page)
        target=next(target for target in session.send('Target.getTargets')['targetInfos'] if target['url']==worker.url and target['type']=='service_worker')
        assert session.send('Target.closeTarget',{'targetId':target['targetId']})['success']
        assert call(page,'open')['ok']
        state=call(page,'state')['value']
        assert state['marker']['financialMayHaveStarted'] and not state['runtime']['financialMayHaveStarted']
        assert call(page,'kernel',fence=fence,operations=[get('dataset_metadata','partial-write')])=={'ok':True,'value':[None]}
