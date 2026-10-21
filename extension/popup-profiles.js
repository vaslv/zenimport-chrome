import {accountSignature} from './bank-profiles.js';
const $=id=>document.getElementById(id);
const pencil='m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125';

export function setupProfiles({rpc,refresh,lock,feedback,error}) {
  let view=null,editing=false,locked=false,saving=false,serverUrl='',contextId='',writes=Promise.resolve();
  function update(value=locked) {
    locked=value;
    $('profile-name').disabled=locked || saving;
    $('rename-profile').disabled=locked || saving || !view?.connection;
    $('connection-name').hidden=editing;
    $('profile-name').hidden=!editing;
    const label=editing?'Save connection name':'Rename connection';
    $('rename-profile').setAttribute('aria-label',label);$('rename-profile').title=label;
    $('profile-icon').setAttribute('d',editing?'m4.5 12.75 6 6 9-13.5':pencil);
  }
  function draft() {
    if(!view?.connection || !editing)return writes;
    const value={url:serverUrl,contextId,bank:view.bank,signature:accountSignature(view.detectedAccounts),mode:'rename',profileKey:view.connection.profile_key,label:$('profile-name').value};
    writes=writes.catch(()=>{}).then(()=>chrome.storage.session.set({bankProfileDraft:value}));
    return writes;
  }
  async function close() {
    await writes.catch(()=>{});await chrome.storage.session.remove('bankProfileDraft');
    editing=false;update();
  }
  async function save() {
    if(!editing || locked || saving)return;
    const label=$('profile-name').value.trim();
    if(!label || label.length>120){error({code:'validation_error'});$('profile-name').focus();return;}
    saving=true;lock(true);update();feedback('Saving connection name…','loading');
    try {
      await rpc({type:'rename-bank-connection',connectionId:view.connection.id,label});
      await close();await refresh();feedback('Connection name saved.','success');
    }catch(e){error(e);}finally{saving=false;lock(false);update();}
  }
  $('rename-profile').addEventListener('click',async()=>{
    if(locked || saving || !view?.connection)return;
    if(editing){await save();return;}
    editing=true;$('profile-name').value=view.connection.label;update();
    $('profile-name').focus();$('profile-name').select();
    draft().catch(()=>error({code:'backend_unavailable'}));
  });
  $('current-connection').addEventListener('submit',event=>{event.preventDefault();save();});
  $('profile-name').addEventListener('input',()=>draft().catch(()=>feedback('Could not save the name draft.','error')));
  $('profile-name').addEventListener('keydown',event=>{
    if(event.key==='Escape' && !locked && !saving){event.preventDefault();close().then(()=>$('rename-profile').focus());}
  });
  async function render(current) {
    view=current;editing=false;
    $('current-connection').hidden=!view?.connection;
    $('connection-name').textContent=view?.connection?.label || '';
    if(view?.connection) {
      const [{bankProfileDraft:stored},{url,context}]=await Promise.all([chrome.storage.session.get('bankProfileDraft'),rpc({type:'status'})]);
      serverUrl=url;contextId=context?.dataset_id || '';
      editing=!!(stored && stored.mode==='rename' && stored.url===url && stored.contextId===contextId && stored.bank===view.bank &&
        stored.signature===accountSignature(view.detectedAccounts) && stored.profileKey===view.connection.profile_key);
      if(editing)$('profile-name').value=stored.label;
    }
    update();
  }
  return {render,update};
}
