import {Backend, SyncError, serverAddress} from './backend-client.js';
import {Coordinator} from './coordinator.js';
import {connectorFor,connectorById} from './connectors/index.js';
import {bankName,profileStorageKey,resolveProfile,automaticProfile,canAttach,accountSignature} from './bank-profiles.js';

const secureStorage = Promise.all(['local','session'].map(area =>
  chrome.storage[area].setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})));
const store = {
  get: async () => (await chrome.storage.local.get('capture')).capture,
  set: async capture => {
    const {config,syncHistory={}}=await chrome.storage.local.get(['config','syncHistory']);
    if(config && capture.completedAt){
      const key=config.url+'|'+capture.connection.id;
      if(!syncHistory[key] || capture.completedAt>syncHistory[key])syncHistory[key]=capture.completedAt;
    }
    await chrome.storage.local.set({capture,syncHistory});
  },
};
let queue = Promise.resolve();
function serial(operation) {
  const task = queue.then(operation); queue = task.catch(()=>{}); return task;
}
async function configuration() {
  const {config} = await chrome.storage.local.get('config');
  if (!config) throw new SyncError('not_configured'); return config;
}
async function coordinator() {
  return new Coordinator({store,backend:new Backend(await configuration()),connector:connectorById});
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({active:true,lastFocusedWindow:true});
  if (!tab || !connectorFor(tab.url)) throw new SyncError('unsupported_bank'); return tab;
}
async function savedReimport(config,view) {
  if(!config || !view?.connection)return '';
  const {reimportDates={},reimportFrom}=await chrome.storage.local.get(['reimportDates','reimportFrom']);
  const key=config.url+'|'+view.connection.id;
  if(reimportFrom && !Object.keys(reimportDates).length) {
    reimportDates[key]=reimportFrom;await chrome.storage.local.set({reimportDates});
    await chrome.storage.local.remove('reimportFrom');
  }
  return reimportDates[key] || '';
}
async function inspect({profileKey=null,label=null}={}) {
  const config = await configuration(), client = new Backend(config);
  await savedReimport(config,(await chrome.storage.local.get('view')).view);
  await client.info();
  const tab = await activeTab(), adapter = connectorFor(tab.url);
  const {profiles={},selectedProfiles={},creatingProfiles={}}=await chrome.storage.local.get(['profiles','selectedProfiles','creatingProfiles']);
  const key=profileStorageKey(config.url,adapter.id);
  const detected=await adapter.inspect(tab,'probe');
  let connections;
  try {({connections}=await client.request('/connections?bank='+encodeURIComponent(adapter.id)));}
  catch(error){if(error.code==='not_found')throw new SyncError('unsupported_api_version');throw error;}
  let selected=profileKey ? connections.find(c=>c.profile_key===profileKey) : (resolveProfile(connections,detected.discovery.accounts,selectedProfiles[key] || profiles[key]) || automaticProfile(connections,detected.discovery.accounts,detected.primaryAccount));
  if(profileKey && (!selected || !canAttach(connections,selected,detected.discovery.accounts)))throw new SyncError('bank_connection_changed');
  if(label!==null || (!selected && connections.length===0)) {
    if(label!==null) {
      if(typeof label!=='string' || !label.trim() || label.length>120)throw new SyncError('validation_error');
      // Reuse a persisted creation identity after popup closure or a lost ACK.
      const signature=accountSignature(detected.discovery.accounts);
      if(creatingProfiles[key]?.signature!==signature) {
        creatingProfiles[key]={profileKey:crypto.randomUUID(),signature};await chrome.storage.local.set({creatingProfiles});
      }
      selected={profile_key:creatingProfiles[key].profileKey,profile_identity:'user_selected'};
    } else selected={profile_key:profiles[key] || crypto.randomUUID(),profile_identity:'user_selected'};
    if(!profiles[key]) {profiles[key]=selected.profile_key;await chrome.storage.local.set({profiles});}
  }
  let connection=null;
  if(selected) {
    const discovery={...detected.discovery,profile_key:selected.profile_key,profile_identity:selected.profile_identity || 'user_selected'};
    if(label!==null || !connections.some(c=>c.profile_key===selected.profile_key))discovery.label=label?.trim() || detected.ownerName?.slice(0,120) || bankName(adapter.id)+' 1';
    connection=await client.request('/connections/discover','POST',discovery);
    connections=[...connections.filter(c=>c.id!==connection.id),connection];
    selectedProfiles[key]=connection.profile_key;
    if(creatingProfiles[key]?.profileKey===connection.profile_key) {
      await chrome.storage.session.remove('bankProfileDraft');delete creatingProfiles[key];
    }
    await chrome.storage.local.set({selectedProfiles,creatingProfiles});
  }
  const {syncHistory={}}=await chrome.storage.local.get('syncHistory');
  const view={tabId:tab.id,bank:adapter.id,origin:adapter.origin,ownerName:detected.ownerName?.slice(0,120) || null,connection,connections,
    selectionRequired:!connection,detectedAccounts:detected.discovery.accounts,
    lastSyncedAt:connection ? syncHistory[config.url+'|'+connection.id] || null : null};
  view.reimportFrom=await savedReimport(config,view);
  await chrome.storage.local.set({view});
  return view;
}
async function requireIdle() {
  const capture=await store.get();
  if(capture && ['planned','collecting','paused'].includes(capture.phase))throw new SyncError('account_busy');
}
async function requireView(connectionId) {
  const {view}=await chrome.storage.local.get('view');
  if(!view?.connection || view.connection.id!==connectionId)throw new SyncError('bank_connection_changed');
  return view;
}
async function popup(data) {
  if(data.type==='migration-status')return new Backend(await configuration()).request('/migration/status');
  if(data.type==='migration-prepare-export'){
    const current=await store.get();
    if(current && ['planned','collecting','paused'].includes(current.phase))await (await coordinator()).stop();
    await chrome.alarms.clear('capture');
    return {};
  }
  if(data.type==='migration-imported'){
    await chrome.storage.local.remove(['view','capture','reimportFrom','reimportDates']);
    await chrome.alarms.clear('capture');
    return {};
  }
  if(data.type==='migration-resume')return new Backend(await configuration()).request('/migration/resume','POST',{});
  if (data.type === 'status') {
    const {config,view,capture,syncHistory={}} = await chrome.storage.local.get(['config','view','capture','syncHistory']);
    return {configured:!!config,url:config?.url || '',view,capture,reimportFrom:await savedReimport(config,view),
      lastSyncedAt:config && view?.connection ? syncHistory[config.url+'|'+view.connection.id] || null : null};
  }
  if (data.type === 'configure') {
    const {capture,config:previous} = await chrome.storage.local.get(['capture','config']);
    const config = {url:serverAddress(data.url),token:data.token.trim()};
    const resume = capture?.phase === 'paused' && previous?.url === config.url;
    if (capture && ['collecting','planned','paused'].includes(capture.phase) && !resume) throw new SyncError('account_busy');
    if (!config.token || config.token.length > 4096) throw new SyncError('unauthorized');
    await new Backend(config).info();
    // A repaired credential must not lose a paused job or an unknown POST ACK.
    // Store both atomically; synchronization still needs the user's next click.
    await chrome.storage.local.set({config,...(resume ? {capture:{...capture,error:null}} : {})});
    // Clear even when the popup closed while the connection was being checked.
    await chrome.storage.session.remove('connectionDraft');
    if (!resume) await chrome.storage.local.remove(['view','capture','reimportFrom']);
    return {configured:true};
  }
  if (data.type === 'open-discrepancies') {
    const {view}=await chrome.storage.local.get('view');
    if(!view?.connection?.id)throw new SyncError('unsupported_bank');
    await chrome.tabs.create({url:chrome.runtime.getURL('discrepancies.html')+'?connection='+encodeURIComponent(view.connection.id)});
    return {};
  }
  if (data.type === 'inspect') return inspect();
  if(data.type==='select-bank-connection') {
    await requireIdle();return inspect({profileKey:data.profileKey});
  }
  if(data.type==='create-bank-connection') {
    await requireIdle();return inspect({label:data.label});
  }
  if(data.type==='rename-bank-connection') {
    const view=await requireView(data.connectionId);
    await new Backend(await configuration()).request(`/connections/${view.connection.id}/label`,'PUT',{label:data.label});
    return inspect();
  }
  if(data.type==='unlink-bank-account') {
    await requireIdle();const view=await requireView(data.connectionId);
    if(!view.connection.accounts.some(a=>a.id===data.accountId))throw new SyncError('bank_connection_changed');
    await new Backend(await configuration()).request(`/connections/${view.connection.id}/accounts/${data.accountId}/unlink`,'POST',{});
    return inspect();
  }
  if (data.type === 'catalog') return new Backend(await configuration()).request('/zenmoney/accounts');
  if (data.type === 'settings') {
    const view = await requireView(data.connectionId);
    if (!view.connection.accounts.some(account => account.id === data.accountId)) throw new SyncError('capture_context_changed');
    const result = await new Backend(await configuration()).request(`/accounts/${data.accountId}/settings`,'PUT',data.settings);
    view.connection.accounts = view.connection.accounts.map(account => account.id === result.id ? result : account);
    await chrome.storage.local.set({view}); return {account:result};
  }
  if (data.type === 'reimport') {
    // The backend validates the actual bank calendar and supported depth.
    if (data.date && !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) throw new SyncError('validation_error');
    const view=await requireView(data.connectionId),config=await configuration();
    const {reimportDates={}}=await chrome.storage.local.get('reimportDates');
    reimportDates[config.url+'|'+view.connection.id]=data.date || '';
    await chrome.storage.local.set({reimportDates});await chrome.storage.local.remove('reimportFrom');return {};
  }
  if (data.type === 'start') {
    const view = await inspect();
    if(!view.connection)throw new SyncError('bank_connection_required');
    if(view.connection.id!==data.connectionId)throw new SyncError('bank_connection_changed');
    const adapter = connectorById(view.bank);
    await adapter.prepare(view.tabId);
    const reimportFrom = await savedReimport(await configuration(),view) || null;
    await chrome.alarms.create('capture',{periodInMinutes:.5});
    const capture = await (await coordinator()).start({connection:view.connection,bank:view.bank,tabId:view.tabId,reimportFrom});
    return {capture};
  }
  if (data.type === 'stop') { await (await coordinator()).stop(); await chrome.alarms.clear('capture'); return {}; }
  throw new SyncError('unsupported_command');
}
async function discrepancyReport(data,sender) {
  if(data.type!=='discrepancies')throw new SyncError('unauthorized');
  const connection=new URL(sender.url).searchParams.get('connection');
  if(!/^[0-9a-f-]{36}$/i.test(connection || ''))throw new SyncError('validation_error');
  const query=new URLSearchParams();
  for(const key of ['from_date','to_date','account_id'])if(data[key])query.set(key,data[key]);
  if(data.refresh)query.set('refresh','true');
  const client=new Backend(await configuration());await client.info();
  return {report:await client.request('/connections/'+connection+'/discrepancies?'+query)};
}
async function captured(data,sender) {
  const state = await store.get(), adapter = connectorById(state?.bank);
  if (!adapter || sender.frameId !== 0 || !sender.tab || !adapter.supports(sender.url)) throw new SyncError('unauthorized');
  const tab = await chrome.tabs.get(sender.tab.id);
  if (adapter.accountFromUrl(tab.url) !== data.account) throw new SyncError('capture_context_changed');
  const source = {tabId:sender.tab.id,documentId:sender.documentId,account:adapter.accountFromUrl(tab.url)};
  const engine = await coordinator();
  if (data.type === 'capture-check') { await engine.guard(data.runId,source); return {}; }
  if (data.type === 'capture-page') return engine.page(data.runId,source,data.data);
  if (data.type === 'capture-complete') { await engine.complete(data.runId,source); return {}; }
  if (data.type === 'capture-next') { await tick(); return {}; }
  if (data.type === 'capture-error') {
    await engine.guard(data.runId,source);
    await engine.pause(data.code === 'bank_login_required' ? data.code : 'history_incomplete');
    const stages=['network_ready','open_history','history_response','open_filter','start_date','end_date','apply_filter','filtered_rows','read_rows','load_more','save_pages'];
    if(state.bank==='bidv' && stages.includes(data.stage)){const paused=await store.get();paused.errorStage=data.stage;await store.set(paused);}
    return {};
  }
  throw new SyncError('unsupported_command');
}
async function recover(error) {
  const state = await store.get();
  if (state && ['planned','collecting'].includes(state.phase)) {
    await (await coordinator()).pause(error.code || 'backend_unavailable');
  }
}
async function tick() {
  await secureStorage;
  try {
    const state = await (await coordinator()).pump();
    if (!state || ['cancelled','failed','paused'].includes(state.phase)) await chrome.alarms.clear('capture');
    if (state?.phase === 'complete') {
      // Backfill is a one-shot collection request. A blocked delivery is still
      // visible and does not authorize recapture or another send.
      const config=await configuration(),{reimportDates={}}=await chrome.storage.local.get('reimportDates');
      const key=config.url+'|'+state.connection.id;
      if(state.command.reimport_from && reimportDates[key]===state.command.reimport_from) {
        delete reimportDates[key];await chrome.storage.local.set({reimportDates});
      }
      if (['complete','blocked'].includes(state.job.delivery_state)) await chrome.alarms.clear('capture');
    }
  } catch (error) { await recover(error); }
}
chrome.runtime.onMessage.addListener((data,sender,reply) => {
  serial(async()=>{
    try {
      await secureStorage;
      if (sender.id !== chrome.runtime.id) throw new SyncError('unauthorized');
      const isPopup = sender.url === chrome.runtime.getURL('popup.html');
      const isReport=sender.url?.split('?')[0]===chrome.runtime.getURL('discrepancies.html');
      const value = await (isPopup ? popup(data) : isReport ? discrepancyReport(data,sender) : captured(data,sender));
      return {ok:true,...value};
    } catch(error) {
      const current=await store.get();
      const ownsCapture=current?.driver?.runId===data.runId && current?.tabId===sender.tab?.id && current?.driver?.documentId===sender.documentId;
      // Recovery belongs to the same queue entry: token repair and another
      // resume must not race with pausing the failed request.
      if (data.type==='start' || ownsCapture) await recover(error).catch(()=>{});
      return {ok:false,error:error.code || 'internal_error'};
    }
  }).then(reply,()=>reply({ok:false,error:'internal_error'}));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'capture') serial(tick); });
chrome.runtime.onStartup.addListener(()=>serial(async()=>{
  await secureStorage;
  const state=await store.get();
  if(state && ['planned','collecting'].includes(state.phase)) {
    await chrome.alarms.create('capture',{periodInMinutes:.5}); await tick();
  }
}));
chrome.tabs.onRemoved.addListener(tabId=>serial(async()=>{
  const state=await store.get();
  if(state?.tabId===tabId && ['planned','collecting'].includes(state.phase)) await (await coordinator()).pause('bank_login_required');
}));
// Alarms are not guaranteed to survive every Chrome update/restart. Restore
// only previously authorized work; never start a new job on page load.
serial(async()=>{
  await secureStorage;
  const state=await store.get();
  if(state && (['planned','collecting'].includes(state.phase) ||
      (state.phase==='complete' && ['waiting','running'].includes(state.job?.delivery_state))) &&
      !await chrome.alarms.get('capture')) await chrome.alarms.create('capture',{periodInMinutes:.5});
});
