import {SyncError, serverAddress} from './backend-client.js';
import {Coordinator} from './coordinator.js';
import {connectorFor,connectorById} from './connectors/index.js';
import {bankName,profileStorageKey,resolveProfile,automaticProfile,canAttach,accountSignature} from './bank-profiles.js';
import {message,assertMessageContext} from '../src/application/messages.ts';
import {controlCommands,adoptsControlContext} from '../src/application/control-messages.ts';
import {controlCommand,controlStatus} from '../src/application/control-api.ts';
import {DeliveryAlarms,DELIVERY_ALARM} from '../src/local/delivery/alarms.ts';
import {ControlAlarms,CONTROL_ALARM} from './background-controls.js';

export function installBackground({runtime,standalone=false}) {
const controls=standalone?new ControlAlarms(runtime,chrome.storage.local,chrome.alarms):null;
const delivery=standalone?new DeliveryAlarms(chrome.alarms,async()=>{
  const app=await runtime.current();
  if(!app?.local||app.root.pendingSwitchId!==null||app.awaitingSync)return null;
  const readiness=await app.local.readiness();
  return readiness.configured?app.local.delivery:null;
}):null;
async function restoreWakeups(){
  if(controls)await controls.restore();
  if(delivery)await delivery.restore();
}
async function recoverSettings(app){
  // A failed account settings recovery must not suppress independent migration
  // watchdogs. Native holds still block ordinary financial work on failure.
  try{if(app?.local&&app.root.pendingSwitchId===null)await app.local.recoverSettings();}
  finally{await restoreWakeups();}
}

const secureStorage = Promise.all(['local','session'].map(area =>
  chrome.storage[area].setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})));
