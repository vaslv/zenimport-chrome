/** Setup UI talks only to trusted background commands, never a database or SDK. */
import {permissionOrigin,serverAddress,SyncError} from './backend-client.js';
const $=id=>document.getElementById(id);
export const ZENMONEY_ORIGIN='https://api.zenmoney.ru/*';
export const storageMessages={
  stale_context:'The storage connection changed. Reopen the extension menu.',
  invalid_server:'Enter an HTTPS server address or localhost.',unauthorized:'Check the server token.',
  backend_unavailable:'Cannot reach the server. Try again later.',
  unsupported_api_version:'The server and extension versions are incompatible.',
  validation_error:'Check the selected options and confirmations.',
  zenmoney_auth:'Check the ZenMoney token.',zenmoney_not_configured:'Enter and verify your ZenMoney token.',
  zenmoney_wrong_owner:'This token belongs to a different ZenMoney account. Your existing data was kept.',
  zenmoney_permission:'Allow access to the ZenMoney API, then verify the token again.',
  zenmoney_network:'Cannot reach ZenMoney. Try again later.',zenmoney_rate_limited:'ZenMoney asked us to wait. Retry later.',
  mirror_cooldown:'ZenMoney requests are paused briefly after an error. Wait a moment, then refresh the account list.',
  mirror_busy:'ZenMoney data is being refreshed. Try again shortly.',
  zenmoney_response:'ZenMoney returned an invalid response. Try again later.',
  zenmoney_unavailable:'ZenMoney is unavailable. Check the token and try again.',
  permission_required:'Access to this server was not granted. Connect again to allow access.',
  server_verification_required:'Verify the server connection before synchronizing.',
  migration_required:'Move this server to browser storage first, then connect the other server.',
  migration_paused:'Storage is held by a migration. Continue or cancel it in Data migration.',
  migration_busy:'A storage operation is still in progress. Wait or retry it in Data migration.',
  migration_invalid:'The archive or storage operation could not be verified. No new writer was selected.',
  migration_incomplete:'A complete local mirror and stopped capture are required. Refresh accounts, then retry.',
  migration_not_empty:'The destination has already been used. Import requires an empty destination.',
  migration_wrong_account:'The destination or archive belongs to another ZenMoney account.',
  unsupported_migration_version:'Update the backend to a version supporting portable storage transfers.',
  quota_exceeded:'Chrome could not save the data. Free disk space and retry; keep your backup.',
  payload_too_large:'The ZIP must be no larger than 64 MiB.',
  backup_required:'Download and confirm a backup of the inactive browser copy before replacing it.',
  replacement_confirmation_required:'Confirm replacement of the inactive browser copy after saving its backup.',
};
export function setupStorage({rpc,lock,feedback,changed}){
  let state=null,candidate=null,working=false,draftEdited=false,browserDraftEdited=false;
  async function action(operation){
    if(working||!state?.storage)return;working=true;lock(true);render();
    try{await operation();}catch(error){feedback(storageMessages[error.code]||'Could not change storage. Check the connection and retry.','error');}
    finally{working=false;lock(false);render();}
  }
  function render(){
    if(!state?.storage)return;
    const local=state.storage.mode==='local',ready=state.storage.local;
    $('storage-mode').textContent=local?'Browser database':'Server database';
    $('local-settings').hidden=!local;
    $('local-owner').textContent=ready?.configured?`Verified ZenMoney owner: ${ready.owners.join(', ')}.`:'A verified ZenMoney token is required for browser storage.';
    $('local-remove').hidden=!ready?.configured;
    $('browser-return').hidden=local;
    $('server-candidate').hidden=!candidate;
    if(candidate){
      $('candidate-summary').textContent=candidate.identity.can_import?'This server is empty. You can move your browser history to it.':'This server already has data. You can connect to it without importing or merging.';
      $('move-data-label').hidden=!candidate.identity.can_import;
      $('join-server-label').hidden=candidate.identity.can_import&&$('move-data').checked;
    }
    for(const id of ['local-connect','local-remove','select-server','use-browser'])$(id).disabled=working||state.storage.controls.pending;
    for(const id of ['local-token','browser-token','move-data','join-server','pause-server','replace-browser'])$(id).disabled=working;
  }
  async function load(value,{initial=false}={}){
    state=value;render();if(!state.storage)return;
    if(initial){
      const local=state.storage.mode==='local';
      $('local-settings').open=local&&!state.configured;
      $('connection-settings').open=!local&&(!state.configured||!!state.verificationError);
      if(local&&!draftEdited){const saved=await rpc({type:'local-draft'});if(!draftEdited)$('local-token').value=saved.token??'';}
      const {browserTokenDraft}=await chrome.storage.session.get('browserTokenDraft');
      if(!browserDraftEdited&&browserTokenDraft?.dataset===state.context.dataset_id)$('browser-token').value=browserTokenDraft.token;
    }
  }
  $('local-token').addEventListener('input',()=>{
    draftEdited=true;rpc({type:'local-draft',token:$('local-token').value}).catch(()=>feedback('Could not save the token draft. Enter it again.','error'));
  });
  $('browser-token').addEventListener('input',()=>{
    browserDraftEdited=true;
    if(state?.context)chrome.storage.session.set({browserTokenDraft:{dataset:state.context.dataset_id,token:$('browser-token').value}}).catch(()=>feedback('Could not save the token draft.','error'));
  });
  $('local-form').addEventListener('submit',event=>{
    event.preventDefault();
    // Chrome permission prompts must begin in this click, before any RPC/await.
    const permission=chrome.permissions.request({origins:[ZENMONEY_ORIGIN]});
    action(async()=>{
      if(!await permission)throw new SyncError('zenmoney_permission');
      feedback('Verifying ZenMoney…','loading');await rpc({type:'local-configure',token:$('local-token').value.trim()});
      $('local-token').value='';
      try{await rpc({type:'catalog'});}finally{await changed();}
      $('local-settings').open=false;feedback('ZenMoney token verified.','success');$('local-settings').querySelector('summary').focus();
    });
  });
  $('local-remove').addEventListener('click',()=>action(async()=>{
    await rpc({type:'local-remove'});$('local-token').value='';await changed();$('local-settings').open=true;
  }));
  $('move-data').addEventListener('change',render);
  $('server-form').addEventListener('submit',event=>{
    event.preventDefault();let permission;
    try{permission=chrome.permissions.request({origins:[permissionOrigin($('url').value)]});}catch(error){feedback('Enter an HTTPS server address or localhost.','error');return;}
    action(async()=>{
      if(!await permission)throw new SyncError('permission_required');
      const url=serverAddress($('url').value),token=$('token').value.trim();
      if(state.storage.mode==='remote'){
        if(serverAddress(state.url)!==url)throw new SyncError('migration_required');
        await rpc({type:'configure',url,token});await chrome.storage.session.remove('connectionDraft');$('token').value='';await changed();$('connection-settings').open=false;$('connection-settings').querySelector('summary').focus();
      }else{
        ({candidate}=await rpc({type:'storage-candidate',url,token}));
        $('move-data').checked=candidate.identity.can_import&&state.configured;
        $('join-server').checked=false;render();$('select-server').focus();
      }
    });
  });
  for(const id of ['url','token'])$(id).addEventListener('input',()=>{candidate=null;render();});
  $('select-server').addEventListener('click',()=>action(async()=>{
    if(!candidate)throw new SyncError('stale_context');
    const migrate=candidate.identity.can_import&&$('move-data').checked;
    if(!migrate&&!$('join-server').checked)throw new SyncError('validation_error');
    await rpc({type:'storage-server',id:crypto.randomUUID(),ref:candidate.ref,migrate,acceptMissingDedupEvidence:$('join-server').checked});
    await chrome.storage.session.remove('connectionDraft');$('token').value='';candidate=null;await changed();
    $('migration-settings').open=true;
  }));
  $('browser-form').addEventListener('submit',event=>{
    event.preventDefault();const permission=chrome.permissions.request({origins:[ZENMONEY_ORIGIN]});
    action(async()=>{
      if(!await permission)throw new SyncError('zenmoney_permission');
      await rpc({type:'storage-browser',token:$('browser-token').value.trim(),pauseSharedServer:$('pause-server').checked,replaceInactiveLocalCopy:$('replace-browser').checked});
      await chrome.storage.session.remove('browserTokenDraft');$('browser-token').value='';await changed();$('migration-settings').open=true;
    });
  });
  return {load};
}
