import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = new URL('../contracts/business/v1/', import.meta.url);
const load = name => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
const validator = () => addFormats(new Ajv2020({strict:true, allErrors:true, coerceTypes:false, removeAdditional:false, useDefaults:false}));

test('frozen contracts have all 49 tables, repository owners and named invariant cases', () => {
  const {tables,service_meta:meta} = load('sqlite-v7.json');
  const cases = load('storage-cases.json').cases;
  assert.equal(Object.keys(tables).length,49);
  assert.equal(cases.length,49);
  for(const [name,table] of Object.entries(tables)) {
    assert.ok(table.repository.endsWith('Repository'));
    assert.ok(table.disposition);
    assert.ok(cases.some(c=>c.table===name && c.id===table.invariant_case));
    for(const column of table.columns.filter(c=>c.pk))assert.equal(column.logical_required,true);
    for(const fk of table.foreign_keys)assert.ok(tables[fk.table]);
  }
  assert.equal(meta['legacy:*'],'reject_until_explicitly_classified_including_secret_screening');
  assert.ok(tables.capture_jobs.indexes.some(i=>i.unique===1 && i.partial===1));
  assert.ok(tables.zen_tags.foreign_keys.some(f=>f.on_delete==='CASCADE'));
  assert.ok(tables.deliveries.triggers.some(t=>t.name==='delivery_immutable'));
});

test('strict shared scenario schema validates planned fixtures without executing their behavior', () => {
  const ajv=validator(), validate=ajv.compile(load('scenario.schema.json'));
  for(const name of readdirSync(new URL('scenarios/',root))) {
    const scenario=load('scenarios/'+name);
    assert.equal(validate(scenario),true,JSON.stringify(validate.errors));
    assert.equal(validate({...scenario,token:'not-a-secret'}),false);
    assert.equal(validate({...scenario,clock:1792458000}),false);
    assert.equal(validate({...scenario,commands:[{operation:'unknown',input:{}}]}),false);
  }
});

test('current wire schemas accept public examples without value coercion', () => {
  const models=load('wire-v1.json'), examples=load('wire-examples-v1.json');
  for(const [name,value] of Object.entries(examples)) {
    const validate=validator().compile(models[name]);
    const before=JSON.stringify(value);
    assert.equal(validate(value),true,`${name}: ${JSON.stringify(validate.errors)}`);
    assert.equal(JSON.stringify(value),before);
  }
  const validate=validator().compile(models.BankRecord ?? models.CapturePage.$defs.BankRecord);
  const original=examples.CapturePage.records[0];
  assert.equal(validate({...original,amount:100}),false);
  assert.equal(validate({...original,amount:'123456789012345678901234.123456789012'}),true);
  assert.equal(validate({...original,token:'not-a-secret'}),false);
});

test('portable schema distinguishes exact tagged values and rejects unknown manifest fields', () => {
  const schema=load('portable-v2.schema.json'), ajv=validator();
  ajv.addSchema(schema);
  const scalar=ajv.getSchema(schema.$id+'#/$defs/scalar');
  for(const value of [['null'],['integer','9007199254740993'],['text','1.000000000001'],['blob','AAEC']])assert.equal(scalar(value),true);
  for(const value of [null,1,['integer',9007199254740993],['integer','01'],['integer','-0'],['integer','1e3'],['blob','?'],['null',''],['float','1.1']])assert.equal(scalar(value),false);
  const id='00000000-0000-4000-8000-000000000001', digest='0'.repeat(64);
  const manifest={format:'zenimport-portable',archive_version:2,financial_schema_version:1,
    archive_id:id,dataset_id:id,export_session_id:id,created_at:'2026-10-20T12:00:00Z',
    producer:{version:'fixture',engine:'sqlite',contract_revision:digest},
    zenmoney_identity:{owner_ids:['1'],proof_version:1},required_features:[],dataset_digest:digest,
    tables:[{name:'connections',filename:'tables/connections.ndjson',columns:['id'],rows:'0',bytes:'0',sha256:digest}]};
  const validate=ajv.getSchema(schema.$id);
  assert.equal(validate(manifest),true,JSON.stringify(validate.errors));
  assert.equal(validate({...manifest,token:'not-a-secret'}),false);
  assert.equal(validate({...manifest,archive_version:1}),false);
  assert.equal(validate({...manifest,tables:[{...manifest.tables[0],rows:0}]}),false);
  assert.equal(validate({...manifest,tables:[{...manifest.tables[0],filename:'../../escape'}]}),false);
});

test('contract manifest pins every artifact, so unreviewed fixture drift fails', () => {
  const manifest=load('manifest.json');
  const files=[];
  function walk(directory,prefix='') {
    for(const entry of readdirSync(directory,{withFileTypes:true})) {
      const name=prefix+entry.name;
      if(entry.isDirectory())walk(new URL(entry.name+'/',directory),name+'/');
      else if(name!=='manifest.json')files.push(name);
    }
  }
  walk(root);
  assert.deepEqual(Object.keys(manifest.files).sort(),files.sort());
  for(const [name,expected] of Object.entries(manifest.files))assert.equal(createHash('sha256').update(readFileSync(new URL(name,root))).digest('hex'),expected,name);
});

test('transport-independent operations cover the frozen route families and financial rules', () => {
  const methods=load('application.json').operations.map(o=>o.name);
  assert.equal(new Set(methods).size,methods.length);
  for(const name of ['capture.start','capture.page','capture.complete','mirror.refresh','delivery.advance','reports.discrepancies','migration.transition'])assert.ok(methods.includes(name));
  const routes=load('http-routes-v1.json').routes;
  assert.equal(routes.length,21);
  for(const path of ['/api/v1/info','/api/v1/migration/resume','/api/v1/jobs'])assert.ok(routes.some(r=>r.path===path));
  assert.equal(load('rules.json').rules.length,15);
});

test('the SDK dependency resolves to the verified public npm release',()=>{
  const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
  const pin=load('baseline.json').sdk;
  assert.equal(lock.packages['node_modules/zenmoney-typescript'].version,pin.version);
  assert.equal(lock.packages['node_modules/zenmoney-typescript'].integrity,pin.integrity);
  assert.equal(lock.packages['node_modules/zenmoney-typescript'].resolved,'https://registry.npmjs.org/zenmoney-typescript/-/zenmoney-typescript-0.1.0.tgz');
});
