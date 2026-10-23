import test from 'node:test';
import assert from 'node:assert/strict';
import {setupMigration} from '../extension/popup-migration.js';

class Element{
 constructor(){this.value='';this.options=[];this.dataset={};this.events={};this.checked=false;this.textContent='';}
 addEventListener(name,handler){this.events[name]=handler;}
 replaceChildren(...options){this.options=options;this.value=options[0]?.value??'';}
 append(option){this.options.push(option);if(!this.value)this.value=option.value;}
 querySelector(){return new Element();}
 querySelectorAll(){return [];}
}
async function fixture(work){
 const original={document:globalThis.document,chrome:globalThis.chrome},elements=new Map();
 const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const storage={mode:'local',local:{configured:true},controls:{pending:false},archives:{backups:[],sources:[{generation:'synthetic',active:true}]}};
 let fail=true,rebaseFile=false,loseAcknowledgement=false,loseCleanup=false,download;
 globalThis.document={getElementById:get,createElement:()=>new Element()};
 globalThis.chrome={storage:{session:{get:async()=>({archiveDownloaded:download})}}};
 const ui=setupMigration({rpc:async request=>{
   if(request.type==='archive-upload-discard'&&loseCleanup){
    storage.archives.file.phase='cleaned';
    throw Object.assign(Error('private'),{code:'backend_unavailable'});
   }
   if(request.type==='archive-export-ack'&&loseAcknowledgement){
    storage.archives.backups[0].acknowledged=true;
    throw Object.assign(Error('private'),{code:'backend_unavailable'});
   }
   if(request.type==='archive-export-begin'&&fail){
    if(rebaseFile)storage.archives.file={id:'selected',phase:'ready'};
    throw Object.assign(Error('private'),{code:'quota_exceeded'});
   }
   return {storage:structuredClone(storage)};
  },refresh:async()=>{},lock:()=>{},pause:()=>{}});
 try{await ui.load({storage:structuredClone(storage)});await work({ui,get,storage,succeed:()=>{fail=false;},rebase:()=>{rebaseFile=true;},
   loseCleanup:()=>{loseCleanup=true;},loseAck:()=>{loseAcknowledgement=true;download={id:'backup',sha256:'a'.repeat(64)};}});}
 finally{Object.assign(globalThis,original);}
}
test('unchanged polling and readiness timestamps retain an actionable error until progress',async()=>fixture(async({ui,get,storage})=>{
 await get('export-data').events.click();const error=get('migration-status').textContent;
 assert.match(error,/Free disk space/);
 for(let i=0;i<3;i++){storage.local.lastRefresh=String(i);await ui.load({storage});assert.equal(get('migration-status').textContent,error);}
 storage.archives.backups=[{id:'backup',phase:'ready',acknowledged:false}];
 await ui.load({storage});assert.match(get('migration-status').textContent,/Backup ready/);
 assert.equal(get('migration-status').dataset.tone,'neutral');
}));
test('a new action clears the old error while intermediate file upload does not prove restore success',async()=>fixture(async({ui,get,storage,succeed,rebase})=>{
 rebase();await get('export-data').events.click();const error=get('migration-status').textContent;
 await ui.load({storage});assert.equal(get('migration-status').textContent,error);
 succeed();await get('export-data').events.click();assert.notEqual(get('migration-status').textContent,error);
 await ui.load({storage});assert.equal(get('migration-status').dataset.tone,'neutral');
}));
test('a confirmed acknowledgement clears a lost-response error without an unnecessary repeat',async()=>fixture(async({ui,get,storage,loseAck})=>{
 storage.archives.backups=[{id:'backup',phase:'ready',acknowledged:false,sha256:'a'.repeat(64)}];
 loseAck();await ui.load({storage:structuredClone(storage)});
 await get('ack-download').events.click();
 assert.equal(storage.archives.backups[0].acknowledged,true);
 assert.match(get('migration-status').textContent,/Backup confirmed/);
 for(let i=0;i<3;i++)await ui.load({storage:structuredClone(storage)});
 assert.match(get('migration-status').textContent,/Backup confirmed/);
 assert.equal(get('migration-status').dataset.tone,'neutral');
}));

test('confirmed file cleanup clears a lost-response error even when the retry button disappears',async()=>fixture(async({ui,get,storage,loseCleanup})=>{
 storage.archives.file={id:'selected',phase:'ready'};loseCleanup();
 await ui.load({storage:structuredClone(storage)});await get('migration-clean').events.click();
 assert.equal(storage.archives.file.phase,'cleaned');
 for(let i=0;i<3;i++)await ui.load({storage:structuredClone(storage)});
 assert.equal(get('migration-clean').hidden,true);
 assert.equal(get('migration-status').dataset.tone,'neutral');
 assert.match(get('migration-status').textContent,/Export a private backup/);
}));
