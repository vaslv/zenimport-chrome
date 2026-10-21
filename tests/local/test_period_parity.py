"""Actual Python capture planner versus the same installed browser domain code."""
from datetime import date,timedelta
import json
import random
import sqlite3
from playwright.sync_api import sync_playwright
from test_runtime import installed
from backend import capture


def test_actual_python_period_planner_matches_browser_with_gaps_overlap_and_forced_ranges(tmp_path):
    rng=random.Random(71021)
    db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
    db.executescript('CREATE TABLE coverage(account_id TEXT,start_date TEXT,end_date TEXT); CREATE TABLE reimport_ranges(id TEXT,account_id TEXT,settings_version INTEGER,remaining_json TEXT);')
    cases=[];expected=[];base=date(2024,1,1)
    for i in range(250):
        start=base+timedelta(days=rng.randrange(600));end=start+timedelta(days=rng.randrange(1,200))
        spans=[]
        for _ in range(rng.randrange(8)):
            left=start+timedelta(days=rng.randrange(-20,220));right=left+timedelta(days=rng.randrange(1,50));spans.append((left,right))
        forced=start-timedelta(days=rng.randrange(1,60)) if i%4==0 else None
        outstanding=[(start-timedelta(days=5),end+timedelta(days=10))] if i%3==0 else []
        days=rng.choice([1,14,30,31,180,366]);db.execute('DELETE FROM coverage')
        db.executemany('INSERT INTO coverage VALUES (?,?,?)',[('a',left.isoformat(),right.isoformat()) for left,right in spans])
        account=dict(id='a',import_start=start.isoformat(),settings_version=1)
        contiguous=capture.frontier(db,'a',start);planned=capture.planned_ranges(db,account,end,forced)
        merged=capture.merge_ranges(planned+outstanding)
        db.execute('DELETE FROM reimport_ranges');db.execute('INSERT INTO reimport_ranges VALUES (?,?,?,?)',('r','a',1,json.dumps([[l.isoformat(),r.isoformat()] for l,r in outstanding])))
        capture.satisfy_reimports(db,account,start.isoformat(),end.isoformat())
        ranges=lambda values:[[left.isoformat(),right.isoformat()] for left,right in values]
        cases.append(dict(start=start.isoformat(),end=end.isoformat(),coverage=ranges(spans),forced=forced.isoformat() if forced else None,outstanding=ranges(outstanding),days=days))
        expected.append(dict(frontier=contiguous.isoformat() if contiguous else None,planned=ranges(planned),merged=ranges(merged),chunks=ranges(capture.chunks(merged,days)),remaining=json.loads(db.execute('SELECT remaining_json FROM reimport_ranges').fetchone()[0])))
    db.close()
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        actual=worker.evaluate('rows=>Promise.all(rows.map(input=>domain.execute("capture.periods",input)))',cases)
        assert actual==expected
