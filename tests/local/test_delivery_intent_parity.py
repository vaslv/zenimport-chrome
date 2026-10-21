"""Fresh exact intent payloads against actual Python delivery and both SDK builders."""
import json
from uuid import uuid4
import pytest
pytest.importorskip('backend')
from zenmoney_api.protocol import decode_json
from backend import delivery,storage
from delivery_factory import DeliveryHarness
from playwright.sync_api import sync_playwright
from test_runtime import installed

TABLES=('bank_accounts','bank_transactions','bank_versions','bank_processing','bank_exclusions','zen_exclusions','processing_receipts','processing_targets','deliveries','delivery_attempts','delivery_authorizations','link_groups','link_bank_members','link_zen_members','account_bindings','category_choices','recipient_rules','zen_entities','zen_tombstones','zen_mirror_state','capture_jobs','job_accounts','capture_intervals','captured_records')


def source_rows(db):
    result={}
    for table in TABLES:
        integers={r[1] for r in db.execute('PRAGMA table_info('+table+')') if r[2].upper()=='INTEGER'}
        result[table]=[{k:str(v) if k in integers and v is not None else v for k,v in dict(row).items()} for row in db.execute('SELECT * FROM '+table)]
    return dict(rows=result,stamp=dict(credentialRef='fixture',mirrorControl=json.dumps(dict(lease=None,forceFull=False,error=None,failures='0',nextAt='0',projectionGeneration=None))))


@pytest.mark.parametrize('case',['expense','income','exact','microseconds','manual','prepared','older_revision','twenty','invalid_user','string_instrument','disabled','source_changed','numeric_account_id','large_user','retained_uuid'])
def test_actual_python_and_browser_create_only_intent_payloads_match(tmp_path,case):
    h=DeliveryHarness(tmp_path/'reference.sqlite3')
    try:
        changes=dict(direction='income' if case=='income' else 'expense')
        if case=='exact':changes['amount']='123456789012345678901234.123456789012'
        if case=='microseconds':changes['occurred_at']='2026-09-15T12:00:00.999999+07:00'
        if case=='exact':
            # Source account scale must support this valid bank record.
            with storage.transaction(h.path) as db:db.execute('UPDATE bank_accounts SET scale=12 WHERE id=?',(h.account_id,))
        if case=='numeric_account_id':
            h.remote.data['account'][0]['id']=123;h.app.state.mirror.refresh(force=True)
            configured=h.configure(h.account_id,version=1,target='123');assert configured.status_code==200,configured.text
        job,*_=h.capture(count=21 if case=='twenty' else 2 if case=='retained_uuid' else 1,changes=changes)
        if case=='older_revision':
            assert h.client.post('/api/v1/jobs/'+job['id']+'/stop',json={}).status_code==200
            h.capture(complete=False,changes={'amount':'200'})
        bank=next(iter(h.bank_ids().values()))
        with storage.transaction(h.path) as db:
            if case=='large_user':
                row=db.execute("SELECT data FROM zen_entities WHERE kind='account' AND id=?",(h.remote.data['account'][0]['id'],)).fetchone();data=json.loads(row[0]);data['user']=9007199254740993
                db.execute("UPDATE zen_entities SET data=? WHERE kind='account' AND id=?",(json.dumps(data),data['id']))
            if case=='retained_uuid':
                historical=str(uuid4());db.execute('INSERT INTO processing_receipts VALUES (?,?,?,?)',(bank,historical,'fixture',h.now));db.execute("UPDATE bank_processing SET state='delivered' WHERE bank_id=?",(bank,))
            if case=='manual':db.execute('INSERT INTO category_choices VALUES (?,?,?,?)',(bank,'category-a','manual',h.now))
            if case=='prepared':
                identifier=str(uuid4());db.execute("INSERT INTO deliveries VALUES (?,?,?,'prepared',0,'sync',?,?,0)",(bank,identifier,json.dumps(dict(id=identifier)),job['id'],h.now));db.execute("UPDATE bank_processing SET state='prepared' WHERE bank_id=?",(bank,))
            if case in ('invalid_user','string_instrument'):
                row=db.execute("SELECT data FROM zen_entities WHERE kind='account' AND id=?",(h.remote.data['account'][0]['id'],)).fetchone();data=json.loads(row[0]);data['user' if case=='invalid_user' else 'instrument']='2'
                db.execute("UPDATE zen_entities SET data=? WHERE kind='account' AND id=?",(json.dumps(data),data['id']))
            if case=='disabled':db.execute("UPDATE bank_accounts SET selection='ignored',zenmoney_account_id=NULL,import_start=NULL WHERE id=?",(h.account_id,))
            if case=='source_changed':db.execute("UPDATE delivery_authorizations SET source_hash='different-source'")
            source=source_rows(db)
            selected,payloads,_=delivery.intent(db,h.app.state.mirror,h.now)
            expected={row['bank_id']:payload for row,payload in zip(selected,payloads)}
        ids={bank:payload['id'] for bank,payload in expected.items()}
        with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
            result=worker.evaluate('''args=>{
              const facts=domain.sourceFacts(args.source),ids=Object.values(args.ids);let n=0;
              const plan=domain.intentPlan(args.source,facts,String(args.now),new Set(),()=>ids[n++]??'10000000-0000-4000-8000-000000000001');
              return {intents:plan.intents.map(row=>({bank:row.candidate.bank.id,id:row.id,payload:row.payload})),errors:plan.errors};
            }''',dict(source=source,ids=ids,now=h.now))
            # Only fresh IDs are injected in the actual authorized order. No
            # attempted payload or preexisting remote identity is normalized.
            actual={row['bank']:decode_json(row['payload'].encode()) for row in result['intents']}
            assert actual==expected,(case,actual,expected)
            assert all(payload['viewed'] is False for payload in actual.values())
            failure={'invalid_user':'zenmoney_account_unavailable','string_instrument':'zenmoney_account_unavailable','numeric_account_id':'zenmoney_account_unavailable','disabled':'account_disabled','source_changed':'zenmoney_unavailable'}.get(case)
            if failure:assert result['errors'][0]['code']==failure,result
            if case=='retained_uuid':
                collision=worker.evaluate('args=>{const facts=domain.sourceFacts(args.source),plan=domain.intentPlan(args.source,facts,String(args.now),new Set(),()=>args.id);return {count:plan.intents.length,errors:plan.errors};}',dict(source=source,now=h.now,id=historical))
                assert collision['count']==0 and collision['errors'][0]['code']=='delivery_uncertain',collision
    finally:h.close()
