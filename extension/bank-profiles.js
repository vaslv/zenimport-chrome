export const bankName=bank=>({bidv:'BIDV',vietinbank:'VietinBank'})[bank] || bank;
export const profileStorageKey=(url,bank)=>url+'|'+bank;
export const accountSignature=accounts=>JSON.stringify(accounts.map(a=>JSON.stringify([a.source_key,a.currency,a.identity_scope || 'bank'])).sort());
const sameAccount=(left,right)=>left.source_key===right.source_key && left.currency===right.currency;

// A remembered selection is only a hint among proven memberships. Never attach
// a previously unseen account to the last login just because its bank matches.
export function resolveProfile(connections,observed,preferred) {
  if(!observed.length)return null;
  const candidates=connections.filter(c=>observed.every(a=>c.accounts.some(b=>sameAccount(a,b))));
  return candidates.find(c=>c.profile_key===preferred) || (candidates.length===1?candidates[0]:null);
}
export function canAttach(connections,selected,observed) {
  return observed.every(a=>selected.accounts.some(b=>sameAccount(a,b)) ||
    !connections.some(c=>c.accounts.some(b=>sameAccount(a,b))));
}
