export class SyncError extends Error {
  constructor(code, retryable = false) { super(code); this.code = code; this.retryable = retryable; }
}

export function serverAddress(value) {
  let url;
  try { url = new URL(value.trim()); } catch { throw new SyncError('invalid_server'); }
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname) ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) {
    throw new SyncError('invalid_server');
  }
  return url.origin;
}

export function permissionOrigin(url) { return new URL(serverAddress(url)).origin + '/*'; }

export class Backend {
  constructor(config, fetcher = fetch) { this.url = serverAddress(config.url); this.token = config.token; this.fetcher = fetcher; }
  async request(path, method = 'GET', body) {
    if (!this.token) throw new SyncError('unauthorized');
    let response;
    try {
      response = await this.fetcher(this.url + '/api/v1' + path, {
        method, headers: {Authorization: 'Bearer ' + this.token, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
      });
    } catch { throw new SyncError('backend_unavailable', true); }
    let result;
    try { result = await response.json(); } catch { throw new SyncError('invalid_response', true); }
    if (!response.ok) throw new SyncError(result?.error?.code || 'backend_error', result?.error?.retryable === true);
    return result;
  }
  async info() {
    const info = await this.request('/info');
    if (info.api_version !== 1) throw new SyncError('unsupported_api_version');
    return info;
  }
}
