/** Bounded archive JSON. HTTP response decoding remains the SDK's concern. */
import {ExactDecimal,MAX_NUMBER_LENGTH} from 'zenmoney-typescript';

const MAX_NODES=5000000,MAX_DEPTH=128;
function unicode(text:string):void{
  for(let i=0;i<text.length;i++){
    const code=text.charCodeAt(i);
    if(code>=0xd800&&code<=0xdbff){const low=text.charCodeAt(++i);if(!(low>=0xdc00&&low<=0xdfff))throw new TypeError('invalid_unicode');}
    else if(code>=0xdc00&&code<=0xdfff)throw new TypeError('invalid_unicode');
  }
}

// Native JSON.parse owns the grammar. This preflight bounds allocation, rejects
// duplicate decoded keys, and checks nesting before the recursive reviver runs.
function preflight(text:string):void{
  const stack:{object:boolean;key:boolean;seen:Set<string>}[]=[];let nodes=0;
  function node():void{if(++nodes>MAX_NODES)throw new TypeError('json_budget_exceeded');}
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"'){
      const start=i++;
      for(;i<text.length;i++){if(text[i]==='\\'){i++;continue;}if(text[i]==='"')break;}
      const context=stack.at(-1);
      if(context?.object&&context.key){
        const key:unknown=JSON.parse(text.slice(start,i+1));
        if(typeof key!=='string'||context.seen.has(key))throw new TypeError('duplicate_key');
        unicode(key);context.seen.add(key);context.key=false;
      }else node();
    }else if(ch==='{'||ch==='['){
      node();if(stack.length>=MAX_DEPTH)throw new TypeError('json_budget_exceeded');
      stack.push({object:ch==='{',key:ch==='{',seen:new Set()});
    }else if(ch==='}'||ch===']')stack.pop();
    else if(ch===','&&stack.at(-1)?.object)stack.at(-1)!.key=true;
    else if(ch==='-'||(ch>='0'&&ch<='9')){
      node();const start=i;
      while(i+1<text.length&&/[\deE+.-]/.test(text[i+1]))i++;
      if(i-start+1>MAX_NUMBER_LENGTH)throw new TypeError('number_budget_exceeded');
    }else if(ch==='t'||ch==='f'||ch==='n'){node();i+=ch==='f'?4:3;}
  }
}

/** Recover numeric tokens from source, never from an already rounded Number. */
export function archiveJson(raw:string|Uint8Array,integersOnly=false):unknown{
  const text=typeof raw==='string'?raw:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);
  unicode(text);preflight(text);
  // context.source is mandatory on Chrome 140+. Unsupported engines fail closed.
  const parse=JSON.parse as (text:string,reviver:(key:string,value:unknown,context?:{source?:string})=>unknown)=>unknown;
  return parse(text,(_key,value,context)=>{
    if(typeof value==='string')unicode(value);
    if(typeof value!=='number')return value;
    const token=context?.source;
    if(typeof token!=='string'||token.length>MAX_NUMBER_LENGTH)throw new TypeError('missing_numeric_source');
    if(/[.eE]/.test(token)){
      if(integersOnly)throw new TypeError('unexpected_decimal');
      return new ExactDecimal(token);
    }
    const integer=BigInt(token);
    return integer>=BigInt(Number.MIN_SAFE_INTEGER)&&integer<=BigInt(Number.MAX_SAFE_INTEGER)?Number(integer):integer;
  });
}
