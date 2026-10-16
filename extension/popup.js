import {permissionOrigin} from './backend-client.js';
import {today,daysAgo,monthsAgo,validDate} from './dates.js';
const $ = id => document.getElementById(id);
const rpc = async data => {
  const result=await chrome.runtime.sendMessage(data);
  if(!result?.ok)throw Object.assign(Error(),{code:result?.error || 'backend_unavailable'});
  return result;
};
const messages={
  invalid_server:'Укажите HTTPS-адрес сервера или localhost.',unauthorized:'Проверьте токен backend.',
  backend_unavailable:'Нет связи с сервером. Повторите позже.',invalid_response:'Сервер вернул неизвестный ответ.',
  unsupported_api_version:'Версии сервера и расширения несовместимы.',unsupported_bank:'Откройте историю операций поддерживаемого банка.',
  bank_login_required:'Войдите в банк и откройте историю операций.',not_configured:'Укажите сервер и токен backend.',
  account_unconfigured:'Выберите счета для загрузки.',account_disabled:'Нет счетов для загрузки.',
  account_busy:'Сначала завершите или остановите текущий сбор.',capture_busy:'Историю уже читает другое расширение.',
  settings_conflict:'Настройки изменились. Обновите список счетов.',zenmoney_account_unavailable:'Счёт ZenMoney недоступен. Проверьте привязку.',
  zenmoney_unavailable:'ZenMoney временно недоступен.',history_incomplete:'Сбор прерван: банк вернул неполную историю. Повторите синхронизацию.',
  capture_context_changed:'Страница или счёт изменились. Повторите синхронизацию.',validation_error:'Проверьте выбранные счета и дату.',
};
const showError=error=>{$('status').textContent=messages[error.code] || 'Не удалось выполнить действие. Повторите позже.';};
let view=null,catalog=[],capture=null,compatible=false,busy=false;
function node(tag,text,attributes={}) {const value=document.createElement(tag);if(text)value.textContent=text;Object.assign(value,attributes);return value;}
function updateButton() {
  const active=['planned','collecting'].includes(capture?.phase);
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
    $('status').textContent=`Получаем историю: ${intervals.filter(i=>i.state==='complete').length} из ${intervals.length} периодов.`;return;
  }
  if(state.phase==='cancelled'){$('status').textContent='Сбор остановлен. Полученные данные сохранены.';return;}
  if(state.phase==='complete'){
    const d=job.delivery;
    $('status').textContent=job.delivery_state==='complete'
      ? `Готово. Добавлено: ${d.delivered}. Уже обработано: ${d.suppressed}.`
      : job.delivery_state==='blocked' ? `История сохранена. Отправка ожидает проверки сервером. Не подтверждено: ${d.uncertain}.`
      : `История сохранена. Сервер отправляет операции: ${d.pending}.`;
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
  const syncFields=()=>{const enabled=target.value && target.value!=='ignored';date.disabled=!enabled;shortcuts.hidden=!enabled;};
  target.addEventListener('change',syncFields);syncFields();form.append(shortcuts);
  const save=node('button','Сохранить счёт',{type:'submit'});form.append(save);
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!target.value){showError({code:'account_unconfigured'});return;}
    if(target.value!=='ignored' && (!validDate(date.value) || date.value>today())){showError({code:'validation_error'});return;}
    save.disabled=true;
    try {
      const result=await rpc({type:'settings',accountId:account.id,settings:{expected_version:account.settings_version,
        selection:target.value==='ignored'?'ignored':'enabled',zenmoney_account_id:target.value==='ignored'?null:target.value,
        import_start:target.value==='ignored'?null:date.value}});
      view.connection.accounts=view.connection.accounts.map(a=>a.id===account.id?result.account:a);
      $('status').textContent='Счёт сохранён.';renderAccounts();updateButton();
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
async function refresh() {
  compatible=false;updateButton();
  try {
    view=await rpc({type:'inspect'});compatible=true;
    $('bank').textContent=view.bank==='vietinbank'?'VietinBank':view.bank;
    const result=await rpc({type:'catalog'});catalog=result.accounts;renderAccounts();
    const pending=view.connection.accounts.some(a=>a.selection==='unconfigured');
    if(pending){$('settings').open=true;$('status').textContent='Настройте новые счета. Остальные можно синхронизировать.';}
    else if(!capture)$('status').textContent='Готово к синхронизации.';
  } catch(error){showError(error);}finally{updateButton();}
}
$('server-form').addEventListener('submit',async event=>{
  event.preventDefault();busy=true;updateButton();
  try {
    if(!await chrome.permissions.request({origins:[permissionOrigin($('url').value)]}))throw Object.assign(Error(),{code:'invalid_server'});
    await rpc({type:'configure',url:$('url').value,token:$('token').value});
    $('token').value='';capture=null;await refresh();
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
      if(!await chrome.permissions.request({origins:['https://ipay.vietinbank.vn/*']}))throw Object.assign(Error(),{code:'unsupported_bank'});
      const date=$('reimport').value;
      if(date && (!validDate(date) || date>today()))throw Object.assign(Error(),{code:'validation_error'});
      await rpc({type:'reimport',date});
      $('status').textContent='Начинаем синхронизацию…';await rpc({type:'start'});
    }
    const state=await rpc({type:'status'});progress(state.capture);
  } catch(error){showError(error);}finally{busy=false;updateButton();}
});
try {
 const state=await rpc({type:'status'});$('url').value=state.url;$('reimport').value=state.reimportFrom;
 $('settings').open=!state.configured;capture=state.capture;
 if(state.configured)await refresh();else $('status').textContent=messages.not_configured;
 if(capture)progress(capture);
} catch(error){showError(error);}
setInterval(async()=>{
 try{const state=await rpc({type:'status'});if(JSON.stringify(state.capture)!==JSON.stringify(capture))progress(state.capture);
  if(!state.reimportFrom)$('reimport').value='';
 }catch{}
},1500);
