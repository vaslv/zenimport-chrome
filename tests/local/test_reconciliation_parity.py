"""Actual Python pure matching policy against the installed TypeScript domain."""
import json
from decimal import Decimal
import random
import sqlite3
import pytest
pytest.importorskip('backend')
from playwright.sync_api import sync_playwright
from backend import existing,discrepancies,ownership,predictions
from zenmoney_api.protocol import encode_json
from test_runtime import installed


def test_actual_python_and_browser_bounded_subset_and_report_algorithms_match(tmp_path):
    # Canonical plain decimal strings are the frozen domain boundary, not
    # Python Decimal's scientific display spelling. No value is rounded.
    rng=random.Random(8226);vectors=[]
    for _ in range(500):
        items=[(str(i),Decimal(rng.randint(-30,40))/Decimal('1000000000000')) for i in range(rng.randint(0,16))]
        target=Decimal(rng.randint(-40,60))/Decimal('1000000000000');initial=(0,1,12,20000)[len(vectors)%4];budget=[initial]
        expected=existing.unique_subset(items,target,budget)
        banks=[v for _,v in items[:4]];zens=dict(items[4:]);missing,extras=discrepancies.unmatched_sides(banks,zens)
        vectors.append(dict(items=[(k,format(v,'f')) for k,v in items],target=format(target,'f'),budget=initial,
            expected=list(expected) if expected else None,remaining=budget[0],banks=[format(v,'f') for v in banks],zens=[(k,format(v,'f')) for k,v in zens.items()],missing=sorted(missing),extras=sorted(extras)))
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        result=worker.evaluate('''vectors=>vectors.map(v=>{
          const money=s=>domain.ExactMoney.parse(s),budget={remaining:v.budget};
          const proof=domain.uniqueSubset(v.items.map(([k,s])=>[k,money(s)]),money(v.target),budget);
          const report=domain.unmatchedSides(v.banks.map(money),new Map(v.zens.map(([k,s])=>[k,money(s)])));
          return {expected:proof.ids,remaining:budget.remaining,missing:[...report.missing].sort((a,b)=>a-b),extras:[...report.extras].sort()};
        })''',vectors)
        assert result==[{k:v[k] for k in ('expected','remaining','missing','extras')} for v in vectors]


def test_actual_python_and_browser_reference_multiplicity_and_group_decisions_match(tmp_path):
    # Minimal SQL adapter for pure source queries, not a storage/FK parity claim.
    # Real durable graph parity is independently covered by native repository tests.
    db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
    db.executescript('''CREATE TABLE zen_entities(kind,id,data,deleted,PRIMARY KEY(kind,id));CREATE TABLE zen_tombstones(kind,entity_id);
      CREATE TABLE zen_exclusions(zen_id);CREATE TABLE bank_accounts(id,selection,zenmoney_account_id);
      CREATE TABLE processing_receipts(bank_id,zen_id);CREATE TABLE deliveries(bank_id,zen_id,ever_attempted);
      CREATE TABLE delivery_attempts(bank_id,zen_id);CREATE TABLE link_bank_members(group_id,bank_id);
      CREATE TABLE link_zen_members(group_id,zen_id);CREATE TABLE processing_targets(bank_id,zen_id,target_id);''')
    rng=random.Random(8227);vectors=[]
    for case in range(200):
        for name in ('zen_entities','zen_exclusions','bank_accounts','processing_receipts','processing_targets','link_zen_members'):db.execute('DELETE FROM '+name)
        enabled=[dict(id='physical-a',zenmoney_account_id='a'),dict(id='physical-b',zenmoney_account_id='b')]
        if case%5==0:enabled.append(dict(id='shared',zenmoney_account_id='a'))
        db.executemany("INSERT INTO bank_accounts VALUES (?,'enabled',?)",[(r['id'],r['zenmoney_account_id']) for r in enabled])
        transactions=[]
        for i in range(rng.randint(0,9)):
            tx=dict(id='z'+str(i),date='2026-10-20',incomeAccount=rng.choice(['a','b']),outcomeAccount=rng.choice(['a','b']),incomeInstrument=2,outcomeInstrument=rng.choice([2,3]),
                income=rng.choice([0,10,40,60,100]),outcome=rng.choice([0,10,40,60,100]),hold=case%9==0,comment='REF12345' if i==0 else '',created=rng.randint(1,5))
            transactions.append(tx);db.execute('INSERT INTO zen_entities VALUES (?,?,?,0)',('transaction',tx['id'],encode_json(tx).decode()))
        if transactions and case%7==0:
            zen=transactions[0]['id'];db.execute('INSERT INTO processing_receipts VALUES (?,?)',('historic',zen))
            if case%14==0:db.execute('INSERT INTO processing_targets VALUES (?,?,?)',('historic',zen,'a'))
        if transactions and case%11==0:db.execute('INSERT INTO zen_exclusions VALUES (?)',(transactions[-1]['id'],))
        candidates=[]
        for i in range(rng.randint(0,8)):
            physical=rng.choice(['a','b']);bank=dict(id='b'+str(i),account_id='physical-'+physical,external_id='vib:id:REF12345' if i==0 else 'source'+str(i),identity_kind='bank',local_date='2026-10-20',
                direction=rng.choice(['income','expense']),amount=str(rng.choice([10,40,60,90,100])),occurred_at='2026-10-20T12:00:0'+str(i)+'+07:00')
            candidates.append((bank,dict(id=physical,instrument=2)))
        singles=existing.matches(db,candidates);groups=existing.group_matches(db,candidates,singles);claimed,unknown=ownership.claims(db)
        # Use actual source enumeration order. Amounts/instruments/created become
        # exact domain strings; IDs and decisions remain unmodified.
        remote=[]
        for tx in predictions.entities(db,'transaction').values():remote.append(tx|{k:str(tx[k]) for k in ('income','outcome','incomeInstrument','outcomeInstrument','created')})
        vectors.append(dict(context=dict(transactions=remote,claimed=[json.dumps(list(k),separators=(',',':')) for k in claimed],unknown=list(unknown),
            excluded=[r[0] for r in db.execute('SELECT zen_id FROM zen_exclusions')],grouped=[],enabled=enabled),
            candidates=[(b,a|dict(instrument=str(a['instrument']))) for b,a in candidates],expected=dict(singles=sorted([k,list(v)] for k,v in singles.items()),
                groups=[dict(account_id=g.account_id,banks=list(g.banks),zens=list(g.zens),kind=g.kind) for g in groups])))
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        result=worker.evaluate('''vectors=>vectors.map(v=>{
          const context={...v.context};for(const k of ['claimed','unknown','excluded','grouped'])context[k]=new Set(context[k]);
          const singles=domain.singleMatches(context,v.candidates),groups=domain.groupMatches(context,v.candidates,singles);
          return {singles:[...singles].sort(([a],[b])=>a<b?-1:a>b?1:0),groups};
        })''',vectors)
        assert result==[v['expected'] for v in vectors]
    db.close()
