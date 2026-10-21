import {build} from 'esbuild';
for(const name of ['subsets','matching'])await build({entryPoints:['src/domain/reconciliation/'+name+'.ts'],outfile:'.local/contracts/reconciliation-'+name+'.mjs',bundle:true,platform:'browser',format:'esm',target:'chrome140'});
for(const [entry,name]of [['src/domain/periods.ts','periods'],['src/local/capture/validation.ts','capture-validation']])await build({entryPoints:[entry],outfile:'.local/contracts/'+name+'.mjs',bundle:true,platform:'browser',format:'esm',target:'chrome140'});
for(const name of ['projection','reader','credentials','mirror','catalog'])await build({entryPoints:['src/local/zenmoney/'+name+'.ts'],outfile:'.local/contracts/zenmoney-'+name+'.mjs',
  bundle:true,platform:'browser',format:'esm',target:'chrome140'});
await build({entryPoints:['extension/background-runtime.js'],outfile:'.local/contracts/background.mjs',
  bundle:true,platform:'browser',format:'esm',target:'chrome140'});
await build({entryPoints:['src/application/runtime.ts'],outfile:'.local/contracts/application-runtime.mjs',
  bundle:true,platform:'browser',format:'esm',target:'chrome140'});
for(const name of ['messages','rpc'])await build({entryPoints:['src/application/'+name+'.ts'],outfile:'.local/contracts/application-'+name+'.mjs',
  bundle:true,platform:'browser',format:'esm',target:'chrome140'});
await build({entryPoints:['src/application/remote.ts'],outfile:'.local/contracts/application-remote.mjs',
  bundle:true,platform:'browser',format:'esm',target:'chrome140'});
await build({entryPoints:['src/contracts/runner.ts'],outfile:'.local/contracts/runner.mjs',
  bundle:true,platform:'browser',format:'esm',target:'chrome140'});
await build({entryPoints:['src/local/storage/cells.ts'],outfile:'.local/contracts/storage-cells.mjs',
  bundle:true,platform:'browser',format:'esm',target:'chrome140'});
await build({entryPoints:['src/local/storage/checks.ts'],outfile:'.local/contracts/storage-checks.mjs',
  bundle:true,platform:'browser',format:'esm',target:'chrome140'});
await build({entryPoints:['src/local/portable/probe.ts'],outfile:'.local/contracts/portable-format.mjs',
  bundle:true,platform:'browser',format:'esm',target:'chrome140'});
for(const name of ['types','stage-types'])await build({entryPoints:['src/local/storage/'+name+'.ts'],outfile:'.local/contracts/storage-'+name+'.mjs',
  bundle:true,platform:'browser',format:'esm',target:'chrome140'});
await build({entryPoints:['src/local/storage/participant-transition.ts'],outfile:'.local/contracts/participant-transition.mjs',
  bundle:true,platform:'browser',format:'esm',target:'chrome140'});
for(const name of ['sentinel','validation','participant-wire'])await build({entryPoints:['src/control/'+name+'.ts'],outfile:'.local/contracts/control-'+name+'.mjs',
  bundle:true,platform:'browser',format:'esm',target:'chrome140'});
