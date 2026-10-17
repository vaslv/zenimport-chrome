// MAIN world: observe completion only. Never read request bodies, responses,
// headers, credentials, cookies or bank storage. The rendered UI supplies records.
(() => {
  if(globalThis.__zenImportBidvNetwork)return;globalThis.__zenImportBidvNetwork=true;
  if(location.origin!=='https://smartbanking.bidv.com.vn')return;
  const pending=new Set(),matches=new WeakMap();let next=0;
  const post=data=>window.postMessage({source:'zenimport-bidv-network-v1',...data},location.origin);
  const originalOpen=XMLHttpRequest.prototype.open,originalSend=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(method,url,...rest) {
    let matched=false;try{const parsed=new URL(url,location.href);matched=parsed.origin===location.origin && parsed.pathname==='/w2/process';}catch{}
    matches.set(this,matched);return originalOpen.call(this,method,url,...rest);
  };
  XMLHttpRequest.prototype.send=function(...args) {
    if(!matches.get(this))return originalSend.apply(this,args);
    const id=++next;pending.add(id);post({phase:'start',id});let finished=false;
    const finish=()=>{if(finished)return;finished=true;pending.delete(id);post({phase:'end',id,status:this.status});};
    this.addEventListener('loadend',finish,{once:true});
    try{return originalSend.apply(this,args);}catch(e){finish();throw e;}
  };
  window.addEventListener('message',event=>{
    if(event.source===window && event.origin===location.origin && event.data?.source==='zenimport-bidv-probe-v1')post({phase:'ready',pending:[...pending]});
  });
})();
