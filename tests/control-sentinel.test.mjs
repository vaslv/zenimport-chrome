import assert from 'node:assert/strict';
import test from 'node:test';
import {trustedSentinel,validateSentinel} from '../.local/contracts/control-sentinel.mjs';
import {datasetControl,runtimeControl} from '../.local/contracts/control-validation.mjs';

const marker={version:'1',installationId:'00000000-0000-4000-8000-000000000001',datasetId:'00000000-0000-4000-8000-000000000002',
  generation:'00000000-0000-4000-8000-000000000003',state:'initializing',financialMayHaveStarted:false};

function area(){
  const data={};let protectedArea=false;
  return {data,
    async setAccessLevel(options){assert.equal(options.accessLevel,'TRUSTED_CONTEXTS');protectedArea=true;},
    async get(keys){assert.ok(protectedArea);return Object.fromEntries(keys.filter(key=>Object.hasOwn(data,key)).map(key=>[key,structuredClone(data[key])]));},
    async set(values){assert.ok(protectedArea);for(const [key,value]of Object.entries(values))data[key]=Object.fromEntries(Object.entries(structuredClone(value)).sort(([a],[b])=>a<b?-1:1));},
  };
}

test('sentinel acknowledgment compares values even when native storage reorders fields',async()=>{
  const native=area(),port=trustedSentinel(native);
  assert.equal(await port.read(),null);
  await port.create(marker);
  assert.deepEqual(await port.read(),marker);
  await port.acknowledgeReady({...marker,state:'ready'});
  assert.equal((await port.read()).state,'ready');
});

test('activity survives stale base writes and unrelated credential-key deletion',async()=>{
  const native=area(),port=trustedSentinel(native);
  await port.create(marker);await port.acknowledgeReady({...marker,state:'ready'});
  await port.markFinancialActivity(marker.installationId);
  assert.equal(native.data.localDatasetSentinel.financialMayHaveStarted,false);
  native.data.localDatasetSentinel={...marker,state:'ready'};
  native.data.syntheticCredential='synthetic';delete native.data.syntheticCredential;
  assert.equal((await port.read()).financialMayHaveStarted,true);
});

test('a surviving activity key without its base can never appear to be a new install',async()=>{
  const native=area(),port=trustedSentinel(native);
  await port.create(marker);await port.acknowledgeReady({...marker,state:'ready'});await port.markFinancialActivity(marker.installationId);
  delete native.data.localDatasetSentinel;
  await assert.rejects(port.read(),/recovery_required/);
});

test('existing marker and wrong activity owner fail without overwriting identity',async()=>{
  const native=area(),port=trustedSentinel(native);
  await port.create(marker);
  await assert.rejects(port.create({...marker,installationId:marker.datasetId}),/recovery_required/);
  await assert.rejects(port.acknowledgeReady({...marker,generation:marker.datasetId,state:'ready'}),/recovery_required/);
  assert.deepEqual(await port.read(),marker);
  native.data.localDatasetSentinelActivity={installationId:marker.datasetId,started:true};
  await assert.rejects(port.read(),/storage_corrupt/);
});

test('marker validation rejects unknown fields and nonboolean activity state',()=>{
  assert.throws(()=>validateSentinel({...marker,privateToken:'synthetic-private'}),error=>error.message==='storage_corrupt');
  assert.throws(()=>validateSentinel({...marker,financialMayHaveStarted:0}),/storage_corrupt/);
});

test('runtime metadata requires exact string epochs and does not coerce local scope',()=>{
  const value={id:'runtime',installationId:marker.installationId,activeMode:'local',activeGeneration:marker.generation,
    epoch:'9007199254740993',pendingSwitchId:null,credentialRef:null,credentialEpoch:'1',financialMayHaveStarted:false};
  assert.deepEqual(runtimeControl(value),value);
  for(const change of [{epoch:1},{epoch:'-0'},{activeGeneration:null},{activeMode:'unexpected'},{secret:'synthetic'}])assert.throws(()=>runtimeControl({...value,...change}));
});

test('dataset descriptors separate profile, participant and financial lineage identities',()=>{
  const value={generation:marker.generation,datasetId:marker.datasetId,participantId:'00000000-0000-4000-8000-000000000004',
    participantEpoch:'1',logicalSchemaVersion:'1',lifecycle:'active',ownerIds:['1','2'],holdId:null,createdAt:'1792540800',backupAcknowledgedAt:null};
  assert.deepEqual(datasetControl(value),value);
  for(const change of [{participantEpoch:'0'},{logicalSchemaVersion:'2'},{ownerIds:['1','1']},{lifecycle:['active']}])assert.throws(()=>datasetControl({...value,...change}));
});
