const $=id=>document.getElementById(id);
const node=(tag,text,attributes={})=>{const e=document.createElement(tag);if(text)e.textContent=text;Object.assign(e,attributes);return e;};
let allAccounts=null;
const dateText=value=>new Intl.DateTimeFormat('ru-RU',{weekday:'short',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
function money(value,currency){
 const negative=value.startsWith('-'), [whole,fraction]=value.replace(/^-/, '').split('.');
 return (negative?'−':'')+whole.replace(/\B(?=(\d{3})+(?!\d))/g,'\u00a0')+(fraction?','+fraction:'')+' '+currency;
}
const status=(text,tone='neutral')=>{$('status').textContent=text;$('status').dataset.tone=tone;};
function render(data){
 $('bank').textContent=data.bank==='vietinbank'?'VietinBank':data.bank;
 if(!allAccounts){
  allAccounts=data.accounts;
  for(const account of allAccounts)$('account').append(node('option',account.title,{value:account.id}));
 }
 $('from').value=data.from_date;$('to').value=data.to_date;
 $('freshness').textContent='ZenMoney: '+new Intl.DateTimeFormat('ru-RU',{dateStyle:'long',timeStyle:'short'}).format(new Date(data.refreshed_at))+'. История банка — из последней загрузки расширением.';
 const warnings={shared_target:'Счёт ZenMoney связан с несколькими банковскими счетами — проверка недоступна.',
  sync_in_progress:'Синхронизация ещё не завершена. Обновите отчёт после её окончания.',account_unavailable:'Привязанный счёт ZenMoney недоступен или его валюта изменилась.',
  unsupported_movement:'Часть операций имеет другую валюту и не сравнивается.'};
 $('coverage').replaceChildren();
 for(const account of data.accounts){
  const warning=warnings[account.status];
  const text=warning || `Проверено дней: ${account.checked_days}. Без полной истории банка: ${account.unchecked_days}.`;
  const line=node('p',account.title+' · '+account.zenmoney_title+' — '+text,{className:'coverage'});
  line.dataset.warning=String(!!warning || account.unchecked_days>0);$('coverage').append(line);
 }
 const count=data.days.reduce((total,day)=>total+day.operations.length,0), checked=data.accounts.some(a=>a.checked_days>0);
 $('summary').textContent=count?`Возможные лишние операции: ${count} · дней: ${new Set(data.days.map(day=>day.date)).size}`:
  checked?'В проверенных днях лишние операции не найдены.':data.accounts.some(a=>a.status==='ready')?
  'Нет полностью загруженных дней. Выполните синхронизацию банка и обновите отчёт.':'Проверка пока недоступна. Причины указаны выше.';
 for(const day of data.days){
  const account=data.accounts.find(a=>a.id===day.account_id), details=node('details','',{open:true}), summary=node('summary');
  summary.append(node('span',dateText(day.date)+' · '+account.title,{className:'day-title'}),
   node('span',`Банк: ${money(day.bank_total,account.currency)} · ZenMoney: ${money(day.zenmoney_total,account.currency)} · Разница: ${money(day.difference,account.currency)}`,{className:'totals'}));
  details.append(summary);
  for(const operation of day.operations){
   const row=node('article','',{className:'operation'}), description=node('div','',{className:'description'});
   description.append(node('strong',operation.payee || operation.comment || 'Без описания'));
   if(operation.payee && operation.comment)description.append(node('div',operation.comment));
   description.append(node('div',operation.categories.filter(Boolean).join(', ') || 'Без категории',{className:'categories'}));
   row.append(description,node('div',money(operation.amount,account.currency),{className:'amount'}));details.append(row);
  }
  $('days').append(details);
 }
 status(data.accounts.length?'':'Нет настроенных счетов банка для проверки.');
}
async function load(refresh=false){
 $('refresh').disabled=true;$('filters').inert=true;$('days').setAttribute('aria-busy','true');
 $('days').replaceChildren();$('summary').textContent='';$('coverage').replaceChildren();$('freshness').textContent='';status('Получаем данные…');
 try{
  const result=await chrome.runtime.sendMessage({type:'discrepancies',refresh,from_date:$('from').value,to_date:$('to').value,account_id:$('account').value});
  if(!result?.ok)throw Object.assign(Error(),{code:result?.error});render(result.report);
 }catch(error){
  const messages={not_configured:'Подключите сервер в меню расширения.',unauthorized:'Проверьте токен сервера в меню расширения.',
   validation_error:'Проверьте выбранный период и откройте страницу из меню банка.',zenmoney_unavailable:'Не удалось получить актуальные данные ZenMoney. Повторите позже.',
   not_found:'Отчёт недоступен. Обновите backend и откройте страницу из меню банка.',unsupported_api_version:'Обновите backend и расширение.'};
  status(messages[error.code] || 'Не удалось получить отчёт. Проверьте связь с сервером и повторите.','error');
 }finally{$('refresh').disabled=false;$('filters').inert=false;$('days').setAttribute('aria-busy','false');}
}
$('filters').addEventListener('submit',event=>{event.preventDefault();load(true);});
await load(true);
