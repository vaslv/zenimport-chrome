"""Rebuild the source category graph and compare independent native decisions."""
import json
from decimal import Decimal
from uuid import uuid4
import pytest
pytest.importorskip('backend')
from playwright.sync_api import sync_playwright
from backend import storage,predictions
from mirror_factory import Fixture,movement
from test_runtime import installed


def plain(value):
    result=format(value,'f') if isinstance(value,Decimal) else str(value)
    if '.' in result:result=result.rstrip('0').rstrip('.')
    return '0' if result=='-0' else result


def tagged(row):
    return dict(id=row['id'],title=row.get('title',''),deleted=bool(row.get('deleted')),archive=bool(row.get('archive')),
        showIncome=row.get('showIncome',True) not in (False,0),showOutcome=row.get('showOutcome',True) not in (False,0))


def reviewed(row):
    result={k:row.get(k) for k in ('id','incomeAccount','outcomeAccount')}
    result.update(viewed=row.get('viewed') in (True,1),hold=bool(row.get('hold')),deleted=bool(row.get('deleted')),tags=row.get('tag') or [])
    for side in ('income','outcome'):
        value=row.get(side);valid=type(value) is int or isinstance(value,Decimal)
        result[side]=plain(value) if valid else None
        result[side+'ScaleAllowed']=valid and (not isinstance(value,Decimal) or value.as_tuple().exponent>=-12)
        result[side+'Instrument']=str(row[side+'Instrument']) if row.get(side+'Instrument') is not None else None
    return result


def data(db):
    banks=[dict(r) for r in db.execute('SELECT b.*,a.bank FROM bank_transactions b JOIN bank_accounts a ON a.id=b.account_id')]
    delivered={r[0] for r in db.execute("SELECT bank_id FROM bank_processing WHERE state='delivered'")}
    bindings={}
    for account,target in db.execute('SELECT account_id,zenmoney_account_id FROM account_bindings UNION SELECT id,zenmoney_account_id FROM bank_accounts WHERE zenmoney_account_id IS NOT NULL'):bindings.setdefault(account,set()).add(target)
    groups=[]
    for row in db.execute('SELECT * FROM link_groups'):
        groups.append(dict(kind=row['kind'],banks=[r[0] for r in db.execute('SELECT bank_id FROM link_bank_members WHERE group_id=?',(row['id'],))],
            zens=[r[0] for r in db.execute('SELECT zen_id FROM link_zen_members WHERE group_id=?',(row['id'],))]))
    evidence=dict(banks=[b for b in banks if b['id'] in delivered],bankExclusions=[r[0] for r in db.execute('SELECT bank_id FROM bank_exclusions')],
        zenExclusions=[r[0] for r in db.execute('SELECT zen_id FROM zen_exclusions')],tags=[(k,tagged(v)) for k,v in predictions.entities(db,'tag').items()],
        transactions=[(k,reviewed(v)) for k,v in predictions.entities(db,'transaction').items()],accounts=[(k,dict(type=v.get('type'))) for k,v in predictions.entities(db,'account').items()],
        instruments=[(k,v.get('shortTitle')) for k,v in predictions.entities(db,'instrument').items()],bindings=[(k,list(v)) for k,v in bindings.items()],groups=groups,
        receipts=[dict(r) for r in db.execute('SELECT bank_id,zen_id,origin FROM processing_receipts')],deliveries=list(map(tuple,db.execute('SELECT bank_id,zen_id FROM deliveries'))))
    return dict(evidence=evidence,banks=banks,rules=[dict(r) for r in db.execute('SELECT * FROM recipient_rules')],manual=list(map(tuple,db.execute("SELECT bank_id,category_id FROM category_choices WHERE source='manual'"))))


def source_evidence(db):
    payments=[]
    for row in db.execute('SELECT * FROM category_payments'):
        r=dict(row);r['zen_ids']=json.loads(r.pop('zen_ids_json'));r['eligible']=bool(r['eligible']);payments.append(r)
    return dict(payments=payments,evidence=[dict(r)|dict(eligible=bool(r['eligible'])) for r in db.execute('SELECT * FROM category_evidence')])


CASES=['two','three','five','income','category_conflict','unreviewed','hold','delete','transfer','debt','amount','opposite_direction','currency','original_scale',
       'chronological','shared_uuid','split','mixed_split','manual','rule','conflicting_rules','excluded_bank','excluded_zen','old_binding','stale']


