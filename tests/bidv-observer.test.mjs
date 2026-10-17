import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('BIDV MAIN observer bridges only request lifecycle metadata and preserves XHR semantics',async()=>{
  const code=await readFile(new URL('../extension/connectors/bidv/observer.js',import.meta.url),'utf8');
  const messages=[],listeners=[],calls=[];
  class Request {
    status=200;
    addEventListener(event,fn){assert.equal(event,'loadend');this.finish=fn;}
    open(...args){calls.push(['open',...args]);return 'opened';}
    send(...args){calls.push(['send',...args]);return 'sent';}
    get responseText(){throw Error('Bank response must not be read');}
  }
  const origin='https://smartbanking.bidv.com.vn';
  const window={postMessage:message=>messages.push(message),addEventListener:(name,fn)=>{assert.equal(name,'message');listeners.push(fn);}};
  const context=vm.createContext({XMLHttpRequest:Request,URL,location:{origin,href:origin+'/tai-khoan'},window});
  vm.runInContext(code,context);vm.runInContext(code,context);assert.equal(listeners.length,1);
  const xhr=new Request();assert.equal(xhr.open('POST','/w2/process',true),'opened');
  assert.equal(xhr.send('fixture-secret-body'),'sent');
  listeners[0]({source:window,origin,data:{source:'zenimport-bidv-probe-v1'}});
  assert.deepEqual(JSON.parse(JSON.stringify(messages)),[
    {source:'zenimport-bidv-network-v1',phase:'start',id:1},
    {source:'zenimport-bidv-network-v1',phase:'ready',pending:[1]},
  ]);
  xhr.finish();assert.equal(messages.at(-1).status,200);
  assert.equal(JSON.stringify(messages).includes('fixture-secret'),false);
  assert.equal(calls[1][1],'fixture-secret-body');
  const other=new Request();other.open('GET',origin+'/other');other.send();
  const external=new Request();external.open('POST','https://example.test/w2/process');external.send();
  assert.equal(messages.length,3);
  listeners[0]({source:{},origin,data:{source:'zenimport-bidv-probe-v1'}});assert.equal(messages.length,3);
});
