import {permissionOrigin} from './backend-client.js';
import {today,daysAgo,monthsAgo,validDate} from './dates.js';
const $ = id => document.getElementById(id);
const rpc = async data => {
  const result=await chrome.runtime.sendMessage(data);
  if(!result?.ok)throw Object.assign(Error(),{code:result?.error || 'backend_unavailable'});
  return result;
};
const messages={
  invalid_server:'Укажите HTTPS-адрес сервера или localhost.',unauthorized:'Проверьте токен сервера.',
  backend_unavailable:'Нет связи с сервером. Повторите позже.',invalid_response:'Сервер вернул неизвестный ответ.',
  unsupported_api_version:'Версии сервера и расширения несовместимы.',unsupported_bank:'Откройте историю операций поддерживаемого банка.',
  bank_login_required:'Войдите в банк и откройте историю операций.',not_configured:'Укажите сервер и токен сервера.',
  account_unconfigured:'Выберите счета для загрузки.',account_disabled:'Нет счетов для загрузки.',
  account_busy:'Сначала завершите или остановите текущий сбор.',capture_busy:'Историю уже читает другое расширение.',
  settings_conflict:'Настройки изменились. Обновите список счетов.',zenmoney_account_unavailable:'Счёт ZenMoney недоступен. Проверьте привязку.',
  zenmoney_unavailable:'ZenMoney временно недоступен.',history_incomplete:'Сбор прерван: банк вернул неполную историю. Повторите синхронизацию.',
  capture_context_changed:'Страница или счёт изменились. Повторите синхронизацию.',validation_error:'Проверьте выбранные счета и дату.',
};
const status=(text,tone='neutral')=>{ $('status').textContent=text; $('status').dataset.tone=tone; $('status').setAttribute('aria-busy',String(tone==='loading')); };
const showError=error=>status(messages[error.code] || 'Не удалось выполнить действие. Повторите позже.','error');
let configured=false,view=null,catalog=[],capture=null,compatible=false,busy=false,refreshTask=null,reimportSaved='';
function node(tag,text,attributes={}) {const value=document.createElement(tag);if(text)value.textContent=text;Object.assign(value,attributes);return value;}
function updateButton() {
  const active=['planned','collecting'].includes(capture?.phase);
  $('account-settings').hidden=!configured;
  $('history-settings').hidden=!compatible || !view?.connection.accounts.some(a=>a.selection==='enabled' && a.supported);
  $('connect').disabled=busy;
  $('url').disabled=busy;$('token').disabled=busy;
  $('sync').textContent=active?'Остановить сбор':'Синхронизировать';
  $('sync').disabled=busy || (!active && (!compatible || !view?.connection.accounts.some(a=>a.selection==='enabled' && a.supported)));
}
function progress(state) {
  capture=state;updateButton();
  if(!state)return;
  if(state.error && ['failed','paused'].includes(state.phase)){showError({code:state.error});return;}
  const job=state.job;
  if(['planned','collecting'].includes(state.phase)){
    const intervals=job?.accounts.flatMap(a=>a.intervals) || [];
    status(`Получаем историю: ${intervals.filter(i=>i.state==='complete').length} из ${intervals.length} периодов.`,'loading');return;
  }
  if(state.phase==='cancelled'){status('Сбор остановлен. Полученные данные сохранены.');return;}
  if(state.phase==='complete'){
    const d=job.delivery;
    status(job.delivery_state==='complete'
      ? `Готово. Обработано: ${d.delivered}. Исключено: ${d.suppressed}.`
      : job.delivery_state==='blocked' ? d.uncertain
        ? `История сохранена. Сервер проверяет отправку: ${d.uncertain}.`
        : `История сохранена. ${messages[job.errors?.at(-1)?.code] || 'Отправка приостановлена на сервере.'}`
      : `История сохранена. Сервер отправляет операции: ${d.pending}.`,job.delivery_state==='complete'?'success':job.delivery_state==='blocked'?'error':'loading');
  }
}
function dateInput(value) {return node('input','',{type:'date',value,max:today(),required:true});}
function accountForm(account) {
  const form=node('form','',{className:'account'}), title=node('strong',account.label || account.masked_number);
  form.append(title,node('small',`${account.masked_number} · ${account.currency}`));
  const target=node('select','',{'ariaLabel':`Счёт ZenMoney для ${account.label}`});
  target.append(node('option','Выберите счёт…',{value:''}),node('option','Не загружать',{value:'ignored'}));
  for(const item of catalog.filter(item=>item.currency===account.currency))target.append(node('option',item.title,{value:item.id}));
  if(account.zenmoney_account_id && !catalog.some(item=>item.id===account.zenmoney_account_id)){
    target.append(node('option','Прежний счёт недоступен',{value:account.zenmoney_account_id,disabled:true}));
  }
  target.value=account.selection==='ignored'?'ignored':account.zenmoney_account_id || '';
  if(!account.supported){form.append(node('p',account.unsupported_reason));target.value='ignored';}
  const label=node('label','Загружать на счёт ZenMoney');label.append(target);form.append(label);
  const date=dateInput(account.import_start || daysAgo(30)), dateLabel=node('label','Первый импорт — с даты');dateLabel.append(date);form.append(dateLabel);
  const shortcuts=node('div','',{className:'shortcuts'});
  for(const [text,value] of [['30 дней',()=>daysAgo(30)],['6 месяцев',()=>monthsAgo(6)]]){
    const button=node('button',text,{type:'button'});button.addEventListener('click',()=>{date.value=value();});shortcuts.append(button);
  }
  const syncFields=()=>{const enabled=target.value && target.value!=='ignored';date.disabled=!enabled;dateLabel.hidden=!enabled;shortcuts.hidden=!enabled;};
  target.addEventListener('change',syncFields);syncFields();form.append(shortcuts);
  const save=node('button','Сохранить счёт',{type:'submit'});form.append(save);
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!target.value){showError({code:'account_unconfigured'});return;}
    if(target.value!=='ignored' && (!validDate(date.value) || date.value>today())){showError({code:'validation_error'});return;}
    save.disabled=true;status('Сохраняем счёт…','loading');
    try {
      const result=await rpc({type:'settings',accountId:account.id,settings:{expected_version:account.settings_version,
        selection:target.value==='ignored'?'ignored':'enabled',zenmoney_account_id:target.value==='ignored'?null:target.value,
        import_start:target.value==='ignored'?null:date.value}});
      view.connection.accounts=view.connection.accounts.map(a=>a.id===account.id?result.account:a);
      status('Счёт сохранён.','success');renderAccounts();updateButton();
    } catch(error){showError(error);}finally{save.disabled=false;}
  });
  return form;
}
function renderAccounts() {
  $('accounts').replaceChildren();
  if(!view)return;
  if(!view.connection.accounts_complete)$('accounts').append(node('p','Обнаружен выбранный счёт. Откройте остальные счета банка, чтобы добавить их в настройки.',{className:'muted'}));
  for(const account of view.connection.accounts)$('accounts').append(accountForm(account));
  $('accounts').append(node('p','Новый счёт ZenMoney создайте в мобильном приложении.',{className:'muted'}));
}
function refresh() {
  if(!refreshTask)refreshTask=refreshData().finally(()=>{refreshTask=null;});
  return refreshTask;
}
async function refreshData() {
  compatible=false;status('Получаем настройки счетов…','loading');$('refresh-accounts').disabled=true;$('accounts').inert=true;for(const control of $('accounts').querySelectorAll('input,select,button'))control.disabled=true;updateButton();
  try {
    view=await rpc({type:'inspect'});compatible=true;
    $('bank').textContent=view.bank==='vietinbank'?'VietinBank':view.bank;
    const result=await rpc({type:'catalog'});catalog=result.accounts;renderAccounts();
    const pending=view.connection.accounts.some(a=>a.selection==='unconfigured');
    if(pending){$('settings').open=true;status('Выберите счета для загрузки.');}
    else if(!capture)status('Готово к синхронизации.');
    else progress(capture);
  } catch(error){showError(error);}finally{$('refresh-accounts').disabled=false;$('accounts').inert=false;updateButton();}
}
let connectionEdited=false;
for(const id of ['url','token'])$(id).addEventListener('input',()=>{
  connectionEdited=true;
  // Issue the write on input, before the popup can close; no debounce/unload hook.
  chrome.storage.session.set({connectionDraft:{url:$('url').value,token:$('token').value}})
    .catch(()=>status('Не удалось сохранить введённые настройки. Повторите ввод.','error'));
});
$('server-form').addEventListener('submit',async event=>{
  event.preventDefault();busy=true;status('Подключаемся к серверу…','loading');updateButton();
  try {
    if(!await chrome.permissions.request({origins:[permissionOrigin($('url').value)]}))throw Object.assign(Error(),{code:'invalid_server'});
    await rpc({type:'configure',url:$('url').value,token:$('token').value});
    $('token').value='';configured=true;capture=null;await refresh();
  } catch(error){showError(error);}finally{busy=false;updateButton();}
});
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
      status('Начинаем синхронизацию…','loading');await rpc({type:'start'});
    }
    const state=await rpc({type:'status'});progress(state.capture);
  } catch(error){showError(error);}finally{busy=false;updateButton();}
});
try {
 const [state,{connectionDraft}]=await Promise.all([rpc({type:'status'}),chrome.storage.session.get('connectionDraft')]);
 configured=state.configured;
 if(!connectionEdited){$('url').value=connectionDraft?.url ?? state.url;$('token').value=connectionDraft?.token ?? '';}
 $('reimport').value=state.reimportFrom;
 reimportSaved=state.reimportFrom;
 $('settings').open=!state.configured || !!connectionDraft;capture=state.capture;
 if(state.configured)await refresh();else status(messages.not_configured);
 if(capture && (compatible || ['planned','collecting'].includes(capture.phase)))progress(capture);
} catch(error){showError(error);}
setInterval(async()=>{
 try{const state=await rpc({type:'status'});if(JSON.stringify(state.capture)!==JSON.stringify(capture))progress(state.capture);
  if(reimportSaved && !state.reimportFrom && $('reimport').value===reimportSaved)$('reimport').value='';
  reimportSaved=state.reimportFrom;
 }catch{}
},1500);
