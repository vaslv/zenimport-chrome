/** Portable file UI. Native background owners decide every storage transition. */
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {SyncError} from './backend-client.js';
import {storageMessages,ZENMONEY_ORIGIN} from './popup-storage.js';
const $=id=>document.getElementById(id),CHUNK=262144,MAX=67108864;
const encode=bytes=>{let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);};
const decode=text=>Uint8Array.from(atob(text),value=>value.charCodeAt(0));
const item=(value,label)=>Object.assign(document.createElement('option'),{value,textContent:label});
export function setupMigration({rpc,refresh,lock,pause}){
  let state=null,working=false,active=null,ready=[],downloaded=null,previewKey=null,actionError=null,includeFileProgress=false;
  // Uploading a file does not prove that its restore succeeded. Only durable
  // operation progress may replace the error from the user's whole action.
  const progressKey=(includeFile=false)=>JSON.stringify({controls:state?.storage?.controls,archives:{...state?.storage?.archives,file:includeFile?state?.storage?.archives.file:undefined},
    awaitingSync:state?.storage?.awaitingSync,pause:state?.controlPause});
  const display=(text,tone='neutral')=>{const e=$('migration-status');if(e.textContent!==text)e.textContent=text;e.dataset.tone=tone;};
  const feedback=(text,tone='neutral')=>{if(tone==='error')actionError={text,includeFile:includeFileProgress,key:progressKey(includeFileProgress)};display(text,tone);};
  const selected=()=>ready.find(value=>value.id===$('archive-ready').value);
  async function action(operation,{includeFile=false}={}){
    if(working||!state?.storage)return;actionError=null;includeFileProgress=includeFile;working=true;lock(true);render();
    try{await operation();}catch(error){feedback(storageMessages[error.code]||'The result could not be confirmed. Reopen Data migration before retrying.','error');}
    finally{working=false;lock(false);await load({keepMessage:true}).catch(()=>{});render();}
  }
  function render(){
    if(!state)return;
    const s=state.storage,a=s.archives,t=s.controls.transfer,r=a.recovery;
    const pending=!!s.controls.pending;
    active=t&&(!['complete','cancelled'].includes(t.phase)||t.finishingRepair)?{kind:'move',id:t.id,canCancel:t.canCancel,error:t.error,repairKind:t.finishingRepair?null:'move',serverUrl:t.serverUrl,localRepair:t.direction==='remote-to-local'?'local':null}
      :s.controls.join?.phase==='quiescing'?{kind:'move',id:s.controls.join.id,canCancel:true}
      :r&&(r.phase==='pending'||r.cleaning)?{kind:'restore',target:'server',id:r.id,canCancel:r.canCancel,error:r.error,preview:r.awaitingConfirmation?r.preview:null,repairKind:!r.remoteCleaned?'recovery':null,serverUrl:r.serverUrl}
      :a.restore&&['loading','validated','preview'].includes(a.restore.phase)?{kind:'restore',target:'browser',id:a.restore.id,canCancel:true,preview:a.restore.preview,localRepair:'restore'}
      :a.backup&&a.backup.phase!=='complete'?{kind:'export',kindValue:'remote',id:a.backup.id,canCancel:true,error:a.backup.error}
      :a.backups.some(value=>value.phase==='building')?{kind:'export',kindValue:'local',id:a.backups.find(value=>value.phase==='building').id,canCancel:true}
      :a.preparation?.phase==='quiescing'?{kind:'export',kindValue:'local',id:a.preparation.id,canCancel:true}:null;
    const previous=$('archive-source').value;$('archive-source').replaceChildren();
    if(s.mode==='remote')$('archive-source').append(item('remote','Current server'));
    for(const source of a.sources)$('archive-source').append(item(source.generation,source.active?'Current browser copy':'Inactive browser copy'));
    if([...$('archive-source').options].some(option=>option.value===previous))$('archive-source').value=previous;
    $('archive-source').disabled=working||!!active;
    $('export-data').disabled=working||!!active||pending||!$('archive-source').value;
    const before=$('archive-ready').value;
    ready=a.backups.filter(value=>value.phase==='ready').map(value=>({...value,kind:'local'}));
    if(a.backup?.phase==='ready'&&!a.backup.cancelRequested&&!a.backup.ackRequested)ready.push({...a.backup,kind:'remote'});
    $('archive-ready').replaceChildren(...ready.map((value,i)=>item(value.id,`${value.kind==='remote'?'Server':'Browser'} backup ${i+1}${value.acknowledged?' · saved':''}`)));
    if(ready.some(value=>value.id===before))$('archive-ready').value=before;
    $('archive-download').hidden=!ready.length;
    $('download-data').disabled=working||pending||!selected();
    $('ack-download').disabled=working||pending||selected()?.acknowledged||!selected()||downloaded?.id!==selected().id||downloaded.sha256!==selected().sha256;
    $('restore-target').querySelector('[value=server]').disabled=s.mode!=='remote';
    if(s.mode!=='remote')$('restore-target').value='browser';
    $('restore-token-label').hidden=$('restore-target').value!=='browser';
    $('restore-token').required=$('restore-target').value==='browser'&&!(s.mode==='local'&&s.local?.configured);
    const usableFile=a.file&&['uploading','ready'].includes(a.file.phase)&&!active;
    $('import-data').textContent=usableFile?'Resume selected ZIP':'Choose ZIP to restore';
    for(const control of $('restore-form').querySelectorAll('input,select,button'))control.disabled=working||!!active||pending;
    const preview=active?.kind==='restore'?active.preview:null,key=preview?active.id+'|'+preview.id:null;
    if(key!==previewKey){previewKey=key;$('accept-preview').checked=false;}
    $('restore-preview').hidden=!preview;
    if(preview){
      const bank=preview.bankTransactions??preview.bank_transactions,zen=preview.zenTransactions??preview.zen_transactions;
      $('preview-summary').textContent=`Bank transactions: ${bank}. ZenMoney transactions: ${zen}. Without a bank/ZenMoney match: ${preview.missingBank??preview.missing_bank} / ${preview.extraZen??preview.extra_zen}. Unchecked accounts: ${preview.uncheckedAccounts??preview.unchecked_accounts}. No transactions have been sent.`;
    }
    $('confirm-restore').disabled=working||!preview||!$('accept-preview').checked;
    $('repair-local-form').hidden=!active?.localRepair;
    $('repair-local-token').disabled=working||!active?.localRepair;
    $('repair-local').disabled=working||!active?.localRepair;
    $('repair-transport-form').hidden=!active?.repairKind;
    $('repair-transport-target').textContent=active?.repairKind?`Repair access to ${active.serverUrl}. The saved transfer will continue; its destination and data stay unchanged.`:'';
    $('repair-transport-token').disabled=working||!active?.repairKind;
    $('repair-transport').disabled=working||!active?.repairKind;
    $('migration-retry').hidden=!active;$('migration-retry').disabled=working;
    $('migration-cancel').hidden=!active?.canCancel;$('migration-cancel').disabled=working;
    const cleanup=a.restore?.phase==='cancelled'||a.file&&['uploading','ready','cancelled'].includes(a.file.phase)||a.backups.some(value=>value.phase==='cancelled'||value.phase==='ready'&&value.acknowledged);
    $('migration-clean').hidden=!!active||pending||!cleanup;$('migration-clean').disabled=working;
    pause(pending||!!active);
  }
  function description(){
    const s=state.storage,a=s.archives;
    const error=state.controlPause&&state.controlPause.id===active?.id?state.controlPause.error:active?.error;
    if(error)return storageMessages[error]||'Storage work is paused. Retry or cancel it.';
    if(active?.preview)return 'Review the fresh summary, then explicitly activate the restored data.';
    if(active?.kind==='move')return 'Moving storage. Keep the previous writer stopped; progress is saved if this window closes.';
    if(active?.kind==='restore')return 'Loading and verifying the archive. No transactions are sent during restore.';
    if(active?.kind==='export'&&a.backup?.phase==='ready'&&!a.backup.ackRequested&&!a.backup.cancelRequested)return 'Backup ready. Download the ZIP, check it was saved, then confirm below.';
    if(active?.kind==='export')return 'Preparing a consistent backup. Progress is saved if this window closes.';
    if(s.awaitingSync)return 'Data restored. Click Synchronize when ready. No transactions were sent during import.';
    if(a.recovery?.phase==='activated')return 'Data restored. Use Synchronize to refresh bank history and ZenMoney.';
    if(ready.length&&ready.every(value=>value.acknowledged))return 'Backup confirmed. Keep the ZIP securely.';
    if(ready.length)return 'Backup ready. Download the ZIP, check it was saved, then confirm below.';
    return 'Export a private backup, or restore one before the destination starts synchronizing.';
  }
  async function load({keepMessage=false,value}={}){
    state=value??await rpc({type:'archive-status'});
    const saved=(await chrome.storage.session.get('archiveDownloaded')).archiveDownloaded;
    downloaded=saved??null;render();
    if(keepMessage&&(!actionError||actionError.key===progressKey(actionError.includeFile)))return;
    if(actionError&&actionError.key===progressKey(actionError.includeFile)){display(actionError.text,'error');return;}
    actionError=null;display(description(),state.controlPause&&state.controlPause.id===active?.id?'error':'neutral');
  }
  $('migration-settings').addEventListener('toggle',()=>{if($('migration-settings').open&&!working)load().catch(()=>feedback('Could not read migration status.','error'));});
  $('archive-ready').addEventListener('change',render);
  $('restore-target').addEventListener('change',render);
  $('accept-preview').addEventListener('change',render);
  $('export-data').addEventListener('click',()=>action(async()=>{
    const source=$('archive-source').value,id=crypto.randomUUID(),kind=source==='remote'?'remote':'local';
    feedback('Preparing a private archive…','loading');
    await rpc({type:'archive-export-begin',id,kind,...(kind==='local'?{generation:source}:{})});await refresh();
  }));
  $('download-data').addEventListener('click',()=>action(async()=>{
    const backup=selected();if(!backup)throw new SyncError('migration_incomplete');
    feedback('Checking and downloading the ZIP…','loading');
    const parts=[],hasher=sha256.create();let bytes=0;
    for(let number=0;number<Number(backup.chunks);number++){
      const value=await rpc({type:'archive-export-chunk',id:backup.id,kind:backup.kind,number}),part=decode(value.base64);
      if(part.length!==Math.min(CHUNK,Number(backup.bytes)-number*CHUNK))throw new SyncError('migration_invalid');
      hasher.update(part);parts.push(part);bytes+=part.length;
    }
    if(bytes!==Number(backup.bytes)||bytesToHex(hasher.digest())!==backup.sha256)throw new SyncError('migration_invalid');
    const url=URL.createObjectURL(new Blob(parts,{type:'application/zip'})),link=document.createElement('a');
    link.href=url;link.download='zenimport-backup.zip';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    downloaded={id:backup.id,sha256:backup.sha256};await chrome.storage.session.set({archiveDownloaded:downloaded});
    feedback('Download started. Check that the ZIP was saved, then click I saved the ZIP.','success');
  }));
  $('ack-download').addEventListener('click',()=>action(async()=>{
    const backup=selected();if(!backup||downloaded?.id!==backup.id||downloaded.sha256!==backup.sha256)throw new SyncError('migration_incomplete');
    await rpc({type:'archive-export-ack',id:backup.id,kind:backup.kind,sha256:backup.sha256});
    await chrome.storage.session.remove('archiveDownloaded');downloaded=null;await refresh();feedback('Backup confirmed. Keep the ZIP securely.','success');
  }));
  $('import-data').addEventListener('click',()=>{
    if(working||!$('restore-form').reportValidity())return;
    const target=$('restore-target').value;
    const permission=target==='browser'?chrome.permissions.request({origins:[ZENMONEY_ORIGIN]}):Promise.resolve(true);
    permission.then(granted=>{
      if(!granted){feedback(storageMessages.zenmoney_permission,'error');return;}
      $('migration-file').value='';$('migration-file').click();
    }).catch(()=>feedback('Could not request API access.','error'));
  });
  $('migration-file').addEventListener('change',()=>{
    const file=$('migration-file').files[0];if(!file)return;
    action(async()=>{
      if(!file.size||file.size>MAX)throw new SyncError('payload_too_large');
      const consent={formerWritersRetired:$('retired-writers').checked,acceptPostSnapshotEvidenceLoss:$('snapshot-loss').checked,replaceInactiveLocalCopy:$('restore-replace').checked};
      if(!consent.formerWritersRetired||!consent.acceptPostSnapshotEvidenceLoss)throw new SyncError('validation_error');
      feedback('Checking the selected ZIP…','loading');
      const hasher=sha256.create();for(let offset=0;offset<file.size;offset+=CHUNK)hasher.update(new Uint8Array(await file.slice(offset,offset+CHUNK).arrayBuffer()));
      const checksum=bytesToHex(hasher.digest()),previous=state.storage.archives.file;
      if(previous&&previous.phase!=='cleaned'&&(previous.sha256!==checksum||previous.bytes!==file.size))throw new SyncError('migration_busy');
      const id=previous?.phase!=='cleaned'&&previous?.sha256===checksum?previous.id:crypto.randomUUID();
      let {file:upload}=await rpc({type:'archive-upload-begin',id,bytes:file.size,sha256:checksum});
      if(upload.phase==='uploading'){
        ({file:upload}=await rpc({type:'archive-upload-status',id}));
        for(let number=0;number<upload.chunks;number++)if(!upload.received.includes(number)){
          const part=new Uint8Array(await file.slice(number*CHUNK,(number+1)*CHUNK).arrayBuffer());
          await rpc({type:'archive-upload-chunk',id,nonce:upload.nonce,number,base64:encode(part)});
        }
        await rpc({type:'archive-upload-seal',id});
      }
      const token=$('restore-token').value.trim();
      await rpc({type:'archive-import-begin',id,target:$('restore-target').value,token:token||null,...consent});
      $('restore-token').value='';await refresh();feedback('Archive saved. Verification will continue in the background.','loading');
    });
  });
  $('confirm-restore').addEventListener('click',()=>action(async()=>{
    const saved=active;if(!saved?.preview||!$('accept-preview').checked)throw new SyncError('validation_error');
    await rpc({type:'archive-import-accept',id:saved.id,target:saved.target,previewId:saved.preview.id});
    $('accept-preview').checked=false;await refresh();
  }));
  $('repair-local-form').addEventListener('submit',event=>{
    event.preventDefault();
    chrome.permissions.request({origins:[ZENMONEY_ORIGIN]}).then(granted=>{
      if(!granted)return feedback('Allow access to ZenMoney to verify this token.','error');
      action(async()=>{
        if(!active?.localRepair)throw new SyncError('migration_paused');
        await rpc({type:'storage-repair',id:active.id,kind:active.localRepair,token:$('repair-local-token').value.trim()});
        $('repair-local-token').value='';await refresh();feedback('ZenMoney token verified. Retry the saved operation.','success');
      });
    });
  });
  $('repair-transport-form').addEventListener('submit',event=>{
    event.preventDefault();action(async()=>{
      if(!active?.repairKind)throw new SyncError('migration_paused');
      await rpc({type:'storage-repair',id:active.id,kind:active.repairKind,token:$('repair-transport-token').value.trim()});
      $('repair-transport-token').value='';await refresh();feedback('Replacement token verified. Retry the saved operation.','success');
    });
  });
  $('migration-retry').addEventListener('click',()=>action(async()=>{
    if(!active)return;
    await rpc(active.kind==='move'?{type:'storage-retry',id:active.id}:active.kind==='export'?{type:'archive-export-retry',id:active.id,kind:active.kindValue}
      :{type:'archive-import-retry',id:active.id,target:active.target,refreshPreview:!!active.preview});await refresh();
  }));
  $('migration-cancel').addEventListener('click',()=>action(async()=>{
    if(!active?.canCancel)return;
    await rpc(active.kind==='move'?{type:'storage-cancel',id:active.id,requestId:crypto.randomUUID()}:active.kind==='export'?{type:'archive-export-cancel',id:active.id,kind:active.kindValue}
      :{type:'archive-import-cancel',id:active.id,target:active.target});await refresh();
  }));
  $('migration-clean').addEventListener('click',()=>action(async()=>{
    const a=state.storage.archives;
    const commands=[...a.backups.filter(b=>b.phase==='cancelled'||b.phase==='ready'&&b.acknowledged).map(b=>({type:'archive-export-clean',id:b.id,kind:'local'}))];
    if(a.restore?.phase==='cancelled')commands.push({type:'archive-import-clean',id:a.restore.id,target:'browser'});
    if(a.file&&['uploading','ready','cancelled'].includes(a.file.phase))commands.push({type:'archive-upload-discard',id:a.file.id});
    for(const command of commands){
      let complete=false;for(let n=0;n<16&&!complete;n++)complete=(await rpc(command)).result.complete;
      if(!complete){feedback('Temporary data partly cleared. Click again to continue.');return;}
    }
    feedback('Temporary data cleared. Financial history was kept.','success');
  },{includeFile:true}));
  return {refresh:load,load:value=>load({value})};
}
