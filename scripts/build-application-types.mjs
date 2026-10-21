import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const source=new URL('../contracts/business/v1/wire-v1.json',import.meta.url);
const raw=await readFile(source),models=JSON.parse(raw),manifest=JSON.parse(await readFile(new URL('manifest.json',source),'utf8'));
if(createHash('sha256').update(raw).digest('hex')!==manifest.files['wire-v1.json'])throw Error('Unpinned wire contract');
const definitions={};
for(const [name,schema]of Object.entries(models))definitions[name]=schema;
for(const schema of Object.values(models))for(const [name,definition]of Object.entries(schema.$defs??{})){
  if(!Object.hasOwn(definitions,name))definitions[name]=definition;
}
function type(schema){
  if(schema.$ref){const name=schema.$ref.split('/').at(-1);if(!definitions[name])throw Error('Unknown model '+name);return name;}
  if(schema.const!==undefined)return JSON.stringify(schema.const);
  if(schema.enum)return schema.enum.map(value=>JSON.stringify(value)).join(' | ');
  if(schema.anyOf)return '('+schema.anyOf.map(type).join(' | ')+')';
  if(schema.type==='null')return 'null';
  if(['string','boolean'].includes(schema.type))return schema.type;
  if(['number','integer'].includes(schema.type))return 'number';
  if(schema.type==='array')return 'Array<'+type(schema.items)+'>';
  if(schema.type==='object'){
    if(!schema.properties)return 'Record<string, '+(typeof schema.additionalProperties==='object'?type(schema.additionalProperties):'unknown')+'>';
    return '{ '+Object.entries(schema.properties).map(([name,field])=>JSON.stringify(name)+((schema.required??[]).includes(name)?'':'?')+': '+type(field)+';').join(' ')+' }';
  }
  throw Error('Unsupported wire schema '+JSON.stringify(schema));
}
const output='/** Generated from pinned wire-v1.json. Regenerate, do not edit. */\n'+
  Object.keys(definitions).sort().map(name=>'export type '+name+' = '+type(definitions[name])+';').join('\n')+'\n';
for(const schema of Object.values(models))for(const [name,definition]of Object.entries(schema.$defs??{}))
  if(type(definitions[name])!==type(definition))throw Error('Conflicting model '+name);
const target=new URL('../src/application/dto.generated.ts',import.meta.url);
if(process.argv.includes('--check')){if(await readFile(target,'utf8')!==output)throw Error('Regenerate application DTOs');}
else{await mkdir(new URL('../src/application/',import.meta.url),{recursive:true});await writeFile(target,output);}
console.log('PASS: pinned application DTOs');
