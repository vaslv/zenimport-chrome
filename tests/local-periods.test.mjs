import test from 'node:test';
import assert from 'node:assert/strict';
import {frontier,plannedRanges,mergeRanges,chunks,subtractRange,shiftDays} from '../.local/contracts/periods.mjs';
import {discovery,settings,name} from '../.local/contracts/capture-validation.mjs';
test('coverage fills gaps and overlaps only the contiguous frontier',()=>{
 const coverage=[['2026-01-01','2026-01-10'],['2026-01-20','2026-01-25']];
 assert.equal(frontier('2026-01-01',coverage),'2026-01-10');
 assert.deepEqual(plannedRanges('2026-01-01','2026-01-31',coverage,null),[['2026-01-01','2026-01-10'],['2026-01-11','2026-01-19'],['2026-01-26','2026-01-31']]);
 assert.deepEqual(plannedRanges('2026-01-01','2026-01-31',coverage,'2025-12-01'),[['2025-12-01','2026-01-31']]);
 assert.deepEqual(plannedRanges('2026-01-01','2026-02-10',[['2026-01-01','2026-02-20']],null),[['2026-01-27','2026-02-10']]);
});
test('calendar chunks and outstanding reimports preserve inclusive endpoints',()=>{
 assert.equal(shiftDays('2024-03-01',-1),'2024-02-29');
 assert.deepEqual(chunks(mergeRanges([['2026-01-01','2026-01-30'],['2026-01-31','2026-02-01']]),30),[['2026-01-01','2026-01-30'],['2026-01-31','2026-02-01']]);
 assert.deepEqual(subtractRange([['2026-01-01','2026-02-01']],'2026-01-10','2026-01-20'),[['2026-01-01','2026-01-09'],['2026-01-21','2026-02-01']]);
 assert.throws(()=>chunks([['2026-01-01','2026-02-01']],0));assert.throws(()=>frontier('2026-02-30',[]));
});
test('capture setup validation preserves exact versions and Python name whitespace',()=>{
 assert.equal(settings({expected_version:'9007199254740993',selection:'ignored'}).expected_version,'9007199254740993');
 assert.throws(()=>settings({expected_version:Number.MAX_SAFE_INTEGER+1,selection:'ignored'}),{code:'validation_error'});
 assert.throws(()=>settings({expected_version:0,selection:'enabled',zenmoney_account_id:'a',import_start:'2026-02-30'}),{code:'validation_error'});
 assert.equal(name('\u001cName\u0085'),'Name');assert.equal(name('\ufeffName\ufeff'),'\ufeffName\ufeff');
 assert.throws(()=>name('bad\nname'),{code:'validation_error'});
 assert.throws(()=>discovery({bank:'unknown'}),{code:'unsupported_bank'});
});
