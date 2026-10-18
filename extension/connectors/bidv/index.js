import {accountFromUrl,supports,bankOrigin} from './parser.js';
import {monthsAgo,today} from '../../dates.js';
export {parsePage,accountFromUrl,supports} from './parser.js';
export const id='bidv';
export const version='1.0.0';
export const origin=bankOrigin+'/*';
export const capabilities={timezone:'Asia/Ho_Chi_Minh',currencies:['VND'],max_window_days:30,details:'included'};
const error=code=>Object.assign(Error(),{code});

// Runs in ISOLATED world. Read only rendered payment cards; no Angular state,
// authentication fields, account-holder inference, cookies, or storage access.
export function probePage() {
  if(document.readyState==='loading' || location.origin!=='https://smartbanking.bidv.com.vn' ||
      !/^\/tai-khoan(?:\/thanh-toan\/\d{6,30})?\/?$/.test(location.pathname))return null;
  const current=location.pathname.match(/^\/tai-khoan\/thanh-toan\/(\d{6,30})\/?$/)?.[1];
  let cards=current ? [...document.querySelectorAll('main app-card-account')] : [...document.querySelectorAll('main app-card-account-2')];
  if(!current) {
    const label=e=>e.textContent?.replace(/\s+/g,' ').trim();
    const buttons=[...document.querySelectorAll('main button, main [role="button"]')];
    const payment=buttons.find(e=>/^Payment(?: Open account)?$/.test(label(e)));
    const savings=buttons.find(e=>/^Savings(?: Open account)?$/.test(label(e)));
    if(!payment || !savings)return null;
    // Observed page order brackets payment cards before Savings. Never treat a
    // same-currency deposit card elsewhere on Accounts as a payment account.
    cards=cards.filter(card=>(payment.compareDocumentPosition(card)&4) && (card.compareDocumentPosition(savings)&4));
  }
  const accounts=[];
  for(const card of cards) {
    const account=card.querySelector(current?'.card-account--no':'.card-account-2--no')?.textContent?.trim();
    const balance=card.querySelector(current?'.card-account--balance':'.card-account-2--amount')?.textContent?.trim();
    if(!/^\d{6,30}$/.test(account || '') || (current && current!==account) || !/\bVND$/.test(balance || ''))continue;
    if(accounts.some(a=>a.source_key===account))continue;
    accounts.push({source_key:account,identity_scope:'bank',label:'BIDV '+account,masked_number:'••••'+account.slice(-4),
      currency:'VND',scale:0,supported:true,unsupported_reason:null});
  }
  // Other currencies, loans, savings and hidden tabs have not been verified.
  return accounts.length ? {account:current || null,accounts_complete:false,accounts} : null;
}
export async function inspect(tab,profileKey) {
  if(!supports(tab.url))throw error('unsupported_bank');
  let result;
  try{[result]=await chrome.scripting.executeScript({target:{tabId:tab.id},injectImmediately:true,func:probePage});}
  catch{throw error('bank_login_required');}
  if(!result?.result)throw error('bank_login_required');
  return {documentId:result.documentId,currentAccount:result.result.account,discovery:{bank:id,connector_version:version,
    profile_key:profileKey,profile_identity:'user_selected',capabilities:{...capabilities,earliest_date:monthsAgo(12,today())},
    accounts_complete:false,accounts:result.result.accounts}};
}
export async function selectAccount(tabId,account) {
  const tab=await chrome.tabs.get(tabId);
  if(!supports(tab.url) || !/^\d{6,30}$/.test(account))throw error('bank_login_required');
  if(accountFromUrl(tab.url)!==account)await chrome.tabs.update(tabId,{url:bankOrigin+'/tai-khoan/thanh-toan/'+account});
  const deadline=Date.now()+30000;
  while(Date.now()<deadline) {
    const current=await chrome.tabs.get(tabId);
    if(!supports(current.url))throw error('bank_login_required');
    if(accountFromUrl(current.url)===account) {
      try {const found=await inspect(current,'probe');if(found.currentAccount===account)return found.documentId;}catch{}
    }
    await new Promise(resolve=>setTimeout(resolve,300));
  }
  throw error('capture_context_changed');
}
export async function prepare(tabId) {
  const identifier='zenimport-bidv-network-v1';
  if(!(await chrome.scripting.getRegisteredContentScripts({ids:[identifier]})).length) {
    await chrome.scripting.registerContentScripts([{id:identifier,matches:[origin],js:['connectors/bidv/observer.js'],world:'MAIN',runAt:'document_start',persistAcrossSessions:true}]);
  }
  // A persisted registration does not prove injection into a tab that was
  // already open while the extension was disabled or updated.
  const [old]=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',injectImmediately:true,func:()=>globalThis.__zenImportBidvNetwork===true});
  if(!old.result) {
    await chrome.tabs.reload(tabId);
    const deadline=Date.now()+30000;
    while(Date.now()<deadline) {
      try {
        const current=await chrome.tabs.get(tabId);
        if(!supports(current.url))throw error('bank_login_required');
        const [fresh]=await chrome.scripting.executeScript({target:{tabId},injectImmediately:true,func:()=>true});
        if(fresh.documentId!==old.documentId && (await inspect(current,'probe')).discovery.accounts.length)return;
      }catch{}
      await new Promise(resolve=>setTimeout(resolve,300));
    }
    throw error('bank_login_required');
  }
}
export async function running(tabId,driver) {
  try {const [r]=await chrome.scripting.executeScript({target:{tabId,documentIds:[driver.documentId]},injectImmediately:true,
    func:runId=>globalThis.__zenImportCaptureRun===runId,args:[driver.runId]});return r.result===true;}catch{return false;}
}
export async function launch(tabId,driver) {
  await chrome.scripting.executeScript({target:{tabId,documentIds:[driver.documentId]},injectImmediately:true,
    func:config=>{globalThis.__zenImportCaptureConfig=config;},args:[driver]});
  await chrome.scripting.executeScript({target:{tabId,documentIds:[driver.documentId]},injectImmediately:true,files:['connectors/bidv/driver.js']});
}
export async function abort(tabId){await chrome.tabs.sendMessage(tabId,{type:'capture-abort'},{frameId:0});}
