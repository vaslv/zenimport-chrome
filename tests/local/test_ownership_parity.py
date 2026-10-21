"""Late bank and durable request proofs against actual Python capture fixtures."""
from copy import deepcopy
import json
from uuid import uuid4
import pytest
pytest.importorskip('backend')
from playwright.sync_api import sync_playwright
from backend import storage,existing,ownership,predictions
from delivery_factory import DeliveryHarness
from test_transfer_recovery import setup_old,add_peer,OTHER
from zenmoney_api.protocol import decode_json
from test_runtime import installed


def plain(value):
    text=format(value,'f') if not isinstance(value,int) else str(value)
    if '.' in text:text=text.rstrip('0').rstrip('.')
    return '0' if text=='-0' else text


def remote(tx):
    return {k:v for k,v in tx.items() if k not in ('income','outcome','incomeInstrument','outcomeInstrument','created')}|{
        k:plain(tx[k]) if k in ('income','outcome') else str(tx[k]) for k in ('income','outcome','incomeInstrument','outcomeInstrument','created') if k in tx and tx[k] is not None}


def context(db,candidates):
    known=[dict(row) for row in db.execute(ownership.KNOWN)];targets=[dict(row) for row in db.execute('SELECT * FROM processing_targets')]
    payloads=[];adopted=[];attempted=[]
    for edge in known:
        bank,zen=edge['bank_id'],edge['zen_id'];key=json.dumps([bank,zen],separators=(',',':'))
        for payload, in db.execute('''SELECT payload FROM deliveries WHERE bank_id=? AND zen_id=? AND ever_attempted=1
            UNION SELECT payload FROM delivery_attempts WHERE bank_id=? AND zen_id=?''',(bank,zen,bank,zen)):
            tx=decode_json(payload.encode());payloads.append(edge|dict(incomeAccount=tx.get('incomeAccount'),outcomeAccount=tx.get('outcomeAccount')))
        if db.execute("SELECT 1 FROM processing_receipts WHERE bank_id=? AND zen_id=? AND origin IN ('bank_reference','day_amount','day_amount_order') UNION SELECT 1 FROM link_bank_members b JOIN link_groups g ON g.id=b.group_id JOIN link_zen_members z ON z.group_id=g.id WHERE b.bank_id=? AND z.zen_id=? AND g.origin='day_amount_group'",(bank,zen,bank,zen)).fetchone():adopted.append(key)
        if db.execute('SELECT 1 FROM deliveries WHERE bank_id=? AND zen_id=? AND ever_attempted=1 UNION SELECT 1 FROM delivery_attempts WHERE bank_id=? AND zen_id=?',(bank,zen,bank,zen)).fetchone():attempted.append(key)
    authorizations=[dict(row) for row in db.execute('SELECT * FROM delivery_authorizations')]
    for row in authorizations:
        for key in ('revision','authorized_at'):row[key]=str(row[key])
    current={row['bank_id']:predictions.bank_record(db,row['bank_id']) for row in known}
    revisions={json.dumps([row['bank_id'],row['revision']],separators=(',',':')):predictions.bank_record(db,row['bank_id'],int(row['revision'])) for row in authorizations}
    return dict(known=known,targets=[r|dict(at=str(r['at'])) for r in targets],payloads=payloads,adopted=adopted,attempted=attempted,authorizations=[(r['bank_id'],r) for r in authorizations],
        transactions=[(k,remote(v)) for k,v in predictions.entities(db,'transaction').items()],
        blockingTransactions=[(row['id'],remote(decode_json(row['data'].encode()))) for row in db.execute("SELECT * FROM zen_entities WHERE kind='transaction' AND deleted=0")],excluded=[r[0] for r in db.execute('SELECT zen_id FROM zen_exclusions')],sourceHash=db.execute('SELECT source_hash FROM zen_mirror_state').fetchone()[0],
        enabled=[dict(row) for row in db.execute("SELECT id,zenmoney_account_id FROM bank_accounts WHERE selection='enabled'")],
        instruments=[(k,str(v['instrument'])) for k,v in predictions.entities(db,'account').items() if 'instrument' in v],current=list(current.items()),revisions=list(revisions.items()))


