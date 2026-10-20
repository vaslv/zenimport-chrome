import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const base=new URL('../contracts/business/v1/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
async function input(name){
  const raw=await readFile(new URL(name,base));
  if(createHash('sha256').update(raw).digest('hex')!==manifest.files[name])throw Error('Unpinned storage input');
  return JSON.parse(raw);
}
const source=await input('sqlite-v7.json'),policy=await input('portable-policy.json');
const format=await input('portable-format-v2.json'),manifestSchema=await input('portable-v2.schema.json'),validation=await input('portable-validation-v2.json');
const archiveValues=await input('archive-value-vectors.json');
if(archiveValues.unicode_version!=='15.0.0')throw Error('Unexpected archive Unicode version');
const aliases=Object.fromEntries(Object.entries(policy.logical_tables).map(([logical,table])=>[table.source,logical]));
const tables={};
for(const [name,mapping]of Object.entries(policy.logical_tables)){
  const definition=source.tables[mapping.source];
  if(definition.columns.some(column=>!['TEXT','INTEGER'].includes(column.type)))throw Error('Unsupported storage scalar');
  tables[name]={source:mapping.source,columns:definition.columns.map(column=>({name:column.name,type:column.type,required:column.logical_required,pk:column.pk})),
    primary:definition.columns.filter(column=>column.pk).sort((a,b)=>a.pk-b.pk).map(column=>column.name),
    indexes:definition.indexes.filter(index=>index.origin!=='pk').map((index,i)=>{
      if(index.columns.some(column=>typeof column.name!=='string'))throw Error('Expression index needs explicit implementation');
      if(index.partial && index.name!=='one_active_capture')throw Error('Unknown partial index');
      return {key:'i'+i,name:index.name,columns:index.columns.map(column=>column.name),unique:!!index.unique,
        partial:index.partial?{column:'capture_state',values:['planned','collecting','paused']}:null};
    }),
    foreignKeys:Object.values(Object.groupBy(definition.foreign_keys,key=>String(key.id))).map(parts=>{
      parts.sort((a,b)=>a.seq-b.seq);
      return {table:aliases[parts[0].table],columns:parts.map(part=>part.from),target:parts.map(part=>part.to),onDelete:parts[0].on_delete};
    }),checks:definition.checks,triggers:definition.triggers.map(trigger=>({name:trigger.name,sql:trigger.sql}))};
}
const types=Object.entries(tables).map(([name,table])=>`${JSON.stringify(name)}: {\n${table.columns.map(column=>`  readonly ${column.name}: ${column.type==='INTEGER'?'Int64Text':'string'}${column.required?'':' | null'};`).join('\n')}\n}`).join(';\n');
const output='/** Generated from the pinned logical contract. Do not edit by hand. */\n'+
  "import type {Int64Text} from './types.js';\n"+
  'export const SCHEMA = '+JSON.stringify(tables,null,2)+' as const;\n'+
  'export type TableName = keyof typeof SCHEMA;\nexport interface RowByTable {\n'+types+';\n}\n';
const path=new URL('../src/local/storage/schema.generated.ts',import.meta.url);
const portablePath=new URL('../src/local/portable/contract.generated.ts',import.meta.url);
const validationPath=new URL('../src/local/portable/validation.generated.ts',import.meta.url);
const revision=createHash('sha256').update(JSON.stringify({schema:source,policy,manifest:manifestSchema,format,validation})+'\n').digest('hex');
const portable='/** Generated from the pinned portable contract. Do not edit by hand. */\n'+
  'export const PORTABLE = '+JSON.stringify({limits:policy.limits,features:format.required_features,manifestKeys:manifestSchema.required,revision})+' as const;\n';
const validationOutput='/** Generated inert validation data. Archived SQL is never executable. */\n'+
  'export const VALIDATION = '+JSON.stringify(validation)+' as const;\n'+
  'export const PYTHON_WORD_RANGES = '+JSON.stringify(archiveValues.word_ranges)+' as const;\n';
if(process.argv.includes('--check')){
  if(await readFile(path,'utf8')!==output)throw Error('Regenerate the pinned storage schema');
  if(await readFile(portablePath,'utf8')!==portable)throw Error('Regenerate the pinned portable contract');
  if(await readFile(validationPath,'utf8')!==validationOutput)throw Error('Regenerate the pinned graph validation data');
}else{
  await mkdir(new URL('../src/local/storage/',import.meta.url),{recursive:true});await writeFile(path,output);
  await mkdir(new URL('../src/local/portable/',import.meta.url),{recursive:true});await writeFile(portablePath,portable);
  await writeFile(validationPath,validationOutput);
}
console.log('PASS: 49 logical storage tables and typed rows');
