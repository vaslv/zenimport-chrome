import {permissionOrigin} from './backend-client.js';
import {today,daysAgo,monthsAgo,validDate,syncTime} from './dates.js';
import {setupMigration} from './popup-migration.js';
const $ = id => document.getElementById(id);
const rpc = async data => {
  const result=await chrome.runtime.sendMessage(data);
  if(!result?.ok)throw Object.assign(Error(),{code:result?.error || 'backend_unavailable'});
  return result;
};
const messages={
  invalid_server:'Enter an HTTPS server address or localhost.',unauthorized:'Check the server token.',
  backend_unavailable:'Cannot reach the server. Try again later.',invalid_response:'The server returned an unrecognized response.',
  unsupported_api_version:'The server and extension versions are incompatible.',unsupported_bank:'Open transaction history in a supported bank.',
  bank_login_required:'Sign in to the bank and open transaction history.',not_configured:'Enter the server address and token.',
  account_unconfigured:'Select the accounts to import.',account_disabled:'No accounts are enabled for import.',
  account_busy:'Complete or stop the current capture first.',capture_busy:'Another extension is already reading the history.',
  settings_conflict:'Settings have changed. Refresh the account list.',zenmoney_account_unavailable:'The ZenMoney account is unavailable. Check the account mapping.',
  zenmoney_unavailable:'ZenMoney is temporarily unavailable.',history_incomplete:'History capture interrupted: the bank returned incomplete history. Synchronize again.',
  existing_ownership_unknown:'Could not identify the account used by the previous match.',
  capture_context_changed:'The page or account has changed. Synchronize again.',validation_error:'Check the selected accounts and date.',
  migration_paused:'This server is paused after export. Import the archive on the new server, or resume this server in Settings.',
  migration_busy:'A server operation is in progress. Try again shortly.',
};
const status=(text,tone='neutral')=>{ $('status').textContent=text; $('status').dataset.tone=tone; $('status').setAttribute('aria-busy',String(tone==='loading')); };
const showError=error=>{
  status(messages[error.code] || 'Could not complete the action. Try again later.','error');
  if(['not_configured','unauthorized','invalid_server','unsupported_api_version'].includes(error.code)){
    $('settings').open=true;$('connection-settings').open=true;
  }else if(['account_unconfigured','settings_conflict','zenmoney_account_unavailable'].includes(error.code))$('settings').open=true;
};
let lastSyncedAt=null;
function renderLastSync(value=lastSyncedAt) {
  lastSyncedAt=value;
  const time=syncTime(value), element=$('last-sync');
  element.hidden=!time;
  element.textContent=time ? `Last synchronized: ${time.date} · ${time.ago}.` : '';
}
let connectionDraftPending=false;
let configured=false,view=null,catalog=[],capture=null,compatible=false,busy=false,refreshTask=null,reimportSaved='',migrationPaused=false;
function node(tag,text,attributes={}) {const value=document.createElement(tag);if(text)value.textContent=text;Object.assign(value,attributes);return value;}
function updateButton() {
  const active=['planned','collecting'].includes(capture?.phase);
  $('account-settings').hidden=!configured;
  $('history-settings').hidden=!compatible || !view?.connection.accounts.some(a=>a.selection==='enabled' && a.supported);
  $('discrepancies').disabled=busy || !compatible;
  $('connect').disabled=busy;
  $('url').disabled=busy;$('token').disabled=busy;
  $('sync').textContent=active?'Stop capture':'Synchronize';
  $('sync').disabled=busy || migrationPaused || (!active && (!compatible || !view?.connection.accounts.some(a=>a.selection==='enabled' && a.supported)));
}
function progress(state) {
  capture=state;updateButton();
  if(!state)return;
  if(state.error && ['failed','paused'].includes(state.phase)){showError({code:state.error});return;}
  if(state.phase==='paused'){status('Capture paused. Click Synchronize to resume.');return;}
  const job=state.job;
  if(['planned','collecting'].includes(state.phase)){
    const intervals=job?.accounts.flatMap(a=>a.intervals) || [];
    status(`Loading history: ${intervals.filter(i=>i.state==='complete').length} of ${intervals.length} periods.`,'loading');return;
  }
  if(state.phase==='cancelled'){status('Capture stopped. Captured data has been saved.');return;}
  if(state.phase==='complete'){
    const d=job.delivery;
    status(job.delivery_state==='complete'
      ? `Done. Processed: ${d.delivered}. Suppressed: ${d.suppressed}.`
      : job.delivery_state==='blocked' ? d.uncertain
        ? `History saved. The server is verifying delivery: ${d.uncertain}.`
        : `History saved. ${messages[job.errors?.at(-1)?.code] || 'Delivery is paused on the server.'}`
      : `History saved. The server is sending transactions: ${d.pending}.`,job.delivery_state==='complete'?'success':job.delivery_state==='blocked'?'error':'loading');
  }
}
function accountNeedsSetup(account) {
  return account.selection==='unconfigured' || account.selection==='enabled' &&
    (!account.supported || !account.import_start || !catalog.some(item=>item.id===account.zenmoney_account_id && item.currency===account.currency));
}
function dateInput(value) {return node('input','',{type:'date',value,max:today(),required:true});}
function accountForm(account) {
  const saved=!accountNeedsSetup(account);
  let saving=false;
  const form=node('form','',{className:'account'}), title=node('strong',account.label || account.masked_number);
  form.append(title,node('small',`${account.masked_number} · ${account.currency}`));
  const target=node('select','',{'ariaLabel':`ZenMoney account for ${account.label}`});
  target.append(node('option','Select an account…',{value:''}),node('option','Do not import',{value:'ignored'}));
  for(const item of catalog.filter(item=>item.currency===account.currency))target.append(node('option',item.title,{value:item.id}));
  if(account.zenmoney_account_id && !catalog.some(item=>item.id===account.zenmoney_account_id)){
    target.append(node('option','The previous account is unavailable',{value:account.zenmoney_account_id,disabled:true}));
  }
  target.value=account.selection==='ignored'?'ignored':account.zenmoney_account_id || '';
  if(!account.supported){form.append(node('p',account.unsupported_reason));target.value='ignored';}
  const label=node('label','Import into ZenMoney account');label.append(target);form.append(label);
  const date=dateInput(account.import_start || daysAgo(30)), dateLabel=node('label','Initial import start date');dateLabel.append(date);form.append(dateLabel);
  const shortcuts=node('div','',{className:'shortcuts'});
  for(const [text,value] of [['30 days',()=>daysAgo(30)],['6 months',()=>monthsAgo(6)]]){
    const button=node('button',text,{type:'button'});button.addEventListener('click',()=>{date.value=value();date.dispatchEvent(new Event('input',{bubbles:true}));});shortcuts.append(button);
  }
  const syncFields=()=>{const enabled=target.value && target.value!=='ignored';date.disabled=!enabled;dateLabel.hidden=!enabled;shortcuts.hidden=!enabled;};
  target.addEventListener('change',syncFields);syncFields();form.append(shortcuts);
  const save=node('button',saved?'Saved':'Save account',{type:'submit',disabled:saved});
  const feedback=node('p',saved?'Account saved.':'',{className:'account-status',role:'status',ariaLive:'polite',hidden:!saved});
  feedback.dataset.tone='success';form.append(save,feedback);
  const localStatus=(text,tone)=>{feedback.textContent=text;feedback.dataset.tone=tone;feedback.hidden=false;};
  form.addEventListener('input',()=>{if(!saving){save.textContent='Save account';save.disabled=false;feedback.hidden=true;}});
  form.addEventListener('change',()=>{if(!saving){save.textContent='Save account';save.disabled=false;feedback.hidden=true;}});
  form.addEventListener('invalid',()=>localStatus('Check the selected account and import start date.','error'),true);
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(saving)return;
    if(!target.value){localStatus('Select a ZenMoney account or Do not import.','error');return;}
    if(target.value!=='ignored' && (!validDate(date.value) || date.value>today())){localStatus(messages.validation_error,'error');return;}
    saving=true;save.textContent='Saving…';localStatus('Saving account…','loading');status('Saving account…','loading');
    const controls=[...form.querySelectorAll('input,select,button')];for(const control of controls)control.disabled=true;
    try {
      const result=await rpc({type:'settings',accountId:account.id,settings:{expected_version:account.settings_version,
        selection:target.value==='ignored'?'ignored':'enabled',zenmoney_account_id:target.value==='ignored'?null:target.value,
        import_start:target.value==='ignored'?null:date.value}});
      view.connection.accounts=view.connection.accounts.map(a=>a.id===account.id?result.account:a);
      form.replaceWith(accountForm(result.account));
      status('Account saved.','success');updateButton();
      if(!connectionDraftPending && !view.connection.accounts.some(accountNeedsSetup))$('settings').open=false;
    } catch(error){
      showError(error);
      localStatus(error.code==='backend_unavailable'?'Could not confirm that the account was saved. Refresh the account list.':messages[error.code] || 'Could not save the account. Try again later.','error');
    }finally{
      saving=false;for(const control of controls)control.disabled=false;syncFields();save.textContent='Save account';
    }
  });
  return form;
}
function renderAccounts() {
  $('accounts').replaceChildren();
  if(!view)return;
  if(!view.connection.accounts_complete)$('accounts').append(node('p','The selected account was detected. Open the other bank accounts to add them to settings.',{className:'muted'}));
  for(const account of view.connection.accounts)$('accounts').append(accountForm(account));
  $('accounts').append(node('p','Create new ZenMoney accounts in the mobile app.',{className:'muted'}));
}
function refresh() {
  if(!refreshTask)refreshTask=refreshData().finally(()=>{refreshTask=null;});
  return refreshTask;
}
async function refreshData() {
  compatible=false;renderLastSync(null);status('Loading account settings…','loading');$('refresh-accounts').disabled=true;$('accounts').inert=true;for(const control of $('accounts').querySelectorAll('input,select,button'))control.disabled=true;updateButton();
  try {
    view=await rpc({type:'inspect'});compatible=true;renderLastSync(view.lastSyncedAt);
    $('bank').textContent=({vietinbank:'VietinBank',bidv:'BIDV'})[view.bank] || view.bank;
    const result=await rpc({type:'catalog'});catalog=result.accounts;renderAccounts();
    const pending=view.connection.accounts.some(accountNeedsSetup);
    if(pending){$('settings').open=true;status('Select the accounts to import.');}
    else if(!capture)status(view.connection.accounts.some(a=>a.selection==='enabled' && a.supported)?'Ready to synchronize.':messages.account_disabled);
    else progress(capture);
  } catch(error){showError(error);}finally{$('refresh-accounts').disabled=false;$('accounts').inert=false;updateButton();}
}
let connectionEdited=false;
const migration=setupMigration({rpc,refresh:async()=>{capture=null;view=null;await refresh();},
  lock:value=>{busy=value;updateButton();},pause:value=>{migrationPaused=value;updateButton();}});
