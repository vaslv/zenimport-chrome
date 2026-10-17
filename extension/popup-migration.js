import {Backend} from './backend-client.js';

const $=id=>document.getElementById(id);
const messages={
  migration_busy:'A server request or delivery is still in progress. Try again shortly.',
  migration_incomplete:'Finish or stop bank history capture before exporting.',
  migration_not_empty:'Import is unavailable: this server has already synchronized or imported data.',
  migration_invalid:'The archive is damaged or incompatible. No data was imported.',
  migration_wrong_account:'The archive belongs to another ZenMoney account. No data was imported.',
  zenmoney_unavailable:'The server could not verify its ZenMoney account. Check its configuration and try again.',
  payload_too_large:'The archive is too large. Maximum ZIP size: 64 MiB.',
  unauthorized:'Check the server token.',
};

export function setupMigration({rpc,refresh,lock,pause}) {
  let state=null,working=false;
  const feedback=(text,tone='neutral')=>{const e=$('migration-status');e.textContent=text;e.dataset.tone=tone;};
  const render=()=>{
    $('export-data').disabled=working || !state;
    $('import-data').disabled=working || !state?.can_import || state.paused;
    $('migration-resume').hidden=!state?.paused;
    $('migration-resume').disabled=working;
    $('migration-file').disabled=working;
  };
  const client=async()=>{
    const {config}=await chrome.storage.local.get('config');
    if(!config)throw Object.assign(Error(),{code:'not_configured'});
    return new Backend(config);
  };
  async function load({keepMessage=false}={}) {
    $('migration-settings').hidden=false;
    try{
      state=await rpc({type:'migration-status'});pause(state.paused);
      if(state.paused){$('settings').open=true;$('migration-settings').open=true;}
      if(!keepMessage)feedback(state.paused?'This server is paused. Save the archive before switching servers.':
        state.awaiting_sync?'Data restored. Ready for your first synchronization.':
        state.can_import?'Import is available before the first synchronization.':'Import is locked after the first synchronization or completed import.');
    }catch(error){
      state=null;pause(false);
      feedback(error.code==='not_found'?'Data migration requires ZenImportBackend 0.2.0 or newer.':
        messages[error.code] || 'Cannot read migration status. Check the server connection.','error');
    }
    render();
  }
  async function action(operation) {
    if(working)return;
    working=true;lock(true);render();
    try{await operation();}
    catch(error){feedback(messages[error.code] || 'The result could not be confirmed. Reopen settings to check the server before trying again.','error');}
    finally{await load({keepMessage:true});working=false;lock(false);render();}
  }
  $('migration-settings').addEventListener('toggle',()=>{
    if($('migration-settings').open && !working)load();
  });
  $('export-data').addEventListener('click',()=>action(async()=>{
    feedback('Stopping capture and preparing a private archive…','loading');
    await rpc({type:'migration-prepare-export'});
    const archive=await (await client()).transfer('export');
    const url=URL.createObjectURL(archive),link=document.createElement('a');
    link.href=url;link.download='zenimport-migration.zip';document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    feedback('Archive download started. This server stays paused. Check that the ZIP was saved before switching servers.','success');
  }));
  $('import-data').addEventListener('click',()=>{
    if(!working && state?.can_import){$('migration-file').value='';$('migration-file').click();}
  });
  $('migration-file').addEventListener('change',()=>{
    const file=$('migration-file').files[0];if(!file)return;
    action(async()=>{
      if(!file.size || file.size>state.max_archive_bytes)throw Object.assign(Error(),{code:'payload_too_large'});
      feedback('Uploading and verifying the archive. Do not synchronize yet…','loading');
      await (await client()).transfer('import',file);
      await rpc({type:'migration-imported'});
      await refresh();
      feedback('Data restored. Click Synchronize when ready. No transactions were sent during import.','success');
    });
  });
  $('migration-resume').addEventListener('click',()=>{
    if(!confirm('Resume this server only if the move was cancelled. Do not run both servers. If synchronization continues, create a new export before moving.'))return;
    action(async()=>{await rpc({type:'migration-resume'});await refresh();feedback('This server has resumed. Any previous export is an older recovery point.','success');});
  });
  return {refresh:load};
}
