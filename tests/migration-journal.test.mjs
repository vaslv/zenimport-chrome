import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {switchJournal,advancePhase,switchPlan,commandRequest} from '../.local/contracts/migration-journal.mjs';
const uuid=()=>randomUUID();
function journal(){return {version:1,plan:{id:uuid(),direction:'local-to-remote',sourceId:uuid(),destinationId:uuid(),remoteCredentialRef:uuid(),localCredentialRef:uuid(),ownerIds:['1']},initialRoot:{id:'runtime',installationId:uuid(),activeMode:'local',activeGeneration:uuid(),epoch:'1',pendingSwitchId:null,credentialRef:uuid(),credentialEpoch:'1',financialMayHaveStarted:true},phase:'requested',revision:'1',lease:null,destinationGeneration:null,commands:[],receipts:[],chunks:[],error:null};}
const rejects=fn=>assert.throws(fn,error=>error.code==='migration_invalid');

test('journal validates closed shape and references without storing token fields',()=>{
  const value=journal();assert.deepEqual(switchJournal(value),value);
  for(const key of ['token','password','url'])rejects(()=>switchPlan({...value.plan,[key]:'private'}));
  rejects(()=>switchJournal({...value,lease:{id:uuid(),deadline:'-1'}}));
  rejects(()=>switchJournal({...value,chunks:Array(257).fill('f'.repeat(64))}));
  rejects(()=>switchJournal({...value,error:'secret response contents'}));
  rejects(()=>switchJournal({...value,initialRoot:{...value.initialRoot,activeMode:'remote',activeGeneration:null}}));
});

test('journal progress is monotonic and recovery cannot trust a phase without evidence',()=>{
  let value=journal();value=advancePhase(value,'destination_checked');value=advancePhase(value,'source_quiescing');
  rejects(()=>advancePhase(value,'source_paused'));
  rejects(()=>advancePhase(value,'requested'));
  rejects(()=>switchJournal({...value,phase:'destination_activated'}));
});

test('command roles are closed and repeated command slots are invalid',()=>{
  const value=journal(),request={request_id:uuid(),switch_id:value.plan.id,expected_epoch:'1',peer_id:value.plan.destinationId};
  assert.deepEqual(commandRequest('source','source_start',request),request);
  rejects(()=>commandRequest('destination','source_start',request));
  const entry={side:'source',command:'source_start',request};
  assert.equal(switchJournal({...value,commands:[entry]}).commands.length,1);
  rejects(()=>switchJournal({...value,commands:[entry,entry]}));
  rejects(()=>switchJournal({...value,commands:[{...entry,request:{...request,switch_id:uuid()}}]}));
});

test('remote-to-local reservation binds destination identity and generation together',()=>{
  const value=journal();value.plan.direction='remote-to-local';value.plan.destinationId=null;
  value.initialRoot.activeMode='remote';value.initialRoot.activeGeneration=null;
  assert.deepEqual(switchJournal(value),value);
  rejects(()=>switchJournal({...value,plan:{...value.plan,destinationId:uuid()}}));
  const reserved={...value,plan:{...value.plan,destinationId:uuid()},destinationGeneration:uuid()};
  assert.deepEqual(switchJournal(reserved),reserved);
});

test('a cancelled unused journal is terminal and cannot return to requested',()=>{
  const value={...journal(),phase:'cancelled'};
  assert.deepEqual(switchJournal(value),value);
  rejects(()=>advancePhase(value,'requested'));
  const request={request_id:uuid(),switch_id:value.plan.id,expected_epoch:'1',peer_id:value.plan.destinationId};
  rejects(()=>switchJournal({...value,commands:[{side:'source',command:'source_start',request}]}));
});
