import {SyncError} from '../../backend-client.js';

export const bankOrigin = 'https://smartbanking.bidv.com.vn';
export function supports(value) {
  try { const url=new URL(value);return url.origin===bankOrigin && /^\/tai-khoan(?:\/thanh-toan\/\d{6,30})?\/?$/.test(url.pathname); }
  catch { return false; }
}
export function accountFromUrl(value) {
  if(!supports(value))return null;
  return new URL(value).pathname.match(/^\/tai-khoan\/thanh-toan\/(\d{6,30})\/?$/)?.[1] || null;
}
const fail=()=>{throw new SyncError('history_incomplete');};
function money(value,signed=false) {
  if(typeof value!=='string')fail();
  const match=value.trim().match(signed ? /^([+-])\s*((?:0|[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*))\s+VND$/ : /^(-?)\s*((?:0|[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*))\s+VND$/);
  if(!match)fail();
  const amount=match[2].replaceAll(',','');
  if(amount.length>24 || (signed && BigInt(amount)===0n))fail();
  return {amount,sign:match[1]==='-'?'-':''};
}
function timestamp(value) {
  const match=typeof value==='string' && value.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if(!match)fail();
  const iso=`${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:${match[6]}`;
  const parsed=new Date(iso+'Z');
  if(!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,19)!==iso)fail();
  return iso;
}

// A BIDV reference identifies a group, not an individual posting: fee and
// principal can share reference, timestamp and remark. Balance separates even
// equal-value postings; neither table position nor the capture window is identity.
export async function parsePage(data,{account,period,page=0,total,size,seen=[]}) {
  if(data?.accountNo!==account || data.period?.start!==period.start || data.period?.end!==period.end)throw new SyncError('capture_context_changed');
  if(data.currentPage!==page || data.pageSize!==100 || !Number.isSafeInteger(data.totalRecords) || data.totalRecords<0 || data.totalRecords>100000 ||
      !Array.isArray(data.transactions))fail();
  if(page===0){total=data.totalRecords;size=100;}
  if(total!==data.totalRecords || size!==100 || page<0 || page>=Math.max(1,Math.ceil(total/size)) ||
      data.transactions.length!==Math.min(size,total-page*size))fail();
  const ids=new Set(seen),records=[];
  for(const raw of data.transactions) {
    const occurred=timestamp(raw.date),local=occurred.slice(0,10),amount=money(raw.amount,true),balance=money(raw.balance);
    if(local<period.start || local>period.end || typeof raw.remark!=='string' || Array.from(raw.remark).length>2000 ||
        typeof raw.reference!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(raw.reference))fail();
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([account,occurred,raw.reference,amount.sign+amount.amount,balance.sign+balance.amount])));
    const external='bidv:f1:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    if(ids.has(external))fail();ids.add(external);
    records.push({external_id:external,identity_kind:'fingerprint',identity_version:'f1',occurred_at:occurred+'+07:00',local_date:local,
      direction:amount.sign==='-'?'expense':'income',amount:amount.amount,currency:'VND',description:raw.remark,
      beneficiary_account:null,beneficiary_name:null,balance:balance.sign+balance.amount,details_state:'complete',
      details:{transactionDate:raw.date,referenceNumber:raw.reference,transactionRemark:raw.remark,transactionAmount:raw.amount,balance:raw.balance}});
  }
  return {records,total,size,totalPages:Math.max(1,Math.ceil(total/size)),ids:records.map(r=>r.external_id)};
}
