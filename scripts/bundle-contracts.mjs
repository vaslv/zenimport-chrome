import {build} from 'esbuild';
await build({entryPoints:['src/contracts/runner.ts'],outfile:'.local/contracts/runner.mjs',
  bundle:true,platform:'browser',format:'esm',target:'chrome140'});
await build({entryPoints:['src/local/storage/cells.ts'],outfile:'.local/contracts/storage-cells.mjs',
  bundle:true,platform:'browser',format:'esm',target:'chrome140'});
