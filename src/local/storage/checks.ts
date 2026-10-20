/** Interpret only packaged CHECK expressions. Archived SQL is never executable. */
import {SCHEMA} from './schema.generated.js';
import type {TableName} from './schema.generated.js';
import {int64,requireStorage} from './types.js';
import type {TaggedRow} from './types.js';
import {validateCells} from './cells.js';

type Value=string|bigint|null;
type Node={kind:'literal';value:Value}|{kind:'field';name:string}|{kind:'call';name:string;args:Node[]}|
  {kind:'binary';op:string;left:Node;right:Node}|{kind:'null';value:Node;not:boolean}|
  {kind:'in';value:Node;items:Node[]}|{kind:'between';value:Node;low:Node;high:Node};

function parse(source:string,columns:readonly string[]):Node{
  const tokens:string[]=[];
  const pattern=/\s*('(?:[^']|'')*'|-?[0-9]+|[a-zA-Z_][a-zA-Z_0-9]*|<>|<=|>=|[=<>(),])/y;
  let offset=0;
  while(offset<source.length){
    const rest=source.slice(offset);if(!rest.trim())break;
    pattern.lastIndex=offset;const match=pattern.exec(source);
    requireStorage(match!==null,'schema_unsupported');tokens.push(match[1]);offset=pattern.lastIndex;
  }
  let index=0;
  const peek=(value:string)=>tokens[index]?.toUpperCase()===value;
  function take(value:string){requireStorage(peek(value),'schema_unsupported');index++;}
  function term():Node{
    const token=tokens[index++];requireStorage(token!==undefined,'schema_unsupported');
    if(token==='('){const node=or();take(')');return node;}
    if(token.startsWith("'"))return {kind:'literal',value:token.slice(1,-1).replace(/''/g,"'")};
    if(/^-?[0-9]+$/.test(token))return {kind:'literal',value:BigInt(token)};
    const name=token.toLowerCase();
    if(name==='null')return {kind:'literal',value:null};
    if(peek('(')){
      requireStorage(['length','trim','json_valid','money_valid'].includes(name),'schema_unsupported');
      take('(');const args=[or()];while(peek(',')){take(',');args.push(or());}take(')');
      requireStorage(args.length===1,'schema_unsupported');return {kind:'call',name,args};
    }
    requireStorage(columns.includes(name),'schema_unsupported');return {kind:'field',name};
  }
  function comparison():Node{
    const value=term();
    if(peek('IS')){take('IS');const not=peek('NOT');if(not)take('NOT');take('NULL');return {kind:'null',value,not};}
    if(peek('IN')){
      take('IN');take('(');const items=[term()];while(peek(',')){take(',');items.push(term());}take(')');return {kind:'in',value,items};
    }
    if(peek('BETWEEN')){take('BETWEEN');const low=term();take('AND');return {kind:'between',value,low,high:term()};}
    if(['=','<>','<=','>=','<','>'].includes(tokens[index])){const op=tokens[index++];return {kind:'binary',op,left:value,right:term()};}
    return value;
  }
  function and():Node{
    let left=comparison();while(peek('AND')){take('AND');left={kind:'binary',op:'AND',left,right:comparison()};}return left;
  }
  function or():Node{
    let left=and();while(peek('OR')){take('OR');left={kind:'binary',op:'OR',left,right:and()};}return left;
  }
  const node=or();requireStorage(index===tokens.length,'schema_unsupported');return node;
}

function truth(value:Value):boolean|null{
  if(value===null)return null;
  requireStorage(typeof value==='bigint','schema_unsupported');return value!==0n;
}

function bit(value:boolean|null):Value{return value===null?null:value?1n:0n;}

function validJson(value:string):boolean{
  // The pinned SQLite 3.40.1 reference accepts 2,000 nested containers.
  // JSON.parse alone accepts deeper documents. Later SQLite versions changed
  // this limit; independent reference vectors make that a reviewed change.
  const input=value.split('\0',1)[0];
  let depth=0,quoted=false,escaped=false;
  for(const character of input){
    if(quoted){
      if(escaped)escaped=false;
      else if(character==='\\')escaped=true;
      else if(character==='"')quoted=false;
    }else if(character==='"')quoted=true;
    else if(character==='['||character==='{'){if(++depth>2000)return false;}
    else if(character===']'||character==='}')depth--;
  }
  try{JSON.parse(input);return true;}catch{return false;}
}