@pytest.mark.parametrize('case',CASES)
def test_actual_python_and_browser_evidence_and_prediction_match(tmp_path,case):
    f=Fixture(tmp_path/'reference.sqlite3')
    try:
        count=2 if case in ('two','split','mixed_split') else 5 if case=='five' else 3
        if case in ('chronological','shared_uuid'):
            banks=[];remote=[]
            for i in range(count):
                bank=f.bank();banks.append(bank);zen='shared-source' if case=='shared_uuid' else 'z'+str(i)
                if not any(t['id']==zen for t in remote):remote.append(movement(zen))
                with storage.transaction(f.path) as db:
                    db.execute('INSERT INTO processing_receipts VALUES (?,?,?,?)',(bank,zen,'day_amount_order' if case=='chronological' else 'fixture',f.now))
                    db.execute("UPDATE bank_processing SET state='delivered' WHERE bank_id=?",(bank,))
            f.data['transaction'].extend(remote)
        else:banks,remote=f.history(count,viewed=case!='unreviewed',direction='income' if case=='income' else 'expense')
        pending=f.bank(direction='income' if case=='income' else 'expense')
        if case=='category_conflict':remote[0]['tag']=['category-b']
        if case=='hold':remote[0]['hold']=True
        if case=='delete':remote[0]['deleted']=True
        if case=='transfer':remote[0].update(incomeAccount='other',income=100)
        if case=='debt':f.data['account'][0]['type']='debt'
        if case=='amount':remote[0]['outcome']=101
        if case=='opposite_direction':remote[0].update(income=100,outcome=0)
        if case=='currency':f.data['instrument'][0]['shortTitle']='USD'
        if case=='original_scale':remote[0]['outcome']=Decimal('100.0000000000000')
        split=f.bank() if case in ('split','mixed_split') else None
        with storage.transaction(f.path) as db:
            if case in ('split','mixed_split'):
                group=str(uuid4());zens=[movement('s1',amount=40),movement('s2',category='category-b' if case=='mixed_split' else 'category-a',amount=60)]
                db.execute('INSERT INTO link_groups VALUES (?,?,?,?,?)',(group,'split','bank-vnd',f.now,'manual'))
                db.execute('INSERT INTO link_bank_members VALUES (?,?)',(group,split));db.executemany('INSERT INTO link_zen_members VALUES (?,?)',[(group,z['id']) for z in zens]);db.execute("UPDATE bank_processing SET state='delivered' WHERE bank_id=?",(split,));f.data['transaction'].extend(zens)
            if case=='manual':db.execute('INSERT INTO category_choices VALUES (?,?,?,?)',(pending,'category-b','manual',f.now))
            if case in ('rule','conflicting_rules'):
                db.execute('INSERT INTO recipient_rules (bank,name,direction,category_id,updated_at) VALUES (?,?,?,?,?)',('vietinbank','Fixture shop','expense','category-b',f.now))
                if case=='conflicting_rules':db.execute('INSERT INTO recipient_rules (bank,name,direction,category_id,updated_at) VALUES (?,?,?,?,?)',('vietinbank','FIXTURE SHOP','expense','category-a',f.now))
            if case=='excluded_bank':db.execute('INSERT INTO bank_exclusions VALUES (?,?,?)',(banks[0],'fixture',f.now))
            if case=='excluded_zen':db.execute('INSERT INTO zen_exclusions (zen_id,created_at) VALUES (?,?)',(remote[0]['id'],f.now))
            if case=='old_binding':
                f.data['account'].append(dict(id='former',type='checking',instrument=2,user=1));db.execute('INSERT INTO account_bindings VALUES (?,?,?,?,?,?)',(str(uuid4()),'bank-vnd','former',0,'fixture',f.now))
                for row in remote:row.update(incomeAccount='former',outcomeAccount='former')
        f.refresh()
        now=f.now+301 if case=='stale' else f.now
        with storage.transaction(f.path,read_only=True) as db:
            payload=data(db);expected=source_evidence(db);expected['predictions']={b:predictions.predict(db,b,now) for b in (pending,banks[0])}
            payload.update(fresh=predictions.fresh(db,now),predictIds=[pending,banks[0]])
        with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
            actual=worker.evaluate('''data=>{
              const input={...data.evidence};for(const key of ['bankExclusions','zenExclusions'])input[key]=new Set(input[key]);
              for(const key of ['tags','transactions','accounts','instruments','deliveries'])input[key]=new Map(input[key]);input.bindings=new Map(input.bindings.map(([k,v])=>[k,new Set(v)]));
              const evidence=domain.buildCategoryEvidence(input),context=domain.categoryContext({tags:input.tags,banks:data.banks,payments:evidence.payments,rules:data.rules,manual:new Map(data.manual)});
              return {...evidence,predictions:Object.fromEntries(data.predictIds.map(id=>[id,domain.predictCategory(data.banks.find(b=>b.id===id),context,data.fresh)]))};
            }''',payload)
            assert actual['predictions']==expected['predictions']
            for table in ('payments','evidence'):assert sorted(actual[table],key=lambda r:json.dumps(r,sort_keys=True))==sorted(expected[table],key=lambda r:json.dumps(r,sort_keys=True)),(case,table)
    finally:f.close()
