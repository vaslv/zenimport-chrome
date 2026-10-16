import {SyncError} from './backend-client.js';

const unfinished = value => ['planned','collecting','paused'].includes(value);

// The store contains identifiers/counters, never captured financial records or
// the bank credentials. The backend is the authoritative page checkpoint.
export class Coordinator {
  constructor({store, backend, connector, clock = () => Date.now(), uuid = () => crypto.randomUUID()}) {
    Object.assign(this, {store, backend, connector, clock, uuid});
  }
  async start({connection, bank, tabId, reimportFrom = null}) {
    let state = await this.store.get();
    if (state && unfinished(state.phase)) {
      if (state.connection.id !== connection.id || (state.phase!=='paused' && state.tabId!==tabId)) throw new SyncError('account_busy');
      // A manual retry keeps the same command ID after a lost HTTP response.
      if (state.phase === 'paused' && state.job) {
        // A known paused job needs a NEW resume command. Repeating its original
        // request_id only fetches the original idempotent result on the server.
        state.command = {...state.command,request_id:this.uuid()};
        state.phase='planned';state.error=null;state.lease=null;
        state.connection=connection;state.tabId=tabId;
        await this.store.set(state);
      }
    } else {
      state = {phase:'planned', connection, bank, tabId, workerId:this.uuid(),
        command:{connection_id:connection.id,request_id:this.uuid(),reimport_from:reimportFrom}, driver:null};
      await this.store.set(state);
    }
    state.job = await this.backend.request('/jobs','POST',state.command);
    state.phase = state.job.capture_state;
    await this.store.set(state);
    return this.pump();
  }
  async renew(state) {
    if (!state.lease || Date.parse(state.lease.expires_at) - this.clock() < 60000) {
      state.lease = await this.backend.request(`/jobs/${state.job.id}/lease`,'POST',{worker_id:state.workerId});
      await this.store.set(state);
    }
  }
  async pump() {
    const state = await this.store.get();
    if (!state) return state;
    if (!state.job && state.phase === 'planned') {
      state.job = await this.backend.request('/jobs','POST',state.command);
      await this.store.set(state);
    }
    if (!state.job) return state;
    state.job = await this.backend.request(`/jobs/${state.job.id}`);
    if (!unfinished(state.job.capture_state)) {
      state.phase = state.job.capture_state; state.driver = null;
      await this.store.set(state); return state;
    }
    if (state.phase === 'paused') { await this.store.set(state); return state; }
    await this.renew(state);
    if (state.driver && await this.connector(state.bank).running(state.tabId,state.driver)) return state;
    const next = state.job.accounts.flatMap(account => account.intervals
      .filter(interval => unfinished(interval.state)).map(interval => ({account,interval})))[0];
    if (!next) { await this.store.set(state); return state; }
    const account = state.connection.accounts.find(item => item.id === next.account.account_id);
    if (!account || account.selection !== 'enabled') throw new SyncError('capture_context_changed');
    const adapter = this.connector(state.bank);
    const documentId = await adapter.selectAccount(state.tabId,account.source_key);
    state.driver = {runId:this.uuid(),documentId,account:account.source_key,interval:next.interval,
      total:null,size:null};
    state.phase = 'collecting';
    state.received = 0;
    await this.store.set(state); // crash here is recoverable: running() is false
    await adapter.launch(state.tabId,state.driver);
    return state;
  }
  async guard(runId, source) {
    const state = await this.store.get(), driver = state?.driver;
    if (state?.phase !== 'collecting' || !driver || driver.runId !== runId || source.tabId !== state.tabId ||
        source.documentId !== driver.documentId || source.account !== driver.account) throw new SyncError('capture_context_changed');
    await this.renew(state);
    return state;
  }
  async page(runId, source, data) {
    const state = await this.guard(runId,source), driver = state.driver;
    const result = await this.connector(state.bank).parsePage(data,{account:driver.account,period:driver.interval.period,
      page:data.currentPage,total:driver.total,size:driver.size});
    const number = data.currentPage + 1;
    await this.backend.request(`/jobs/${state.job.id}/intervals/${driver.interval.id}/pages/${number}`,'PUT',{
      worker_id:state.workerId,lease_epoch:state.lease.epoch,page_number:number,total_pages:result.totalPages,
      total_records:result.total,records:result.records,
    });
    // Advance only after the HTTP ACK. On a lost response we replay the same
    // interval from page 1; the backend compares immutable page bodies.
    driver.total = result.total; driver.size = result.size;
    state.received = (data.currentPage * result.size) + result.records.length;
    await this.store.set(state);
    return {rows:state.received,total:result.total,totalPages:result.totalPages};
  }
  async complete(runId,source) {
    const state = await this.guard(runId,source), driver = state.driver;
    if (driver.total === null || state.received !== driver.total) throw new SyncError('history_incomplete');
    await this.backend.request(`/jobs/${state.job.id}/intervals/${driver.interval.id}/complete`,'POST',{
      worker_id:state.workerId,lease_epoch:state.lease.epoch,total_pages:Math.max(1,Math.ceil(driver.total/driver.size)),total_records:driver.total,
    });
    state.driver = null; await this.store.set(state);
  }
  async pause(code='bank_login_required') {
    const state = await this.store.get();
    if (!state || !unfinished(state.phase)) return;
    const unsafe = ['history_incomplete','capture_context_changed'].includes(code);
    if (state.job && state.lease) {
      try { await this.backend.request(`/jobs/${state.job.id}/capture-status`,'POST',{
        worker_id:state.workerId,lease_epoch:state.lease.epoch,state:unsafe?'failed':'paused',code:unsafe?code:'bank_login_required',
      }); } catch {} // A lost connection must not erase the local resume point.
    }
    await this.connector(state.bank).abort(state.tabId).catch(()=>{});
    state.phase=unsafe?'failed':'paused'; state.error=code; state.driver=null; state.lease=null;
    await this.store.set(state);
  }
  async stop() {
    const state = await this.store.get();
    if (!state) return;
    if (!state.job) {state.phase='cancelled';state.driver=null;await this.store.set(state);return;}
    await this.backend.request(`/jobs/${state.job.id}/stop`,'POST',{});
    await this.connector(state.bank).abort(state.tabId).catch(()=>{});
    state.phase='cancelled'; state.driver=null; await this.store.set(state);
  }
}
