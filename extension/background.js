import {Backend, SyncError, serverAddress} from './backend-client.js';
import {Coordinator} from './coordinator.js';
import {connectorFor,connectorById} from './connectors/index.js';

const secureStorage = Promise.all(['local','session'].map(area =>
  chrome.storage[area].setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})));
const store = {
  get: async () => (await chrome.storage.local.get('capture')).capture,
  set: async capture => chrome.storage.local.set({capture}),
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
async function inspect() {
  const config = await configuration(), client = new Backend(config);
  await client.info();
  const tab = await activeTab(), adapter = connectorFor(tab.url);
  const {profiles = {}} = await chrome.storage.local.get('profiles');
  const key = config.url + '|' + adapter.id;
  if (!profiles[key]) { profiles[key] = crypto.randomUUID(); await chrome.storage.local.set({profiles}); }
  const detected = await adapter.inspect(tab,profiles[key]);
  const connection = await client.request('/connections/discover','POST',detected.discovery);
  const view={tabId:tab.id,bank:adapter.id,origin:adapter.origin,connection};
  await chrome.storage.local.set({view});
  return view;
}
async function popup(data) {
  if (data.type === 'status') {
    const {config,view,capture,reimportFrom} = await chrome.storage.local.get(['config','view','capture','reimportFrom']);
    return {configured:!!config,url:config?.url || '',view,capture,reimportFrom:reimportFrom || ''};
  }
  if (data.type === 'configure') {
    const capture = await store.get();
    if (capture && ['collecting','planned','paused'].includes(capture.phase)) throw new SyncError('account_busy');
    const config = {url:serverAddress(data.url),token:data.token.trim()};
    if (!config.token || config.token.length > 4096) throw new SyncError('unauthorized');
    await new Backend(config).info();
    await chrome.storage.local.set({config});
    // Clear even when the popup closed while the connection was being checked.
    await chrome.storage.session.remove('connectionDraft');
    await chrome.storage.local.remove(['view','capture']);
    return {configured:true};
  }
  if (data.type === 'inspect') return inspect();
  if (data.type === 'catalog') return new Backend(await configuration()).request('/zenmoney/accounts');
  if (data.type === 'settings') {
    const view = (await chrome.storage.local.get('view')).view;
    if (!view?.connection.accounts.some(account => account.id === data.accountId)) throw new SyncError('capture_context_changed');
    const result = await new Backend(await configuration()).request(`/accounts/${data.accountId}/settings`,'PUT',data.settings);
    view.connection.accounts = view.connection.accounts.map(account => account.id === result.id ? result : account);
    await chrome.storage.local.set({view}); return {account:result};
  }
  if (data.type === 'reimport') {
    // The backend validates the actual bank calendar and supported depth.
    if (data.date && !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) throw new SyncError('validation_error');
    await chrome.storage.local.set({reimportFrom:data.date || ''}); return {};
  }
  if (data.type === 'start') {
    const view = await inspect(), adapter = connectorById(view.bank);
    await adapter.prepare(view.tabId);
    const reimportFrom = (await chrome.storage.local.get('reimportFrom')).reimportFrom || null;
    await chrome.alarms.create('capture',{periodInMinutes:.5});
    const capture = await (await coordinator()).start({connection:view.connection,bank:view.bank,tabId:view.tabId,reimportFrom});
    return {capture};
  }
  if (data.type === 'stop') { await (await coordinator()).stop(); await chrome.alarms.clear('capture'); return {}; }
  throw new SyncError('unsupported_command');
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
    await engine.pause(data.code === 'bank_login_required' ? data.code : 'history_incomplete'); return {};
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
      const pending=(await chrome.storage.local.get('reimportFrom')).reimportFrom;
      if (state.command.reimport_from && pending===state.command.reimport_from) await chrome.storage.local.remove('reimportFrom');
      if (['complete','blocked'].includes(state.job.delivery_state)) await chrome.alarms.clear('capture');
    }
  } catch (error) { await recover(error); }
}
chrome.runtime.onMessage.addListener((data,sender,reply) => {
  serial(async()=>{
    await secureStorage;
    if (sender.id !== chrome.runtime.id) throw new SyncError('unauthorized');
    const isPopup = sender.url === chrome.runtime.getURL('popup.html');
    return isPopup ? popup(data) : captured(data,sender);
  }).then(value=>reply({ok:true,...value}),async error=>{
    const current=await store.get();
    const ownsCapture=current?.driver?.runId===data.runId && current?.tabId===sender.tab?.id && current?.driver?.documentId===sender.documentId;
    // A stale or forged content message must not cancel a newer valid run.
    if (data.type==='start' || ownsCapture) await recover(error).catch(()=>{});
    reply({ok:false,error:error.code || 'internal_error'});
  });
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
