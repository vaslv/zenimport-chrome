import {bankName,accountSignature} from './bank-profiles.js';
const $=id=>document.getElementById(id);

export function setupProfiles({rpc,refresh,lock,feedback,error}) {
  let view=null,mode=null,locked=false,serverUrl='';
  const draft=async()=>{
    if(!view || !mode)return;
    await chrome.storage.session.set({bankProfileDraft:{url:serverUrl,bank:view.bank,signature:accountSignature(view.detectedAccounts),mode,profileKey:view.connection?.profile_key || null,label:$('profile-name').value}});
  };
  const close=async()=>{mode=null;$('profile-form').hidden=true;await chrome.storage.session.remove('bankProfileDraft');};
  async function edit(next) {
    mode=next;$('profile-name').value=next==='rename'?view.connection.label:(view.ownerName || bankName(view.bank)+' '+(view.connections.length+1));
    $('save-profile').textContent=next==='rename'?'Save name':'Add connection';
    $('profile-form').hidden=false;$('bank-profile-settings').open=true;
    await draft();$('profile-name').focus();
  }
  async function action(operation) {
    lock(true);feedback('Saving bank connection…','loading');
    try {await operation();await close();await refresh();feedback('Bank connection saved.','success');}
    catch(e){$('bank-profile').value=view?.connection?.profile_key || '';error(e);}
    finally{lock(false);}
  }
  $('bank-profile').addEventListener('change',()=>{
    const profileKey=$('bank-profile').value;if(!profileKey)return;
    action(()=>rpc({type:'select-bank-connection',profileKey}));
  });
  $('add-profile').addEventListener('click',()=>edit('create'));
  $('rename-profile').addEventListener('click',()=>edit('rename'));
  $('cancel-profile').addEventListener('click',close);
  $('profile-name').addEventListener('input',()=>draft().catch(()=>feedback('Could not save the connection name. Enter it again.','error')));
  $('profile-form').addEventListener('submit',event=>{
    event.preventDefault();const label=$('profile-name').value.trim();
    if(!label || label.length>120){error({code:'validation_error'});return;}
    action(()=>rpc(mode==='create'?{type:'create-bank-connection',label}:{type:'rename-bank-connection',connectionId:view.connection.id,label}));
  });
  function update(value) {
    locked=value;
    for(const id of ['bank-profile','add-profile','profile-name','save-profile','cancel-profile'])$(id).disabled=locked;
    $('rename-profile').disabled=locked || !view?.connection;
  }
  async function render(current) {
    view=current;
    $('current-connection').hidden=!view?.connection;
    $('connection-name').textContent=view?.connection?.label || '';
    $('profile-picker').hidden=!view?.selectionRequired;
    $('bank-profile-settings').hidden=!view;
    if(!view)return;
    const select=$('bank-profile');select.replaceChildren();
    const option=(text,value)=>{const e=document.createElement('option');e.textContent=text;e.value=value;return e;};
    select.append(option('Choose a connection…',''));
    for(const c of view.connections)select.append(option(c.label,c.profile_key));
    select.value=view.connection?.profile_key || '';
    const {bankProfileDraft:stored}=await chrome.storage.session.get('bankProfileDraft');
    const {url}=await rpc({type:'status'});
    serverUrl=url;
    const restore=stored && stored.url===url && stored.bank===view.bank && stored.signature===accountSignature(view.detectedAccounts) &&
      (stored.mode==='create' || stored.profileKey===view.connection?.profile_key);
    mode=restore?stored.mode:null;$('profile-form').hidden=!mode;
    if(mode){$('profile-name').value=stored.label;$('save-profile').textContent=mode==='rename'?'Save name':'Add connection';$('bank-profile-settings').open=true;}
    if(view.selectionRequired){$('bank-profile-settings').open=true;}
    update(locked);
  }
  return {render,update};
}
