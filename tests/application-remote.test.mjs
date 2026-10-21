import test from 'node:test';
import assert from 'node:assert/strict';
import {remoteService} from '../.local/contracts/application-remote.mjs';

test('named remote operations retain the exact API1 method, path and immutable body',async()=>{
 const calls=[],reply={fixture:true},file=new Blob(['synthetic']);
 const transport={info:async()=>{calls.push(['info']);return reply;},
  request:async(path,method='GET',body)=>{calls.push([method,path,body]);return reply;},
  transfer:async(action,body)=>{calls.push(['transfer',action,body]);return action==='export'?file:reply;}};
 const service=remoteService(transport),body={request_id:'request',details:{exact:'9007199254740993'}};
 const original=structuredClone(body);
 const routes=[
  [()=>service.connections.list('bidv'),['GET','/connections?bank=bidv',undefined]],
  [()=>service.connections.get('connection'),['GET','/connections/connection',undefined]],
  [()=>service.connections.discover(body),['POST','/connections/discover',body]],
  [()=>service.connections.rename('connection',body),['PUT','/connections/connection/label',body]],
  [()=>service.connections.unlink('connection','account'),['POST','/connections/connection/accounts/account/unlink',{}]],
  [()=>service.accounts.catalog(),['GET','/zenmoney/accounts',undefined]],
  [()=>service.accounts.configure('account',body),['PUT','/accounts/account/settings',body]],
  [()=>service.capture.start(body),['POST','/jobs',body]],
  [()=>service.capture.get('job'),['GET','/jobs/job',undefined]],
  [()=>service.capture.lease('job',body),['POST','/jobs/job/lease',body]],
  [()=>service.capture.page('job','interval',2,body),['PUT','/jobs/job/intervals/interval/pages/2',body]],
  [()=>service.capture.complete('job','interval',body),['POST','/jobs/job/intervals/interval/complete',body]],
  [()=>service.capture.pause('job',body),['POST','/jobs/job/capture-status',body]],
  [()=>service.capture.stop('job'),['POST','/jobs/job/stop',{}]],
  [()=>service.reports.discrepancies('connection',{from_date:'2026-01-01',to_date:'2026-02-01',account_id:'account',refresh:true}),
   ['GET','/connections/connection/discrepancies?from_date=2026-01-01&to_date=2026-02-01&account_id=account&refresh=true',undefined]],
  [()=>service.migration.status(),['GET','/migration/status',undefined]],
  [()=>service.migration.resume(),['POST','/migration/resume',{}]],
 ];
 for(const [invoke,expected]of routes){assert.equal(await invoke(),reply);assert.deepEqual(calls.at(-1),expected);}
 assert.equal(await service.capabilities(),reply);assert.deepEqual(calls.at(-1),['info']);
 assert.equal(await service.migration.export(),file);assert.deepEqual(calls.at(-1),['transfer','export',undefined]);
 assert.equal(await service.migration.import(file),reply);assert.deepEqual(calls.at(-1),['transfer','import',file]);
 assert.deepEqual(body,original);assert.equal(calls.length,routes.length+3);
});

test('the adapter cannot turn an identifier into a second API path and propagates coded errors unchanged',async()=>{
 const calls=[],error=Object.assign(Error('unauthorized'),{code:'unauthorized'});
 const service=remoteService({info:async()=>{throw error;},request:async path=>{calls.push(path);throw error;},transfer:async()=>{throw error;}});
 await assert.rejects(service.capture.get('../other?token=private'),value=>value===error);
 assert.deepEqual(calls,['/jobs/..%2Fother%3Ftoken%3Dprivate']);
 await assert.rejects(service.accounts.catalog(),value=>value===error);
 assert.equal(calls.length,2);
});
