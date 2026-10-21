import assert from 'node:assert/strict';
import test from 'node:test';
import {retainedTransactionIds} from '../.local/contracts/delivery-intents.mjs';
test('every durable transaction UUID remains unavailable for a fresh create',()=>{
  const rows={zen_entities:[{kind:'transaction',id:'current'},{kind:'account',id:'account'}],zen_tombstones:[{kind:'transaction',entity_id:'deleted'},{kind:'tag',entity_id:'tag'}],
    delivery_attempts:[{zen_id:'attempted'}],processing_receipts:[{zen_id:'received'}],processing_targets:[{zen_id:'target'}],link_zen_members:[{zen_id:'group'}],zen_exclusions:[{zen_id:'excluded'}]};
  assert.deepEqual([...retainedTransactionIds({rows})].sort(),['current','deleted','attempted','received','target','group','excluded'].sort());
});