@pytest.mark.parametrize('incoming,fx,conflict',[(i,f,None) for i in (False,True) for f in (False,True)]+[(False,False,c) for c in ('duplicate_bank','duplicate_remote','changed_mapping','changed_amount','changed_date','tombstone_reappeared')])
def test_actual_late_transfer_recovery_and_blocked_days_match_browser(tmp_path,incoming,fx,conflict):
    h=DeliveryHarness(tmp_path/'history.sqlite3')
    try:
        old,zen=setup_old(h,incoming,fx)
        if conflict=='duplicate_remote':
            other=str(uuid4());h.remote.transactions[other]=deepcopy(h.remote.transactions[zen])|dict(id=other)
        if conflict=='changed_mapping':assert h.configure(h.account_id,version=1,target=OTHER).status_code==200
        if conflict=='changed_amount':h.remote.transactions[zen]['outcome']=125
        if conflict=='changed_date':h.remote.transactions[zen]['date']='2026-09-16'
        add_peer(h,incoming,fx,count=2 if conflict=='duplicate_bank' else 1);h.worker.mirror.refresh(force=True)
        with storage.transaction(h.path) as db:
            if conflict=='tombstone_reappeared':db.execute("INSERT OR IGNORE INTO zen_tombstones VALUES ('transaction',?,'hard_delete',?)",(zen,json.dumps(dict(object='transaction',id=zen))))
            candidates=[(predictions.bank_record(db,identifier),dict(id=OTHER,instrument=3 if fx else 2)) for external,identifier in h.bank_ids().items() if external.startswith('peer-')]
            data=context(db,candidates);before={(r['bank_id'],r['zen_id']) for r in data['targets']}
            ownership.backfill(db);existing.recover_transfer_ownership(db,candidates,h.now)
            expected=[dict(row)|dict(at=str(row['at'])) for row in db.execute('SELECT * FROM processing_targets') if (row['bank_id'],row['zen_id']) not in before]
            blocked=sorted(ownership.blocked(db,candidates))
        encoded_candidates=[(b,a|dict(instrument=str(a['instrument']))) for b,a in candidates]
        with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
            actual=worker.evaluate('''({data,candidates,now})=>{
              const c={...data};for(const k of ['adopted','attempted','excluded'])c[k]=new Set(c[k]);
              for(const k of ['authorizations','transactions','blockingTransactions','instruments','current','revisions'])c[k]=new Map(c[k]);
              const added=domain.backfillOwnership(c);c.targets=[...c.targets,...added];
              const recovered=domain.recoverTransferOwnership(c,candidates,String(now));c.targets=[...c.targets,...recovered];
              return {targets:[...added,...recovered],blocked:[...domain.blockedOwnership(c,candidates)].sort()};
            }''',dict(data=data,candidates=encoded_candidates,now=h.now))
            assert sorted(actual['targets'],key=repr)==sorted(expected,key=repr)
            assert actual['blocked']==blocked
        assert h.remote.writes==[]
    finally:h.close()


def test_native_100k_historical_payload_backfill_stays_within_one_worker_unit(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        result=worker.evaluate('''()=>{
          const known=Array.from({length:100000},(_,i)=>({bank_id:'b-'+i,zen_id:'z-'+i}));
          const c={known,targets:[],payloads:known.map(edge=>({...edge,incomeAccount:'original',outcomeAccount:'original'})),adopted:new Set(),attempted:new Set(),authorizations:new Map()};
          const start=performance.now(),targets=domain.backfillOwnership(c),backfillMs=performance.now()-start;
          const transactions=new Map(known.map(edge=>[edge.zen_id,{id:edge.zen_id,date:'2026-10-20',incomeAccount:'b',outcomeAccount:'a',income:'1',outcome:'1'}]));
          const candidate=[{id:'peer',account_id:'physical-b',external_id:'peer',identity_kind:'bank',local_date:'2026-10-20',direction:'income',amount:'1',occurred_at:null},{id:'b',instrument:'2'}];
          const recoveryStart=performance.now(),recovered=domain.recoverTransferOwnership({...c,transactions,sourceHash:'fixture',enabled:[],excluded:new Set(),current:new Map(),revisions:new Map(),instruments:new Map()},[candidate],'10');
          return {count:targets.length,all:targets.every(row=>row.target_id==='original'),backfillMs,recovered:recovered.length,recoveryMs:performance.now()-recoveryStart};
        }''')
        assert result['count']==100000 and result['all'] and result['backfillMs']<10000 and result['recoveryMs']<10000 and result['recovered']==0,result
