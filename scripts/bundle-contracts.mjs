import {build} from 'esbuild';
await build({entryPoints:['src/domain/prediction/categories.ts'],outfile:'.local/contracts/category-prediction.mjs',bundle:true,platform:'browser',format:'esm',target:'chrome140'});
for(const name of ['subsets','matching','ownership'])await build({entryPoints:['src/domain/reconciliation/'+name+'.ts'],outfile:'.local/contracts/reconciliation-'+name+'.mjs',bundle:true,platform:'browser',format:'esm',target:'chrome140'});
for(const [entry,name]of [['src/domain/periods.ts','periods'],['src/local/capture/validation.ts','capture-validation']])await build({entryPoints:[entry],outfile:'.local/contracts/'+name+'.mjs',bundle:true,platform:'browser',format:'esm',target:'chrome140'});
for(const name of ['projection','reader','credentials','mirror','catalog'])await build({entryPoints:['src/local/zenmoney/'+name+'.ts'],outfile:'.local/contracts/zenmoney-'+name+'.mjs',
  bundle:true,platform:'browser',format:'esm',target:'chrome140'});
await build({entryPoints:['extension/background-runtime.js'],outfile:'.local/contracts/background.mjs',
  bundle:true,platform:'browser',format:'esm',target:'chrome140'});
await build({entryPoints:['src/application/runtime.ts'],outfile:'.local/contracts/application-runtime.mjs',
  bundle:true,platform:'browser',format:'esm',target:'chrome140'});
for(const name of ['messages','rpc','control-api','control-messages'])await build({entryPoints:['src/application/'+name+'.ts'],outfile:'.local/contracts/application-'+name+'.mjs',
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
await build({entryPoints:['src/local/reconciliation/facts.ts'],outfile:'.local/contracts/source-facts.mjs',bundle:true,platform:'browser',format:'esm',target:'chrome140'});
await build({entryPoints:['src/local/reports/build.ts'],outfile:'.local/contracts/discrepancy-report.mjs',bundle:true,platform:'browser',format:'esm',target:'chrome140'});
await build({entryPoints:['src/local/reconciliation/plan.ts'],outfile:'.local/contracts/reconciliation-plan.mjs',bundle:true,platform:'browser',format:'esm',target:'chrome140'});
await build({entryPoints:['src/local/reconciliation/known.ts'],outfile:'.local/contracts/reconciliation-known.mjs',bundle:true,platform:'browser',format:'esm',target:'chrome140'});

await build({entryPoints:['src/local/storage/category-control.ts'],outfile:'.local/contracts/category-control.mjs',bundle:true,platform:'browser',format:'esm',target:'chrome140'});

await build({entryPoints:['src/local/storage/authorization-queue.ts'],outfile:'.local/contracts/authorization-queue.mjs',bundle:true,platform:'browser',format:'esm',target:'chrome140'});

await build({entryPoints:['src/local/delivery/intents.ts'],outfile:'.local/contracts/delivery-intents.mjs',bundle:true,platform:'browser',format:'esm',target:'chrome140'});

await build({entryPoints:['src/local/storage/outbox-control.ts'],outfile:'.local/contracts/outbox-control.mjs',bundle:true,platform:'browser',format:'esm',target:'chrome140'});
await build({entryPoints:['src/local/delivery/alarms.ts'],outfile:'.local/contracts/delivery-alarms.mjs',bundle:true,platform:'browser',format:'esm',target:'chrome140'});
await build({entryPoints:['src/local/migration/remote.ts'],outfile:'.local/contracts/migration-remote.mjs',bundle:true,platform:'browser',format:'esm',target:'chrome140'});
await build({entryPoints:['src/local/migration/wire.ts'],outfile:'.local/contracts/migration-wire.mjs',bundle:true,platform:'browser',format:'esm',target:'chrome140'});

await build({entryPoints:['src/local/migration/journal.ts'],outfile:'.local/contracts/migration-journal.mjs',bundle:true,platform:'browser',format:'esm',target:'chrome140'});
await build({entryPoints:['src/local/migration/credentials.ts'],outfile:'.local/contracts/migration-credentials.mjs',bundle:true,platform:'browser',format:'esm',target:'chrome140'});
await build({entryPoints:['src/local/migration/runner.ts'],outfile:'.local/contracts/migration-runner.mjs',bundle:true,platform:'browser',format:'esm',target:'chrome140'});

await build({entryPoints:['extension/background-controls.js'],outfile:'.local/contracts/background-controls.mjs',bundle:true,platform:'browser',format:'esm',target:'chrome140'});
