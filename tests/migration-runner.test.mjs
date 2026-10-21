import test from 'node:test';
import assert from 'node:assert/strict';
import {SwitchRunner} from '../.local/contracts/migration-runner.mjs';
const oldId='00000000-0000-4000-8000-000000000001',newId='00000000-0000-4000-8000-000000000002';
test('adapters built for an old operation cannot run a replacement journal',async()=>{
  const journal={async current(){return {plan:{id:newId},phase:'requested'};},async claim(){throw Error('must not claim replacement');}};
  const ports=new Proxy({},{get(){throw Error('must not access old peer');}});
  assert.deepEqual(await new SwitchRunner(journal,ports).run(oldId),{state:'busy',code:'migration_busy'});
});
test('matching terminal operation needs no peer or lease',async()=>{
  const journal={async current(){return {plan:{id:oldId},phase:'complete'};},async claim(){throw Error('must not claim terminal');}};
  const ports=new Proxy({},{get(){throw Error('must not access peers');}});
  assert.deepEqual(await new SwitchRunner(journal,ports).run(oldId),{state:'complete',phase:'complete'});
});
