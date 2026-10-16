import {parseVietinBankJson} from './legacy-parser.js';
import {SyncError} from '../../backend-client.js';

export const bankOrigin = 'https://ipay.vietinbank.vn';
export function historyAccount(value) {
  try {
    const url = new URL(value), account = url.searchParams.get('accountNo');
    return url.origin === bankOrigin && url.pathname === '/payment-history' && /^\d{6,30}$/.test(account || '') ? account : null;
  } catch { return null; }
}

// Preserve the historical vib:id and vib:f1 algorithm byte for byte. In
// particular f1 hashes signed, safe integer VND values, not the new wire DTO.
export async function parsePage(data, {account, period, page = 0, total, size, seen = []}) {
  const fail = code => { throw new SyncError(code); };
  if (data?.error !== false || data.accountNo !== account) fail('capture_context_changed');
  if (data.currentPage !== page || !Number.isSafeInteger(data.pageSize) || data.pageSize < 1 || data.pageSize > 500 ||
      !Number.isSafeInteger(data.totalRecords) || data.totalRecords < 0 || data.totalRecords > 100000 || !Array.isArray(data.transactions)) fail('history_incomplete');
  if (page === 0) { total = data.totalRecords; size = data.pageSize; }
  // Observed VietinBank continuation pages report zero instead of the total.
  if (size !== data.pageSize || (data.totalRecords !== 0 && data.totalRecords !== total)) fail('history_incomplete');
  if (total === 0) {
    if (page !== 0 || data.transactions.length) fail('history_incomplete');
    return {records: [], total: 0, size, totalPages: 1, ids: []};
  }
  let parsed;
  try { parsed = await parseVietinBankJson({...data, totalRecords: total}); }
  catch { fail('history_incomplete'); }
  const ids = new Set(seen);
  const records = parsed.transactions.map(row => {
    if (row.date < period.start || row.date > period.end || ids.has(row.external_id)) fail('history_incomplete');
    ids.add(row.external_id);
    const raw = row.raw, details = Object.fromEntries(Object.entries(raw.details).filter(([, value]) => value !== null));
    return {
      external_id: row.external_id, identity_kind: raw.reference_kind,
      identity_version: raw.reference_kind === 'bank' ? 'trxId' : 'f1',
      occurred_at: row.date + 'T' + raw.date.slice(11) + '+07:00', local_date: row.date,
      direction: row.amount_minor < 0 ? 'expense' : 'income', amount: String(Math.abs(row.amount_minor)),
      currency: 'VND', description: row.description,
      beneficiary_account: details.corresponsiveAccount || null, beneficiary_name: details.corresponsiveName || null,
      balance: String(raw.balance === null ? '' : Number(raw.balance)), details_state: 'complete', details,
    };
  });
  return {records, total, size, totalPages: Math.ceil(total / size), ids: records.map(row => row.external_id)};
}
