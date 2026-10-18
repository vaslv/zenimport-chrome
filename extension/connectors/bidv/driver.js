// ISOLATED world: bank UI actions and rendered records only. No backend token.
(() => {
  const config=globalThis.__zenImportCaptureConfig;delete globalThis.__zenImportCaptureConfig;
  if(!config)return;
  globalThis.__zenImportCaptureAbort?.();globalThis.__zenImportCaptureRun=config.runId;
  let stopped=false,interrupted=false,ready=false,completed=false,sequence=0,events=[],allRows=[],stage='network_ready';
  const pending=new Set(),text=e=>e?.textContent?.replace(/\s+/g,' ').trim() || '';
  const visible=e=>!!e && !!(e.getBoundingClientRect().width && e.getBoundingClientRect().height) &&
    !e.closest('[aria-hidden="true"]') && getComputedStyle(e).visibility!=='hidden';
  const drawer=()=>[...document.querySelectorAll('app-drawer')].find(visible);
  const byText=(root,label)=>[...root.querySelectorAll('button,a,li,div')].find(e=>visible(e) && text(e)===label &&
    (e.matches('button,a,li') || ![...e.children].some(c=>text(c)===label)));
  const rpc=async(type,extra={})=>{
    for(let i=0;i<4;i++) {
      let reply;try{reply=await chrome.runtime.sendMessage({type,account:config.account,runId:config.runId,...extra});}
      catch(e){if(i===3)throw e;await new Promise(r=>setTimeout(r,300));continue;}
      if(!reply?.ok)throw Error(reply?.error || 'backend_unavailable');return reply;
    }
  };
  function guard() {
    if(stopped)throw Error('capture_stopped');
    if(interrupted)throw Error('capture_context_changed');
    if(location.origin!=='https://smartbanking.bidv.com.vn' || location.pathname.replace(/\/$/,'')!=='/tai-khoan/thanh-toan/'+config.account ||
        text(document.querySelector('main app-card-account .card-account--no'))!==config.account)throw Error('bank_login_required');
    const root=drawer();
    if(root) {
      if(text(root.querySelector('.drawer-title'))!=='All transactions at BIDV')throw Error('capture_context_changed');
      if(root.querySelector('input[placeholder="Search"]')?.value)throw Error('capture_context_changed');
      const selected=root.querySelector('[role="tab"][aria-selected="true"]');
      if(!selected || text(selected)!=='All')throw Error('capture_context_changed');
    }
  }
  async function wait(check,limit=30000) {
    const deadline=Date.now()+limit;let checked=0;
    while(Date.now()<deadline) {
      guard();if(Date.now()-checked>1500){await rpc('capture-check');checked=Date.now();}
      const result=check();if(result)return result;
      await new Promise(r=>setTimeout(r,80));
    }
    throw Error('history_incomplete');
  }
  function click(node) {
    guard();if(!visible(node) || node.disabled || node.getAttribute('aria-disabled')==='true')throw Error('history_incomplete');
    node.click();
  }
  const onNetwork=e=>{
    if(e.source!==window || e.origin!==location.origin || e.data?.source!=='zenimport-bidv-network-v1')return;
    const m=e.data;
    if(m.phase==='ready' && !ready && Array.isArray(m.pending)) {for(const id of m.pending)pending.add(id);ready=true;}
    if(m.phase==='start' && Number.isSafeInteger(m.id)) {pending.add(m.id);events.push({seq:++sequence,...m});}
    if(m.phase==='end' && Number.isSafeInteger(m.id)) {pending.delete(m.id);events.push({seq:++sequence,...m});}
  };
  const onInteraction=e=>{if(e.isTrusted)interrupted=true;};
  const onAbort=m=>{if(m?.type==='capture-abort')cleanup();};
  window.addEventListener('message',onNetwork);chrome.runtime.onMessage.addListener(onAbort);
  for(const kind of ['pointerdown','keydown','input'])document.addEventListener(kind,onInteraction,true);
  function cleanup() {
    stopped=true;allRows=[];events=[];
    if(globalThis.__zenImportCaptureRun===config.runId)globalThis.__zenImportCaptureRun=null;
    window.removeEventListener('message',onNetwork);chrome.runtime.onMessage.removeListener(onAbort);
    for(const kind of ['pointerdown','keydown','input'])document.removeEventListener(kind,onInteraction,true);
  }
  globalThis.__zenImportCaptureAbort=cleanup;
  async function request(action) {
    await wait(()=>ready && pending.size===0);
    const before=sequence;action();
    await wait(()=>events.some(e=>e.seq>before && e.phase==='start'),45000);
    await wait(()=>{
      const starts=events.filter(e=>e.seq>before && e.phase==='start');
      // /w2/process is a shared endpoint. Concurrent bank activity cannot be
      // attributed to this action safely; stop instead of accepting stale rows.
      if(starts.length!==1)throw Error('history_incomplete');
      const end=events.find(e=>e.seq>before && e.phase==='end' && e.id===starts[0].id);
      if(end && end.status!==200)throw Error('history_incomplete');
      return end && pending.size===0;
    },45000);
    events=[];
  }
  async function openHistory() {
    stage='open_history';
    for(const modal of [...document.querySelectorAll('app-modal-transfer-detail,app-modal-filter-history-transfer')].filter(visible))click(modal.querySelector('.modal-close'));
    if([...document.querySelectorAll('[role="dialog"]')].some(visible))throw Error('history_incomplete');
    if(drawer())click(drawer().querySelector('button[aria-label="close"]'));
    await wait(()=>!drawer());
    const trigger=[...document.querySelectorAll('main app-card-account button.ant-dropdown-trigger')].find(e=>text(e)==='Transaction history');
    if(!visible(trigger))throw Error('history_incomplete');
    // BIDV uses a hover dropdown. Generate only ordinary UI events; never call
    // Angular components or bank API methods with captured authentication.
    trigger.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));
    trigger.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
    let item;
    for(let poll=0;poll<10;poll++) {
      guard();item=byText(document,'All transactions at BIDV');if(item)break;
      await new Promise(r=>setTimeout(r,80));
    }
    if(!item){click(trigger);item=await wait(()=>byText(document,'All transactions at BIDV'));}
    stage='history_response';await request(()=>click(item));await wait(drawer);
  }
  const display=iso=>iso.split('-').reverse().join('/');
  const panels=()=>[...document.querySelectorAll('.ant-picker-panel')].filter(visible);
  async function pick(iso) {
    const [year,month,day]=iso.split('-').map(Number),title=`${month}/${day}/${year}`;
    for(let n=0;n<16;n++) {
      const available=await wait(()=>panels().length && panels());
      const target=available.flatMap(p=>[...p.querySelectorAll('td.ant-picker-cell-in-view')]).find(e=>e.title===title);
      if(target) {if(target.classList.contains('ant-picker-cell-disabled'))throw Error('history_incomplete');click(target);return;}
      const first=available[0].querySelector('td.ant-picker-cell-in-view')?.title;
      const parts=first?.match(/^(\d+)\/\d+\/(\d+)$/);if(!parts)throw Error('history_incomplete');
      const backwards=year*12+month<Number(parts[2])*12+Number(parts[1]);
      const panel=backwards?available[0]:available[available.length-1];
      click(panel.querySelector(backwards?'.ant-picker-header-prev-btn':'.ant-picker-header-next-btn'));
      await wait(()=>panels()[0]?.querySelector('td.ant-picker-cell-in-view')?.title!==first);
    }
    throw Error('history_incomplete');
  }
  function readRows() {
    const table=drawer()?.querySelector('table.transaction-table__table');
    if(!table)return [];
    return [...table.querySelectorAll('tbody tr')].map(row=>{
      if(row.children.length!==5)throw Error('history_incomplete');
      const cells=['date','content','amount','balance','code'].map(name=>row.querySelector('td.cell--'+name));
      if(cells.some(e=>!e))throw Error('history_incomplete');
      return {date:text(cells[0]),remark:text(cells[1]),amount:text(cells[2]),balance:text(cells[3]),reference:text(cells[4])};
    });
  }
  function terminal() {
    const root=drawer()?.querySelector('.drawer-body');
    const more=root && byText(root,'View more');
    const marker=label=>root && [...root.querySelectorAll('p,div,span')].some(e=>!e.closest('table') && text(e)===label);
    const empty=marker('You have no transactions during this period.');
    const end=marker('All transactions viewed');
    return more || end || empty ? {more,empty,end} : null;
  }
  async function filter() {
    stage='open_filter';
    click(byText(drawer(),'Filter'));
    const modal=await wait(()=>[...document.querySelectorAll('app-modal-filter-history-transfer')].find(visible));
    const inputs=modal.querySelectorAll('nz-range-picker input');
    if(inputs.length!==2)throw Error('history_incomplete');
    const iso=value=>/^\d{2}\/\d{2}\/\d{4}$/.test(value)?value.split('/').reverse().join('-'):null;
    const previousStart=iso(inputs[0].value),previousEnd=iso(inputs[1].value);
    const narrowsLoadedRange=previousStart && previousEnd && previousStart<=config.interval.period.start && previousEnd>=config.interval.period.end;
    click(byText(modal,'Reset'));
    // Reset restores the bank's default range; it does not clear both fields.
    // Explicitly replace each date through the calendar, then verify the range.
    await wait(()=>!inputs[0].disabled && !inputs[1].disabled);
    stage='start_date';click(inputs[0]);await pick(config.interval.period.start);
    await wait(()=>inputs[0].value===display(config.interval.period.start));
    stage='end_date';await pick(config.interval.period.end);
    await wait(()=>inputs[0].value===display(config.interval.period.start) && inputs[1].value===display(config.interval.period.end));
    // Narrowing an already loaded range may leave every rendered row unchanged.
    // Full pagination and parser date bounds still reject any out-of-range rows.
    // Widening must change the rendered history: stale rows could omit records.
    let changed=false,last=Date.now();
    const watch=new MutationObserver(list=>{
      if(list.some(m=>m.type==='childList' || m.type==='characterData')){changed=true;last=Date.now();}
    });
    const root=drawer();watch.observe(root,{childList:true,characterData:true,subtree:true});
    try {
      stage='apply_filter';await request(()=>click(byText(modal,'Apply')));
      stage='filtered_rows';
      await wait(()=>!visible(modal) && (changed || narrowsLoadedRange) && Date.now()-last>350 && terminal());
    }finally{watch.disconnect();}
  }
  (async()=>{
    try {
      window.postMessage({source:'zenimport-bidv-probe-v1'},location.origin);
      await wait(()=>ready && pending.size===0);await openHistory();await filter();
      stage='read_rows';allRows=readRows();
      for(let step=0;step<5001;step++) {
        guard();const state=await wait(terminal);
        if(!state.more) {
          if((allRows.length===0 && !state.empty) || (allRows.length>0 && !state.end))throw Error('history_incomplete');
          break;
        }
        if(step===5000 || allRows.length>=100000)throw Error('history_incomplete');
        const before=JSON.stringify(allRows),count=allRows.length;
        stage='load_more';await request(()=>click(state.more));
        await wait(()=>readRows().length>count && terminal());
        const next=readRows();
        if(JSON.stringify(next.slice(0,count))!==before || next.length>100000)throw Error('history_incomplete');
        allRows=next;
      }
      stage='save_pages';const total=allRows.length;
      // Fixed small transport pages also fit the 2 MB limit when both the
      // description and details contain maximum-length four-byte Unicode text.
      for(let index=0;index<Math.max(1,Math.ceil(total/100));index++) {
        guard();await rpc('capture-page',{data:{accountNo:config.account,period:config.interval.period,currentPage:index,
          pageSize:100,totalRecords:total,transactions:allRows.slice(index*100,(index+1)*100)}});
      }
      await rpc('capture-complete');completed=true;
    }catch(error) {
      if(!stopped)await rpc('capture-error',{code:error.message==='bank_login_required'?'bank_login_required':'history_incomplete',stage}).catch(()=>{});
    }finally{cleanup();if(completed)await rpc('capture-next').catch(()=>{});}
  })();
})();
