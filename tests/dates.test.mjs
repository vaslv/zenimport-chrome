import {test} from 'node:test';
import assert from 'node:assert/strict';
import {syncTime} from '../extension/dates.js';

test('last sync shows English elapsed time across minute, hour and day boundaries',()=>{
 const value='2026-10-16T05:00:00Z', start=Date.parse(value);
 for(const [seconds,expected] of [[0,'just now'],[59,'just now'],[60,'1 minute ago'],[120,'2 minutes ago'],
   [300,'5 minutes ago'],[3600,'1 hour ago'],[7200,'2 hours ago'],[86400,'1 day ago'],[172800,'2 days ago']]) {
   assert.equal(syncTime(value,start+seconds*1000).ago,expected);
 }
 assert.equal(syncTime(value,start-60000).ago,'just now');
 assert.match(syncTime(value,start).date,/16 October 2026/);
 for(const invalid of [null,undefined,'','not-a-date'])assert.equal(syncTime(invalid,start),null);
});
