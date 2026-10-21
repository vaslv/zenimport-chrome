/** Explicit non-IDB control port for unit logic, never browser durability evidence. */
export function memoryControl(){
 let root=null;const states=new Map(),contexts=new Map();
 const assertRoot=expected=>{if(JSON.stringify(root)!==JSON.stringify(expected))throw Object.assign(Error('stale_epoch'),{code:'stale_epoch'});};
 const control={read:async()=>structuredClone(root),close:()=>{},selectCredential:async(expected,ref,changed,context)=>{
  if(JSON.stringify(expected)!==JSON.stringify(root)||root.pendingSwitchId)throw Object.assign(Error('stale_epoch'),{code:'stale_epoch'});
  contexts.set(ref,structuredClone(context));root={...root,credentialRef:ref,credentialEpoch:String(BigInt(root.credentialEpoch)+1n),epoch:String(BigInt(root.epoch)+(changed?1n:0n))};return structuredClone(root);
 },readState:async(expected,scope)=>{assertRoot(expected);return states.has(scope)?structuredClone(states.get(scope)):null;},
 patchState:async(expected,scope,patch,initialize)=>{assertRoot(expected);if(root.pendingSwitchId)throw Object.assign(Error('stale_epoch'),{code:'stale_epoch'});
  if(initialize&&states.has(scope))return structuredClone(states.get(scope));
  const value={...states.get(scope),...structuredClone(patch)};states.set(scope,value);return structuredClone(value);
 },bindIdentity:async(expected,installationId,datasetId)=>{assertRoot(expected);const value={...contexts.get(root.credentialRef),installationId,datasetId};contexts.set(root.credentialRef,value);return structuredClone(value);},remoteContext:async expected=>{assertRoot(expected);return structuredClone(contexts.get(root.credentialRef));}};
 return {exists:async()=>!!root,open:async(name,port,ref,context)=>{
  if(context)contexts.set(ref,structuredClone(context));
  root??={id:'runtime',installationId:crypto.randomUUID(),activeMode:'remote',activeGeneration:null,epoch:'1',pendingSwitchId:null,
   credentialRef:ref,credentialEpoch:'1',financialMayHaveStarted:false};return control;
 },mutate:values=>{Object.assign(root,values);},inspect:()=>structuredClone(root)};
}
export function memoryArea(values={}){
 return {values,setAccessLevel:async()=>{},get:async keys=>structuredClone(Object.fromEntries((typeof keys==='string'?[keys]:keys).map(key=>[key,values[key]]))),
  set:async entries=>Object.assign(values,structuredClone(entries)),remove:async keys=>{for(const key of typeof keys==='string'?[keys]:keys)delete values[key];}};
}
