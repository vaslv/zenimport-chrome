import {build} from 'esbuild';
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
