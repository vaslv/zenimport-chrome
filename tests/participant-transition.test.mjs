import assert from 'node:assert/strict';
import test from 'node:test';
import {participantRequest,participantTransition} from '../.local/contracts/participant-transition.mjs';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const ctx={now:'1792540800',datasetId:id(9),archiveId:id(8),eligible:true,legacyHold:false,
  archive:{sha256:'b'.repeat(64),size:'25'},validated:true};
function peer(n){return {control:{id:id(n),generation:id(n+100),epoch:'1',state:'active',operationId:null,everActivated:false,awaitingSync:false},operation:null};}
let counter=1000;
function step(p,command,fields={},context=ctx){
  const {request}=participantRequest(command,{request_id:id(counter++),switch_id:id(3),expected_epoch:p.control.epoch,...fields});
  const next=participantTransition(p.control,p.operation,command,request,context);Object.assign(p,next);return next.receipt;
}
function seal(a,b){step(a,'source_start',{peer_id:b.control.id});return step(a,'source_seal',{dataset_digest:'a'.repeat(64),archive_sha256:'b'.repeat(64),archive_size:'25'});}
test('speculative transfer preserves exact participant epochs and immutable handoff semantics',()=>{
  const a=peer(1),b=peer(2),sealed=seal(a,b);
  assert.equal(sealed.participant_epoch,'3');step(b,'destination_start',{peer_receipt:sealed});
  const armed=step(b,'destination_arm');assert.equal(armed.peer_epoch,'3');assert.equal(b.control.state,'armed');
  const handed=step(a,'source_handoff',{peer_receipt:armed});assert.equal(a.control.state,'handed_off');
  const activated=step(b,'destination_activate',{peer_receipt:handed});assert.equal(activated.participant_epoch,'4');
  assert.ok(b.control.awaitingSync&&b.control.everActivated);assert.equal(b.control.state,'active');
  assert.throws(()=>step(a,'source_cancel'),/migration_paused/);assert.throws(()=>step(a,'source_resume',{peer_receipt:activated}),/migration_invalid/);
});
test('cancellation first wins the source and requires a matching terminal destination discard',()=>{
  const a=peer(1),b=peer(2),sealed=seal(a,b);step(b,'destination_start',{peer_receipt:sealed});const armed=step(b,'destination_arm');
  const cancel=step(a,'source_cancel');assert.throws(()=>step(a,'source_handoff',{peer_receipt:armed}),/migration_paused/);
  const discarded=step(b,'destination_discard',{peer_receipt:cancel});step(a,'source_resume',{peer_receipt:discarded});
  assert.equal(a.control.state,'active');assert.equal(a.control.epoch,'5');assert.equal(b.operation.state,'discarded');
});
test('discard before start is a permanent tombstone for reordered requests',()=>{
  const a=peer(1),b=peer(2);step(a,'source_start',{peer_id:b.control.id});const cancel=step(a,'source_cancel');
  const discarded=step(b,'destination_discard',{peer_receipt:cancel});step(a,'source_resume',{peer_receipt:discarded});
  assert.equal(b.operation.state,'discarded');assert.equal(a.control.state,'active');
  assert.throws(()=>step(b,'destination_start',{peer_receipt:cancel}),/migration_paused/);
});
test('no speculative arm or activate is allowed without independently verified facts and identity',()=>{
  const a=peer(1),b=peer(2);step(b,'destination_start',{peer_receipt:seal(a,b)});
  assert.throws(()=>step(b,'destination_arm',{}, {...ctx,validated:false}),/migration_incomplete/);
  const handed=step(a,'source_handoff',{peer_receipt:step(b,'destination_arm')});
  assert.throws(()=>step(b,'destination_activate',{peer_receipt:handed},{...ctx,validated:false}),/migration_incomplete/);
  assert.throws(()=>step(b,'destination_activate',{peer_receipt:handed},{...ctx,eligible:false}),/migration_not_empty/);
  assert.equal(b.control.state,'armed');
});
