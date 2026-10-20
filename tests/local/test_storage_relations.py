"""Read-only relational proof of an inactive actual-Python financial fixture."""
from copy import deepcopy
import json
from pathlib import Path
import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_storage import call

FIXTURE=json.loads(Path('/app/contracts/business/v1/portable-financial-v2.json').read_text())
SCHEMA=json.loads(Path('/app/contracts/business/v1/sqlite-v7.json').read_text())
POLICY=json.loads(Path('/app/contracts/business/v1/portable-policy.json').read_text())


def column(table,name):
    return [part['name'] for part in SCHEMA['tables'][POLICY['logical_tables'][table]['source']]['columns']].index(name)


def test_native_stage_relations_recheck_exact_stored_bytes_without_activating(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,_,page,_):
        original=call(page,'open')['value'];fence=original['context']
        stage=call(page,'stage',fence=fence,golden=FIXTURE);assert stage['ok'],stage
        assert stage['value']['datasetDigest']==FIXTURE['expected_digest']
        result=call(page,'relations',fence=fence,stageId=stage['value']['id']);assert result['ok'],result
        assert result['value']=={table:str(len(rows)) for table,rows in FIXTURE['rows'].items()}
        assert call(page,'open')['value']['state']['rows']==original['state']['rows']
        assert call(page,'stages')['value'][0]['state']=='format_valid'


@pytest.mark.parametrize('problem',['foreign_key','insert_proof'])
def test_native_format_valid_stage_is_not_a_relationally_valid_graph(tmp_path,problem):
    fixture=deepcopy(FIXTURE)
    if problem=='foreign_key':
        fixture['rows']['bank_transactions'][0][column('bank_transactions','account_id')]=['text','missing']
    else:
        index=column('capture_intervals','settings_version')
        fixture['rows']['capture_intervals'][0][index]=['integer','9007199254740993']
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,_,page,_):
        original=call(page,'open')['value'];fence=original['context']
        stage=call(page,'stage',fence=fence,golden=fixture);assert stage['ok'],stage
        result=call(page,'relations',fence=fence,stageId=stage['value']['id'])
        assert result==dict(ok=False,code='invalid_relationship' if problem=='foreign_key' else 'invalid_insert_proof')
        assert call(page,'open')['value']['state']['rows']==original['state']['rows']
        assert call(page,'stages')['value'][0]['state']=='format_valid'


def test_native_relational_reader_obeys_epoch_and_stage_ownership(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,_,page,_):
        original=call(page,'open')['value'];fence=original['context']
        stage=call(page,'stage',fence=fence,golden=FIXTURE)['value']
        assert call(page,'relations',fence=fence|{'epoch':'2'},stageId=stage['id'])==dict(ok=False,code='stale_epoch')
        assert call(page,'relations',fence=fence,stageId=fence['generation'])==dict(ok=False,code='storage_corrupt')
        assert call(page,'open')['value']['state']['rows']==original['state']['rows']


def test_native_relational_reader_does_not_trust_tampered_derived_indexes(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,_,page,_):
        original=call(page,'open')['value'];fence=original['context']
        stage=call(page,'stage',fence=fence,golden=FIXTURE)['value']
        assert call(page,'relations',fence=fence,stageId=stage['id'],mode='poison-index')==dict(ok=False,code='storage_corrupt')
        assert call(page,'open')['value']['state']['rows']==original['state']['rows']


@pytest.mark.parametrize('name',['portable-financial-v2','portable-legacy-v2'])
def test_native_classified_audit_preserves_original_legacy_fingerprint_without_activation(tmp_path,name):
    fixture=json.loads(Path('/app/contracts/business/v1',name+'.json').read_text())
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,_,page,_):
        original=call(page,'open')['value'];fence=original['context']
        stage=call(page,'stage',fence=fence,golden=fixture);assert stage['ok'],stage
        assert call(page,'audit',fence=fence,stageId=stage['value']['id'])==dict(ok=True,value=True)
        assert call(page,'open')['value']['state']['rows']==original['state']['rows']
        assert call(page,'stages')['value'][0]['state']=='format_valid'


def test_native_rehashed_archive_cannot_rewrite_legacy_audit_bytes(tmp_path):
    fixture=json.loads(Path('/app/contracts/business/v1/portable-legacy-v2.json').read_text())
    fixture['rows']['legacy_rows'][0][column('legacy_rows','values_json')][1]+=' '
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,_,page,_):
        original=call(page,'open')['value'];fence=original['context']
        stage=call(page,'stage',fence=fence,golden=fixture);assert stage['ok'],stage
        assert call(page,'audit',fence=fence,stageId=stage['value']['id'])==dict(ok=False,code='invalid_legacy_audit')
        assert call(page,'open')['value']['state']['rows']==original['state']['rows']


@pytest.mark.parametrize('name',['portable-financial-v2','portable-legacy-v2'])
def test_native_attempt_history_remains_inactive_after_complete_read_only_proof(tmp_path,name):
    fixture=json.loads(Path('/app/contracts/business/v1',name+'.json').read_text())
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,_,page,_):
        original=call(page,'open')['value'];fence=original['context']
        stage=call(page,'stage',fence=fence,golden=fixture)['value']
        assert call(page,'history',fence=fence,stageId=stage['id'])==dict(ok=True,value=True)
        assert call(page,'open')['value']['state']['rows']==original['state']['rows']
        assert call(page,'stages')['value'][0]['state']=='format_valid'


@pytest.mark.parametrize('problem,code',[('missing_attempt','missing_attempt_evidence'),('different_payload','missing_attempt_evidence'),('terminal','terminal_history_conflict')])
def test_native_rehashed_archive_cannot_change_permanent_send_history(tmp_path,problem,code):
    fixture=deepcopy(FIXTURE)
    if problem=='missing_attempt':fixture['rows']['delivery_attempts']=[]
    if problem=='different_payload':
        index=column('delivery_attempts','payload')
        for row in fixture['rows']['delivery_attempts']:row[index][1]+=' '
    if problem=='terminal':fixture['rows']['bank_processing'][0][column('bank_processing','state')]=['text','pending']
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,_,page,_):
        original=call(page,'open')['value'];fence=original['context']
        stage=call(page,'stage',fence=fence,golden=fixture);assert stage['ok'],stage
        assert call(page,'history',fence=fence,stageId=stage['value']['id'])==dict(ok=False,code=code)
        assert call(page,'open')['value']['state']['rows']==original['state']['rows']
