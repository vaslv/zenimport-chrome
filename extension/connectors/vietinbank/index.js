import {historyAccount} from './parser.js';
export {parsePage} from './parser.js';
export {historyAccount as accountFromUrl} from './parser.js';

export const id = 'vietinbank';
export const version = '3.0.0';
export const origin = 'https://ipay.vietinbank.vn/*';
export const capabilities = {timezone: 'Asia/Ho_Chi_Minh', currencies: ['VND'], max_window_days: 30, details: 'included'};
export const supports = url => !!historyAccount(url);

// Serialized into an isolated world. No server address or token is an argument.
function probePage() {
  const url = new URL(location.href), account = url.searchParams.get('accountNo');
  const label = document.querySelector('.vt-select__single-value .cus-option')?.textContent?.replace(/\s+/g, ' ').trim();
  if (url.origin !== 'https://ipay.vietinbank.vn' || url.pathname !== '/payment-history' || !/^\d{6,30}$/.test(account || '') ||
      !label?.startsWith(account + ' - ') || !label.endsWith(' - Current account')) return null;
  const currency = /\b(VND|USD|EUR|RUB)\b/.exec(label)?.[1] || 'VND';
  // Only the selected account source has been observed. Do not pretend this is
  // the complete list of a login or scrape unverified React internal objects.
  return {account, accounts_complete: false, accounts: [{source_key: account, identity_scope: 'bank', label,
    masked_number: '••••' + account.slice(-4), currency, scale: currency === 'VND' ? 0 : 2,
    supported: currency === 'VND', unsupported_reason: currency === 'VND' ? null : 'Пока подтверждена только история VND.'}]};
}

export async function inspect(tab, profileKey) {
  if (!supports(tab.url)) throw Object.assign(Error(), {code: 'unsupported_bank'});
  let result;
  try { [result] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: probePage}); }
  catch { throw Object.assign(Error(), {code: 'bank_login_required'}); }
  if (!result?.result) throw Object.assign(Error(), {code: 'bank_login_required'});
  return {documentId: result.documentId, currentAccount: result.result.account,
    discovery: {bank: id, connector_version: version, profile_key: profileKey, profile_identity: 'user_selected',
      capabilities, accounts_complete: result.result.accounts_complete, accounts: result.result.accounts}};
}

export async function selectAccount(tabId, account) {
  const tab = await chrome.tabs.get(tabId);
  if (!supports(tab.url)) throw Object.assign(Error(), {code: 'bank_login_required'});
  if (historyAccount(tab.url) !== account) {
    const url = new URL(tab.url); url.searchParams.set('accountNo', account);
    await chrome.tabs.update(tabId, {url: url.href});
  }
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const current = await chrome.tabs.get(tabId);
    if (current.status === 'complete' && historyAccount(current.url) === account) {
      try { const result = await inspect(current, 'probe'); if (result.currentAccount === account) return result.documentId; } catch {}
    }
    if (current.status === 'complete' && !supports(current.url)) throw Object.assign(Error(), {code: 'bank_login_required'});
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw Object.assign(Error(), {code: 'capture_context_changed'});
}

export async function prepare(tabId) {
  const identifier = 'zenimport-vietinbank-observer-v3';
  const scripts = await chrome.scripting.getRegisteredContentScripts({ids:[identifier]});
  if (!scripts.length) {
    await chrome.scripting.registerContentScripts([{id:identifier,matches:[origin],
      js:['connectors/vietinbank/observer.js'],world:'MAIN',runAt:'document_start',persistAcrossSessions:true}]);
    // Required once: the bank caches fetch before a late script injection.
    const [old] = await chrome.scripting.executeScript({target:{tabId},func:()=>true});
    await chrome.tabs.reload(tabId);
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        const current = await chrome.tabs.get(tabId);
        if (current.status === 'complete') {
          const [fresh] = await chrome.scripting.executeScript({target:{tabId},func:()=>true});
          if (fresh.documentId !== old.documentId) return;
        }
      } catch {}
      await new Promise(resolve=>setTimeout(resolve,300));
    }
    throw Object.assign(Error(),{code:'bank_login_required'});
  }
}
export async function running(tabId, driver) {
  try {
    const [result] = await chrome.scripting.executeScript({target:{tabId,documentIds:[driver.documentId]},
      func:runId => globalThis.__zenImportCaptureRun === runId,args:[driver.runId]});
    return result.result === true;
  } catch { return false; }
}
export async function launch(tabId, driver) {
  await chrome.scripting.executeScript({target:{tabId,documentIds:[driver.documentId]},
    func:config => {globalThis.__zenImportCaptureConfig=config;},args:[driver]});
  await chrome.scripting.executeScript({target:{tabId,documentIds:[driver.documentId]},files:['connectors/vietinbank/driver.js']});
}
export async function abort(tabId) {
  await chrome.tabs.sendMessage(tabId,{type:'capture-abort'},{frameId:0});
}
