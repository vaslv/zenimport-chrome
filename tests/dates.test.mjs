import {test} from 'node:test';
import assert from 'node:assert/strict';
import {syncTime} from '../extension/dates.js';

test('last sync shows Russian elapsed time across minute, hour and day boundaries',()=>{
 const value='2026-10-16T05:00:00Z', start=Date.parse(value);
 for(const [seconds,expected] of [[0,'только что'],[59,'только что'],[60,'1 минуту назад'],[120,'2 минуты назад'],
   [300,'5 минут назад'],[3600,'1 час назад'],[7200,'2 часа назад'],[86400,'1 день назад'],[172800,'2 дня назад']]) {
   assert.equal(syncTime(value,start+seconds*1000).ago,expected);
 }
 assert.equal(syncTime(value,start-60000).ago,'только что');
 assert.match(syncTime(value,start).date,/16 октября 2026/);
 for(const invalid of [null,undefined,'','not-a-date'])assert.equal(syncTime(invalid,start),null);
});
