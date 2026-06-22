/**
 * api.js — fetch wrapper with 401 → refresh → retry logic
 * Never sends Authorization header; relies on session cookies.
 */

const BASE = '';

async function request(method, path, body, opts = {}) {
  const options = {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  if (opts.responseType === 'blob') {
    delete options.headers['Content-Type'];
  }

  if (opts.keepalive) options.keepalive = true;
  let res = await fetch(BASE + path, options);

  // 401 → try to refresh, then retry once
  if (res.status === 401 && !opts._retry) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return request(method, path, body, { ...opts, _retry: true });
    } else {
      window.location.href = '/auth?session_expired=1';
      // Return a never-resolving Promise to suspend caller execution
      // and prevent TypeErrors while the browser navigates.
      return new Promise(() => { });
    }
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const d = await res.json(); detail = d.detail || detail; } catch (_) { }
    throw new ApiError(detail, res.status);
  }

  if (opts.responseType === 'blob') return res.blob();
  if (res.status === 204) return null;
  return res.json();
}

let refreshPromise = null;

async function tryRefresh() {
  // Dedupe concurrent 401s: share one in-flight refresh so racing requests
  // don't fire parallel /auth/refresh calls and clobber each other's rotated token.
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch('/auth/refresh', {
          method: 'POST',
          credentials: 'same-origin',
        });
        return res.ok;
      } catch (_) {
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

export const api = {
  get: (path, opts) => request('GET', path, undefined, opts),
  post: (path, body, opts) => request('POST', path, body, opts || {}),
  put: (path, body, opts) => request('PUT', path, body, opts || {}),
  patch: (path, body, opts) => request('PATCH', path, body, opts || {}),
  delete: (path, body, opts) => request('DELETE', path, body, opts || {}),
  blob: (path) => request('GET', path, undefined, { responseType: 'blob' }),
};