for(const id of ['url','token'])$(id).addEventListener('input',()=>{
  connectionEdited=true;connectionDraftPending=true;
  // Issue the write on input, before the popup can close; no debounce/unload hook.
  chrome.storage.session.set({connectionDraft:{url:$('url').value,token:$('token').value}})
    .catch(()=>status('Could not save the entered settings. Enter them again.','error'));
});
$('server-form').addEventListener('submit',async event=>{
  event.preventDefault();busy=true;status('Connecting to the server…','loading');updateButton();
  try {
    if(!await chrome.permissions.request({origins:[permissionOrigin($('url').value)]}))throw Object.assign(Error(),{code:'invalid_server'});
    await rpc({type:'configure',url:$('url').value,token:$('token').value});
    $('token').value='';configured=true;connectionDraftPending=false;capture=null;
    $('connection-settings').open=false;$('settings').open=false;renderLastSync(null);await migration.refresh();await refresh();
  } catch(error){showError(error);}finally{busy=false;updateButton();}
});
$('discrepancies').addEventListener('click',async()=>{try{await rpc({type:'open-discrepancies'});}catch(error){showError(error);}});
$('refresh-accounts').addEventListener('click',refresh);
$('reimport').max=today();
$('sync').addEventListener('click',async()=>{
  busy=true;updateButton();
  try {
    if(['planned','collecting'].includes(capture?.phase)){await rpc({type:'stop'});}
    else {
      // Request only this bank, from the explicit click, not broad HTTPS access.
      if(!view?.origin || !await chrome.permissions.request({origins:[view.origin]}))throw Object.assign(Error(),{code:'unsupported_bank'});
      const date=$('reimport').value;
      if(date && (!validDate(date) || date>today()))throw Object.assign(Error(),{code:'validation_error'});
      await rpc({type:'reimport',date});
      reimportSaved=date;
      status('Starting synchronization…','loading');await rpc({type:'start'});
    }
    const state=await rpc({type:'status'});progress(state.capture);await migration.refresh();
  } catch(error){showError(error);}finally{busy=false;updateButton();}
});
try {
 const [state,{connectionDraft}]=await Promise.all([rpc({type:'status'}),chrome.storage.session.get('connectionDraft')]);
 configured=state.configured;
 if(!connectionEdited){$('url').value=connectionDraft?.url ?? state.url;$('token').value=connectionDraft?.token ?? '';}
 $('reimport').value=state.reimportFrom;
 reimportSaved=state.reimportFrom;
 connectionDraftPending=connectionEdited || !!connectionDraft;
 $('connection-settings').open=!state.configured || connectionDraftPending;
 $('settings').open=!state.configured || connectionDraftPending;capture=state.capture;
 if(state.configured){await migration.refresh();await refresh();}else status(messages.not_configured);
 if(capture && (compatible || ['planned','collecting'].includes(capture.phase)))progress(capture);
} catch(error){showError(error);}
setInterval(async()=>{
 try{const state=await rpc({type:'status'});renderLastSync(compatible?state.lastSyncedAt:null);if(JSON.stringify(state.capture)!==JSON.stringify(capture))progress(state.capture);
  if(reimportSaved && !state.reimportFrom && $('reimport').value===reimportSaved)$('reimport').value='';
  reimportSaved=state.reimportFrom;
 }catch{}
},1500);
