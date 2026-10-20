import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';

await mkdir('.local/bundle',{recursive:true});
await mkdir('.local/probes',{recursive:true});
for(const [entry,outfile] of [
  ['extension/background.js','.local/bundle/background.js'],
  ['extension/popup.js','.local/bundle/popup.js'],
  ['extension/discrepancies.js','.local/bundle/discrepancies.js'],
  ['src/local/feasibility.ts','.local/probes/feasibility.mjs'],
]) {
  const result=await build({entryPoints:[entry],outfile,bundle:true,platform:'browser',
    format:'esm',target:'chrome120',metafile:true,legalComments:'inline'});
  if(Object.values(result.metafile.outputs).some(value=>value.imports.some(i=>i.external)))throw Error('External dependency in browser bundle');
  if(Object.keys(result.metafile.inputs).some(name=>name.startsWith('node:')))throw Error('Node dependency in browser bundle');
  await writeFile(outfile+'.meta.json',JSON.stringify(result.metafile));
}
