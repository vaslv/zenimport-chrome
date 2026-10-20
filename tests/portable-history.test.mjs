import assert from 'node:assert/strict';
import test from 'node:test';
import {validateHistory} from '../.local/contracts/portable-format.mjs';
import {current,legacy,offset,reader} from './portable-fixture-reader.mjs';

test('complete current and legacy journals retain create-once history without resuming a send',async()=>{
  for(const fixture of [current,legacy])await validateHistory(reader(fixture.rows));
});

test('attempt identity, exact payload and explicit authorization remain mandatory after migration',async()=>{
  for(const [problem,code]of [['missing_attempt','missing_attempt_evidence'],['different_payload','missing_attempt_evidence'],
    ['missing_authorization','missing_attempt_authorization'],['wrong_job','missing_attempt_authorization'],
    ['authorization_job','invalid_authorization_job'],['attempt_id','invalid_attempt_identity'],
    ['delivery_id','invalid_attempt_identity'],['attempting','delivery_not_quiescent']]){
    const rows=structuredClone(current.rows);
    if(problem==='missing_attempt')rows.delivery_attempts=[];
    if(problem==='different_payload'){
      const index=offset('delivery_attempts','payload');for(const row of rows.delivery_attempts)row[index]=['text',row[index][1]+' '];
    }
    if(problem==='missing_authorization')rows.delivery_authorizations=[];
    if(problem==='wrong_job')for(const row of rows.deliveries)row[offset('deliveries','authorized_job_id')]=['text','wrong-job'];
    if(problem==='authorization_job')rows.delivery_authorizations[0][offset('delivery_authorizations','job_id')]=['text','wrong-job'];
    if(problem==='attempt_id')rows.delivery_attempts[0][offset('delivery_attempts','payload')]=['text','{"id":"another-uuid"}'];
    if(problem==='delivery_id')rows.deliveries[0][offset('deliveries','payload')]=['text','{"id":"another-uuid"}'];
    if(problem==='attempting')rows.deliveries[0][offset('deliveries','state')]=['text','attempting'];
    await assert.rejects(validateHistory(reader(rows)),{code},problem);
  }
});

test('terminal receipts survive soft deletion and cannot become pending delivery again',async()=>{
  const rows=structuredClone(current.rows);rows.bank_processing[0][offset('bank_processing','state')]=['text','pending'];
  await assert.rejects(validateHistory(reader(rows)),{code:'terminal_history_conflict'});
  const missing=structuredClone(current.rows);missing.processing_receipts=[];missing.link_bank_members=[];
  await assert.rejects(validateHistory(reader(missing)),{code:'missing_terminal_proof'});
  const suppressed=structuredClone(current.rows);
  for(const row of suppressed.bank_processing)row[offset('bank_processing','state')]=['text','suppressed'];
  await validateHistory(reader(suppressed));
  const locked=structuredClone(current.rows);locked.source_capture_leases.push([['text','unused'],['text','unused']]);
  await assert.rejects(validateHistory(reader(locked)),{code:'capture_not_quiescent'});
});
