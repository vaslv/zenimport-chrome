import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Backend, serverAddress} from '../extension/backend-client.js';
import fs from 'node:fs';

test('server address prevents credentials, paths, insecure remote and token redirects', async () => {
  for (const url of ['http://server.example','https://user:pass@example.com','https://example.com/api','https://example.com/?token=x']) {
    assert.throws(() => serverAddress(url));
  }
  assert.equal(serverAddress(' http://localhost:8000/ '), 'http://localhost:8000');
  let sent;
  const client = new Backend({url:'https://example.com',token:'fixture-secret'}, async (url, options) => {
    sent = {url, ...options}; return Response.json({api_version:1});
  });
  await client.info();
  assert.equal(sent.redirect, 'error'); assert.equal(sent.credentials, 'omit');
  assert.equal(sent.headers.Authorization, 'Bearer fixture-secret');
  assert.equal(sent.url, 'https://example.com/api/v1/info');
});
test('server errors are coded and never expose response contents', async () => {
  const config = {url:'http://localhost:8000', token:'fixture'};
  await assert.rejects(new Backend(config, async()=>Response.json({api_version:2})).info(), {code:'unsupported_api_version'});
  await assert.rejects(new Backend(config, async()=>Response.json({error:{code:'unauthorized',message:'secret'}},{status:401})).info(), {code:'unauthorized',message:'unauthorized'});
  await assert.rejects(new Backend(config, async()=>new Response('sensitive',{status:500})).info(), {code:'invalid_response'});
});
test('standalone manifest has no editor or automatic bank content injection', () => {
  const manifest = JSON.parse(fs.readFileSync('extension/manifest.json'));
  assert.equal(manifest.manifest_version,3);
  for(const key of ['options_page','devtools_page','content_scripts','web_accessible_resources','host_permissions']) assert.equal(manifest[key],undefined);
  assert.equal(fs.existsSync('extension/app.html'),false);
});

test('migration binary transfer keeps credentials private and rejects bad responses',async()=>{
  const config={url:'https://fixture.invalid',token:'fixture-token'};
  let sent;
  const backend=new Backend(config,async(url,options)=>{sent={url,...options};return new Response('fixture-zip',{headers:{'Content-Type':'application/zip'}});});
  assert.equal(await (await backend.transfer('export')).text(),'fixture-zip');
  assert.equal(sent.url,'https://fixture.invalid/api/v1/migration/export');
  assert.equal(sent.credentials,'omit');assert.equal(sent.redirect,'error');
  assert.equal(sent.headers.Authorization,'Bearer fixture-token');
  const file=new Blob(['fixture-zip']);
  const importer=new Backend(config,async(url,options)=>{sent={url,...options};return Response.json({restored:true});});
  assert.deepEqual(await importer.transfer('import',file),{restored:true});
  assert.equal(sent.body,file);assert.equal(sent.headers['Content-Type'],'application/zip');
  await assert.rejects(new Backend(config,async()=>Response.json({error:{code:'migration_not_empty',message:'private'}} ,{status:409})).transfer('import',file),{code:'migration_not_empty',message:'migration_not_empty'});
  await assert.rejects(new Backend(config,async()=>new Response('private')).transfer('export'),{code:'invalid_response'});
});
