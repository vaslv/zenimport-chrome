import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveProfile,canAttach,automaticProfile} from '../extension/bank-profiles.js';
const account=source_key=>({source_key,currency:'VND'});
const profile=(profile_key,...names)=>({profile_key,accounts:names.map(account)});

test('each bank login resolves only from its own proven account membership',()=>{
  const a=profile('login-a','one','two'),b=profile('login-b','three');
  assert.equal(resolveProfile([a,b],[account('one')],'login-b'),a);
  assert.equal(resolveProfile([a,b],[account('three')],'login-a'),b);
  assert.equal(resolveProfile([a,b],[account('new')],'login-a'),null);
  assert.equal(resolveProfile([a,b],[account('one'),account('new')],'login-a'),null);
  assert.equal(resolveProfile([a,b],[],'login-a'),null);
});
test('shared accounts need an eligible preference or an explicit choice',()=>{
  const a=profile('a','shared'),b=profile('b','shared');
  assert.equal(resolveProfile([a,b],[account('shared')]),null);
  assert.equal(resolveProfile([a,b],[account('shared')],'b'),b);
  assert.equal(resolveProfile([a,b],[{source_key:'shared',currency:'USD'}],'a'),null);
});
test('manual association can add unknown accounts but cannot steal known accounts from another login',()=>{
  const a=profile('a','one'),b=profile('b','two');
  assert.equal(canAttach([a,b],a,[account('new')]),true);
  assert.equal(canAttach([a,b],a,[account('one'),account('new')]),true);
  assert.equal(canAttach([a,b],a,[account('two')]),false);
});

test('primary account automatically anchors a new connection and preserves existing membership',()=>{
  const a=profile('legacy-id','one'),b=profile('other-id','two');
  assert.equal(automaticProfile([a,b],[account('one'),account('new')],'one'),a);
  assert.equal(automaticProfile([a,b],[account('new'),account('one')],'new'),a);
  assert.deepEqual(automaticProfile([a],[account('two')],'two'),{profile_key:'account-v1:two',profile_identity:'bank'});
  assert.equal(automaticProfile([a,b],[account('one'),account('two')],'one'),a);
  assert.deepEqual(automaticProfile([a],[account('new')],null),{profile_key:'account-v1:new',profile_identity:'bank'});
  const unlinked={profile_key:'account-v1:one',profile_identity:'bank',accounts:[]};
  assert.equal(automaticProfile([unlinked],[account('one')],'one'),unlinked);
});
