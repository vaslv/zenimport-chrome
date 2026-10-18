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

// The first payment account observed in an overview anchors a new connection.
// Existing membership takes precedence so reordered/new cards retain its ID.
export function automaticProfile(connections,observed,primaryAccount) {
  const primary=observed.find(a=>a.source_key===primaryAccount) || observed[0];
  primaryAccount=primary?.source_key;
  if(!primary)return null;
  const candidates=connections.filter(c=>c.accounts.some(a=>observed.some(b=>sameAccount(a,b))));
  if(candidates.length===1)return candidates[0];
  if(candidates.length>1) {
    const anchored=candidates.filter(c=>c.accounts.some(a=>sameAccount(a,primary)));
    if(anchored.length)return anchored.find(c=>c.profile_key==='account-v1:'+primaryAccount) || [...anchored].sort((a,b)=>a.profile_key.localeCompare(b.profile_key))[0];
  }
  return connections.find(c=>c.profile_key==='account-v1:'+primaryAccount) ||
    {profile_key:'account-v1:'+primaryAccount,profile_identity:'bank'};
}