function compare(left:Value,right:Value):number|null{
  if(left===null||right===null)return null;
  requireStorage(typeof left===typeof right,'schema_unsupported');
  if(typeof left==='bigint' && typeof right==='bigint')return left<right?-1:left>right?1:0;
  requireStorage(typeof left==='string' && typeof right==='string','schema_unsupported');
  const a=new TextEncoder().encode(left),b=new TextEncoder().encode(right);
  for(let i=0;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i])return a[i]<b[i]?-1:1;
  return a.length<b.length?-1:a.length>b.length?1:0;
}

function evaluate(node:Node,fields:Readonly<Record<string,Value>>):Value{
  if(node.kind==='literal')return node.value;
  if(node.kind==='field'){requireStorage(Object.hasOwn(fields,node.name),'invalid_row');return fields[node.name];}
  if(node.kind==='null'){const missing=evaluate(node.value,fields)===null;return bit(node.not?!missing:missing);}
  if(node.kind==='call'){
    const value=evaluate(node.args[0],fields);
    if(node.name==='json_valid'){
      if(value===null)return 0n;
      requireStorage(typeof value==='string','schema_unsupported');
      // Syntax only: never use or persist the parsed values. SQLite's JSON1
      // function stops at an embedded NUL; graph/SDK decoding is a stronger gate.
      return bit(validJson(value));
    }
    if(node.name==='money_valid')return bit(typeof value==='string' && /^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/.test(value) && /[1-9]/.test(value));
    if(value===null)return null;
    requireStorage(typeof value==='string','schema_unsupported');
    if(node.name==='trim')return value.replace(/^ +| +$/g,'');
    return BigInt(Array.from(value.split('\0',1)[0]).length);
  }
  if(node.kind==='in'){
    const value=evaluate(node.value,fields);let unknown=false;
    for(const item of node.items){const result=compare(value,evaluate(item,fields));if(result===0)return 1n;if(result===null)unknown=true;}
    return unknown?null:0n;
  }
  if(node.kind==='between'){
    const value=evaluate(node.value,fields),low=compare(value,evaluate(node.low,fields)),high=compare(value,evaluate(node.high,fields));
    if(low!==null && low<0 || high!==null && high>0)return 0n;
    return low===null||high===null?null:1n;
  }
  const left=evaluate(node.left,fields),right=evaluate(node.right,fields);
  if(node.op==='AND'||node.op==='OR'){
    const a=truth(left),b=truth(right);
    if(node.op==='AND')return bit(a===false||b===false?false:a===null||b===null?null:true);
    return bit(a===true||b===true?true:a===null||b===null?null:false);
  }
  const order=compare(left,right);if(order===null)return null;
  return bit(node.op==='='?order===0:node.op==='<>'?order!==0:node.op==='<'?order<0:node.op==='>'?order>0:node.op==='<='?order<=0:order>=0);
}

const compiled=new Map<string,Node>();

/** Exposed internally for independent SQLite vectors, not arbitrary SQL. */
export function checkResult(table:TableName,expression:string,input:Readonly<Record<string,string|null>>):'true'|'false'|'unknown'{
  requireStorage(Object.hasOwn(SCHEMA,table),'schema_unsupported');
  const definition=SCHEMA[table];requireStorage((definition.checks as readonly string[]).includes(expression),'schema_unsupported');
  const key=table+'\0'+expression;
  let node=compiled.get(key);
  if(!node){node=parse(expression,definition.columns.map(column=>column.name));compiled.set(key,node);}
  const fields:Record<string,Value>={};
  for(const column of definition.columns){
    const value=input[column.name];requireStorage(value===null||typeof value==='string');
    fields[column.name]=value===null?null:column.type==='INTEGER'?BigInt(int64(value)):value;
  }
  const result=truth(evaluate(node,fields));return result===null?'unknown':result?'true':'false';
}

export function validateChecks(table:TableName,input:unknown):TaggedRow{
  const row=validateCells(table,input);
  const fields=Object.fromEntries(SCHEMA[table].columns.map((column,i)=>[column.name,row[i][0]==='null'?null:row[i][1]]));
  for(const expression of SCHEMA[table].checks)requireStorage(checkResult(table,expression,fields)!=='false','constraint_violation');
  return row;
}
