import {createRpc} from '../src/application/rpc.ts';
const rpc=createRpc(data=>chrome.runtime.sendMessage(data));
const $=id=>document.getElementById(id);
const node=(tag,text,attributes={})=>{const e=document.createElement(tag);if(text)e.textContent=text;Object.assign(e,attributes);return e;};
let allAccounts=null;
const dateText=value=>new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
function money(value,currency){
 const negative=value.startsWith('-'), [whole,fraction]=value.replace(/^-/, '').split('.');
 return (negative?'−':'')+whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction?'.'+fraction:'')+' '+currency;
}
const status=(text,tone='neutral')=>{$('status').textContent=text;$('status').dataset.tone=tone;};
function render(data){
 $('bank').textContent=data.bank==='vietinbank'?'VietinBank':data.bank;
 if(!allAccounts){
  allAccounts=data.accounts;
  for(const account of allAccounts)$('account').append(node('option',account.title,{value:account.id}));
 }
 $('from').value=data.from_date;$('to').value=data.to_date;
 $('freshness').textContent='ZenMoney: '+new Intl.DateTimeFormat('en-GB',{dateStyle:'long',timeStyle:'short'}).format(new Date(data.refreshed_at))+'. Bank history is from the latest extension capture.';
 const warnings={shared_target:'This ZenMoney account is linked to multiple bank accounts; verification is unavailable.',
  sync_in_progress:'This server version blocks comparison during synchronization. Update the backend to compare saved history independently of delivery.',account_unavailable:'The mapped ZenMoney account is unavailable or its currency has changed.',
  unsupported_movement:'Some transactions use another currency and are excluded from comparison.'};
 $('coverage').replaceChildren();
 for(const account of data.accounts){
  const warning=warnings[account.status];
  const text=warning || `Days checked: ${account.checked_days}. Days without complete bank history: ${account.unchecked_days}.`;
  const line=node('p',account.title+' · '+account.zenmoney_title+' — '+text,{className:'coverage'});
  line.dataset.warning=String(!!warning || account.unchecked_days>0);$('coverage').append(line);
 }
 const bankCount=data.days.reduce((total,day)=>total+(day.bank_operations || []).length,0);
 const zenCount=data.days.reduce((total,day)=>total+day.operations.length,0), checked=data.accounts.some(a=>a.checked_days>0);
 $('summary').textContent=bankCount+zenCount?`Without a matching counterpart — Bank: ${bankCount} · ZenMoney: ${zenCount} · days: ${new Set(data.days.map(day=>day.date)).size}`:
  checked?'No discrepancies were found on the checked days.':data.accounts.some(a=>a.status==='ready')?
  'No days have complete bank history. Synchronize the bank and refresh the report.':'Verification is not yet available. See the reasons above.';
 for(const day of data.days){
  const account=data.accounts.find(a=>a.id===day.account_id), details=node('details','',{open:true}), summary=node('summary');
  summary.append(node('span',dateText(day.date)+' · '+account.title,{className:'day-title'}),
   node('span',`Bank: ${money(day.bank_total,account.currency)} · ZenMoney: ${money(day.zenmoney_total,account.currency)} · Difference: ${money(day.difference,account.currency)}`,{className:'totals'}));
  details.append(summary);
  for(const [source,operations] of [['bank',day.bank_operations || []],['zenmoney',day.operations]]){
   if(!operations.length)continue;
   details.append(node('h3',source==='bank'?'Bank — no matching ZenMoney transaction':'ZenMoney — no matching bank transaction',{className:'side-title'}));
   for(const operation of operations){
    const row=node('article','',{className:'operation'}), description=node('div','',{className:'description'});
    description.append(node('strong',operation.payee || operation.comment || 'No description'));
    if(operation.payee && operation.comment)description.append(node('div',operation.comment));
    if(source==='zenmoney')description.append(node('div',operation.categories.filter(Boolean).join(', ') || 'Uncategorized',{className:'categories'}));
    row.dataset.source=source;
    row.append(description,node('div',money(operation.amount,account.currency),{className:'amount'}));details.append(row);
   }
  }
  $('days').append(details);
 }
 status(data.accounts.length?'':'No bank accounts are configured for verification.');
}
async function load(refresh=false){
 $('refresh').disabled=true;$('filters').inert=true;$('days').setAttribute('aria-busy','true');
 $('days').replaceChildren();$('summary').textContent='';$('coverage').replaceChildren();$('freshness').textContent='';status('Loading data…');
 try{
  const result=await rpc({type:'discrepancies',refresh,from_date:$('from').value,to_date:$('to').value,account_id:$('account').value});
  if(!result?.ok)throw Object.assign(Error(),{code:result?.error});render(result.report);
 }catch(error){
  const messages={stale_context:'The storage connection changed. Reopen this report from the extension menu.',
   not_configured:'Connect to the server in the extension menu.',unauthorized:'Check the server token in the extension menu.',
   validation_error:'Check the selected period and open this page from the bank menu.',zenmoney_unavailable:'Could not retrieve current ZenMoney data. Try again later.',
   not_found:'The report is unavailable. Update the backend and open this page from the bank menu.',unsupported_api_version:'Update the backend and extension.'};
  status(messages[error.code] || 'Could not retrieve the report. Check the server connection and try again.','error');
 }finally{$('refresh').disabled=false;$('filters').inert=false;$('days').setAttribute('aria-busy','false');}
}
$('filters').addEventListener('submit',event=>{event.preventDefault();load(true);});
await load(true);