const store = {
  get: async app => (await app.state.get('capture')).capture,
  set: async (app,capture) => {
    const config=app.config,{syncHistory={}}=await app.state.get('syncHistory');
    if(config && capture.completedAt){
      const key=config.url+'|'+capture.connection.id;
      if(!syncHistory[key] || capture.completedAt>syncHistory[key])syncHistory[key]=capture.completedAt;
    }
    await app.state.set({capture,syncHistory});
  },
};
let queue = Promise.resolve();
function serial(operation) {
  const task = queue.then(operation); queue = task.catch(()=>{}); return task;
}
function requireApplication(app) {
  if (!app) throw new SyncError('not_configured');return app;
}
async function coordinator(app) {
  requireApplication(app);
  return new Coordinator({store:{get:()=>store.get(app),set:value=>store.set(app,value)},service:app.service,connector:connectorById});
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({active:true,lastFocusedWindow:true});
  if (!tab || !connectorFor(tab.url)) throw new SyncError('unsupported_bank'); return tab;
}
async function savedReimport(app,view) {
  const config=app?.config;
  if(!config || !view?.connection)return '';
  const {reimportDates={},reimportFrom}=await app.state.get(['reimportDates','reimportFrom']);
  const key=config.url+'|'+view.connection.id;
  if(reimportFrom && !Object.keys(reimportDates).length) {
    reimportDates[key]=reimportFrom;await app.state.set({reimportDates});
    await app.state.remove('reimportFrom');
  }
  return reimportDates[key] || '';
}
async function inspect(app,{profileKey=null,label=null}={}) {
  const {config,service:client}=requireApplication(app);
  await savedReimport(app,(await app.state.get('view')).view);
  await client.capabilities();
  const tab = await activeTab(), adapter = connectorFor(tab.url);
  const {profiles={},selectedProfiles={},creatingProfiles={}}=await app.state.get(['profiles','selectedProfiles','creatingProfiles']);
  const key=profileStorageKey(config.url,adapter.id);
  const detected=await adapter.inspect(tab,'probe');
  let connections;
  try {({connections}=await client.connections.list(adapter.id));}
  catch(error){if(error.code==='not_found')throw new SyncError('unsupported_api_version');throw error;}
  let selected=profileKey ? connections.find(c=>c.profile_key===profileKey) : (resolveProfile(connections,detected.discovery.accounts,selectedProfiles[key] || profiles[key]) || automaticProfile(connections,detected.discovery.accounts,detected.primaryAccount));
  if(profileKey && (!selected || !canAttach(connections,selected,detected.discovery.accounts)))throw new SyncError('bank_connection_changed');
  if(label!==null || (!selected && connections.length===0)) {
    if(label!==null) {
      if(typeof label!=='string' || !label.trim() || label.length>120)throw new SyncError('validation_error');
      // Reuse a persisted creation identity after popup closure or a lost ACK.
      const signature=accountSignature(detected.discovery.accounts);
      if(creatingProfiles[key]?.signature!==signature) {
        creatingProfiles[key]={profileKey:crypto.randomUUID(),signature};await app.state.set({creatingProfiles});
      }
      selected={profile_key:creatingProfiles[key].profileKey,profile_identity:'user_selected'};
    } else selected={profile_key:profiles[key] || crypto.randomUUID(),profile_identity:'user_selected'};
    if(!profiles[key]) {profiles[key]=selected.profile_key;await app.state.set({profiles});}
  }
  let connection=null;
  if(selected) {
    const discovery={...detected.discovery,profile_key:selected.profile_key,profile_identity:selected.profile_identity || 'user_selected'};
    if(label!==null || !connections.some(c=>c.profile_key===selected.profile_key))discovery.label=label?.trim() || detected.ownerName?.slice(0,120) || bankName(adapter.id)+' 1';
    connection=await client.connections.discover(discovery);
    connections=[...connections.filter(c=>c.id!==connection.id),connection];
    selectedProfiles[key]=connection.profile_key;
    if(creatingProfiles[key]?.profileKey===connection.profile_key) {
      await chrome.storage.session.remove('bankProfileDraft');delete creatingProfiles[key];
    }
    await app.state.set({selectedProfiles,creatingProfiles});
  }
  const {syncHistory={}}=await app.state.get('syncHistory');
  const view={tabId:tab.id,bank:adapter.id,origin:adapter.origin,ownerName:detected.ownerName?.slice(0,120) || null,connection,connections,
    selectionRequired:!connection,detectedAccounts:detected.discovery.accounts,
    lastSyncedAt:connection ? syncHistory[config.url+'|'+connection.id] || null : null};
  view.reimportFrom=await savedReimport(app,view);
  await app.state.set({view});
  return view;
}
async function requireIdle(app) {
  const capture=await store.get(app);
  if(capture && ['planned','collecting','paused'].includes(capture.phase))throw new SyncError('account_busy');
}
async function requireView(app,connectionId) {
  const {view}=await app.state.get('view');
  if(!view?.connection || view.connection.id!==connectionId)throw new SyncError('bank_connection_changed');
  return view;
}
async function popup(data,app) {
  if(standalone&&controlCommands.has(data.type)){
    if(!app)throw new SyncError('not_configured');
    if(!['storage-status','archive-status','archive-upload-status','archive-export-chunk','local-draft'].includes(data.type))await controls.arm();
    if(['storage-repair','storage-step','storage-retry','storage-cancel','archive-import-retry','archive-import-cancel','archive-export-retry','archive-export-cancel','local-configure'].includes(data.type))await controls.retry();
    const value=await controlCommand(data,runtime,app);
    return {...value,...(value.storage?{controlPause:await controls.pause()}: {})};
  }
  if(standalone&&data.type.startsWith('migration-'))throw new SyncError('unsupported_migration_version');
  if(!['status','configure'].includes(data.type))requireApplication(app);
  if(data.type==='migration-status')return requireApplication(app).service.migration.status();
  if(data.type==='migration-prepare-export'){
    const current=await store.get(app);
    if(current && ['planned','collecting','paused'].includes(current.phase))await (await coordinator(app)).stop();
    await chrome.alarms.clear('capture');
    return {};
  }
  if(data.type==='migration-imported'){
    await app.state.remove(['view','capture','reimportFrom','reimportDates']);
    await chrome.alarms.clear('capture');
    return {};
  }
  if(data.type==='migration-resume')return requireApplication(app).service.migration.resume();
  if (data.type === 'status') {
    const config=app?.config,{view,capture,syncHistory={}} = app ? await app.state.get(['view','capture','syncHistory']) : {};
    return {...(standalone&&app?{storage:await controlStatus(runtime,app),controlPause:await controls.pause()}:{}),
      configured:!!config?.token,url:app?.context.mode==='local'?'':config?.url || '',view,capture,reimportFrom:await savedReimport(app,view),
      lastSyncedAt:config && view?.connection ? syncHistory[config.url+'|'+view.connection.id] || null : null};
  }
  if (data.type === 'configure') {
    const capture=app ? await store.get(app) : null,previous=app?.config;
    const config = {url:serverAddress(data.url),token:data.token.trim()};
    const resume = capture?.phase === 'paused' && previous?.url === config.url;
    if (capture && ['collecting','planned','paused'].includes(capture.phase) && !resume) throw new SyncError('account_busy');
    if (!config.token || config.token.length > 4096) throw new SyncError('unauthorized');
    const selected=await runtime.configure(config,app);
    // A repaired credential must not lose a paused job or an unknown POST ACK.
    // Credential selection and checkpoint recovery retain the same command;
    // synchronization still needs the user's next click after either commits.
    if(resume)await selected.state.set({capture:{...capture,error:null}});
    // Clear even when the popup closed while the connection was being checked.
    await chrome.storage.session.remove('connectionDraft');
    if (!resume) await selected.state.remove(['view','capture','reimportFrom']);
    return {configured:true};
  }
  if (data.type === 'open-discrepancies') {
    const {view}=await app.state.get('view');
    if(!view?.connection?.id)throw new SyncError('unsupported_bank');
    await chrome.tabs.create({url:chrome.runtime.getURL('discrepancies.html')+'?connection='+encodeURIComponent(view.connection.id)+'&context='+app.context.dataset_id});
    return {};
  }
  if (data.type === 'inspect') return inspect(app);
  if(data.type==='select-bank-connection') {
    await requireIdle(app);return inspect(app,{profileKey:data.profileKey});
  }
  if(data.type==='create-bank-connection') {
    await requireIdle(app);return inspect(app,{label:data.label});
  }
  if(data.type==='rename-bank-connection') {
    const view=await requireView(app,data.connectionId);
    await requireApplication(app).service.connections.rename(view.connection.id,{label:data.label});
    return inspect(app);
  }
  if(data.type==='unlink-bank-account') {
    await requireIdle(app);const view=await requireView(app,data.connectionId);
    if(!view.connection.accounts.some(a=>a.id===data.accountId))throw new SyncError('bank_connection_changed');
    await requireApplication(app).service.connections.unlink(view.connection.id,data.accountId);
    return inspect(app);
  }
  if (data.type === 'catalog') return requireApplication(app).service.accounts.catalog();
  if (data.type === 'settings') {
    const view = await requireView(app,data.connectionId);
    if (!view.connection.accounts.some(account => account.id === data.accountId)) throw new SyncError('capture_context_changed');
    const result = await requireApplication(app).service.accounts.configure(data.accountId,data.settings);
    view.connection.accounts = view.connection.accounts.map(account => account.id === result.id ? result : account);
    await app.state.set({view}); return {account:result};
  }
  if (data.type === 'reimport') {
    // The backend validates the actual bank calendar and supported depth.
    if (data.date && !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) throw new SyncError('validation_error');
    const view=await requireView(app,data.connectionId),config=app.config;
    const {reimportDates={}}=await app.state.get('reimportDates');
    reimportDates[config.url+'|'+view.connection.id]=data.date || '';
    await app.state.set({reimportDates});await app.state.remove('reimportFrom');return {};
  }
  if (data.type === 'start') {
    const view = await inspect(app);
    if(!view.connection)throw new SyncError('bank_connection_required');
    if(view.connection.id!==data.connectionId)throw new SyncError('bank_connection_changed');
    const adapter = connectorById(view.bank);
    await adapter.prepare(view.tabId);
    const reimportFrom = await savedReimport(app,view) || null;
    await chrome.alarms.create('capture',{periodInMinutes:.5});
    const capture = await (await coordinator(app)).start({connection:view.connection,bank:view.bank,tabId:view.tabId,reimportFrom});
    return {capture};
  }
  if (data.type === 'stop') { await (await coordinator(app)).stop(); await chrome.alarms.clear('capture'); return {}; }
  throw new SyncError('unsupported_command');
}
async function discrepancyReport(data,sender,app) {
  if(data.type!=='discrepancies')throw new SyncError('unauthorized');
  const connection=new URL(sender.url).searchParams.get('connection');
  if(new URL(sender.url).searchParams.get('context')!==requireApplication(app).context.dataset_id)throw new SyncError('stale_context');
  if(!/^[0-9a-f-]{36}$/i.test(connection || ''))throw new SyncError('validation_error');
  const client=requireApplication(app).service;await client.capabilities();
  return {report:await client.reports.discrepancies(connection,data)};
}
async function captured(data,sender,app) {
  requireApplication(app);
  const state = await store.get(app), adapter = connectorById(state?.bank);
  if (!adapter || sender.frameId !== 0 || !sender.tab || !adapter.supports(sender.url)) throw new SyncError('unauthorized');
  const tab = await chrome.tabs.get(sender.tab.id);
  if (adapter.accountFromUrl(tab.url) !== data.account) throw new SyncError('capture_context_changed');
  const source = {tabId:sender.tab.id,documentId:sender.documentId,account:adapter.accountFromUrl(tab.url)};
  const engine = await coordinator(app);
  if (data.type === 'capture-check') { await engine.guard(data.runId,source); return {}; }
  if (data.type === 'capture-page') return engine.page(data.runId,source,data.data);
  if (data.type === 'capture-complete') { await engine.complete(data.runId,source); return {}; }
  if (data.type === 'capture-next') { await tick(app); return {}; }
  if (data.type === 'capture-error') {
    await engine.guard(data.runId,source);
    await engine.pause(data.code === 'bank_login_required' ? data.code : 'history_incomplete');
    const stages=['network_ready','open_history','history_response','open_filter','start_date','end_date','apply_filter','filtered_rows','read_rows','load_more','save_pages'];
    if(state.bank==='bidv' && stages.includes(data.stage)){const paused=await store.get(app);paused.errorStage=data.stage;await store.set(app,paused);}
    return {};
  }
  throw new SyncError('unsupported_command');
}
async function recover(error,app) {
  if(!app)return;
  const state = await store.get(app);
  if (state && ['planned','collecting'].includes(state.phase)) {
    await (await coordinator(app)).pause(error.code || 'backend_unavailable');
  }
}
async function tick(app) {
  if(!app||standalone&&app.root.pendingSwitchId!==null)return;
  await secureStorage;
  try {
    const state = await (await coordinator(app)).pump();
    if (!state || ['cancelled','failed','paused'].includes(state.phase)) await chrome.alarms.clear('capture');
    if (state?.phase === 'complete') {
      // Backfill is a one-shot collection request. A blocked delivery is still
      // visible and does not authorize recapture or another send.
      const config=app.config,{reimportDates={}}=await app.state.get('reimportDates');
      const key=config.url+'|'+state.connection.id;
      if(state.command.reimport_from && reimportDates[key]===state.command.reimport_from) {
        delete reimportDates[key];await app.state.set({reimportDates});
      }
      if (['complete','blocked'].includes(state.job.delivery_state)) await chrome.alarms.clear('capture');
    }
  } catch (error) { await recover(error,app); }
}
chrome.runtime.onMessage.addListener((data,sender,reply) => {
  serial(async()=>{
    let app,verificationError=null;
    try {
      await secureStorage;
      if (sender.id !== chrome.runtime.id) throw new SyncError('unauthorized');
      const isPopup = sender.url === chrome.runtime.getURL('popup.html');
      const isReport=sender.url?.split('?')[0]===chrome.runtime.getURL('discrepancies.html');
      data=message(data,isPopup?'popup':isReport?'report':'capture');
      app=await runtime.current(data.operation_id);
      if(standalone&&data.type==='status'){
        // Read-only verification strengthens old remote bindings; failure must
        // still expose setup and same-server token repair in the popup.
        try{app=await runtime.verifySelected(app);}catch(error){
          if(!['unauthorized','backend_unavailable','permission_required','unsupported_api_version','unsupported_migration_version','invalid_response','zenmoney_unavailable'].includes(error.code))throw error;
          verificationError=error.code;
        }
      }
      assertMessageContext(data.type==='status'?undefined:data.context,app?.context??null);
      const value = await (isPopup ? popup(data,app) : isReport ? discrepancyReport(data,sender,app) : captured(data,sender,app));
      const selected=(data.type==='configure'||standalone&&adoptsControlContext.has(data.type))?await runtime.current(data.operation_id):app;
      if(selected)await selected.assert(true);
      if(standalone){
        if(data.type==='configure')await controls.retry();
        await restoreWakeups();
      }
      return {ok:true,...value,...(verificationError?{verificationError}:{}),...(data.operation_id&&selected?{context:selected.context}:{})};
    } catch(error) {
      const current=app ? await store.get(app).catch(()=>null) : null;
      const ownsCapture=current?.driver?.runId===data?.runId && current?.tabId===sender.tab?.id && current?.driver?.documentId===sender.documentId;
      // Recovery belongs to the same queue entry: token repair and another
      // resume must not race with pausing the failed request.
      if (data?.type==='start' || ownsCapture) await recover(error,app).catch(()=>{});
      return {ok:false,error:error.code || 'internal_error'};
    }
  }).then(reply,()=>reply({ok:false,error:'internal_error'}));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => {
  serial(async()=>{
    await secureStorage;
    if(standalone&&alarm.name===CONTROL_ALARM){await controls.wake();await delivery.restore();}
    else if(standalone&&alarm.name===DELIVERY_ALARM)await delivery.wake(alarm.name);
    else if(alarm.name==='capture'){await tick(await runtime.current());if(delivery)await delivery.restore();}
  }).catch(()=>{});
});
chrome.runtime.onStartup.addListener(()=>serial(async()=>{
  await secureStorage;
  const app=await runtime.current();await recoverSettings(app);
  const state=app ? await store.get(app) : null;
  if(state && ['planned','collecting'].includes(state.phase)) {
    await chrome.alarms.create('capture',{periodInMinutes:.5}); await tick(app);
  }
}));
chrome.tabs.onRemoved.addListener(tabId=>serial(async()=>{
  const app=await runtime.current(),state=app ? await store.get(app) : null;
  if(app?.root.pendingSwitchId!==null&&standalone)return;
  if(state?.tabId===tabId && ['planned','collecting'].includes(state.phase)) await (await coordinator(app)).pause('bank_login_required');
}));
// Alarms are not guaranteed to survive every Chrome update/restart. Restore
// only previously authorized work; never start a new job on page load.
serial(async()=>{
  await secureStorage;
  const app=await runtime.current();await recoverSettings(app);
  const state=app ? await store.get(app) : null;
  if(state && (['planned','collecting'].includes(state.phase) ||
      (state.phase==='complete' && ['waiting','running'].includes(state.job?.delivery_state))) &&
      !await chrome.alarms.get('capture')) await chrome.alarms.create('capture',{periodInMinutes:.5});
});
}
