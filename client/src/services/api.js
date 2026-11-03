// Minimal fetch client. The access token lives in memory only; the refresh token is an
// httpOnly cookie the browser sends automatically. Expired access tokens are refreshed once,
// transparently, and concurrent requests share a single refresh call.

import { API_BASE } from '../config.js';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let accessToken = null;
let refreshPromise = null;
let onSessionLost = () => {};

export const setAccessToken = (token) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;
export const setSessionLostHandler = (fn) => {
  onSessionLost = fn;
};

async function send(path, { method = 'GET', body, query } = {}) {
  const qs = query
    ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== '' && v !== null)).toString()
    : '';
  let res;
  try {
    res = await fetch(`${API_BASE}${path}${qs}`, {
      method,
      credentials: 'include',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.');
  }

  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok || !json?.success) {
    const e = json?.error;
    throw new ApiError(res.status, e?.code || 'UNKNOWN', e?.message || `Request failed (${res.status})`, e?.details);
  }
  return json;
}

export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = send('/auth/refresh', { method: 'POST' })
      .then((json) => {
        accessToken = json.data.accessToken;
        return json.data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

/** Returns the `data` payload; pass `{ withMeta: true }` to get `{ data, meta }`. */
export async function request(path, options = {}) {
  try {
    const json = await send(path, options);
    return options.withMeta ? { data: json.data, meta: json.meta } : json.data;
  } catch (err) {
    const canRetry = err.status === 401 && err.code === 'TOKEN_EXPIRED' && !path.startsWith('/auth/');
    if (!canRetry) throw err;
    try {
      await refreshSession();
    } catch {
      setAccessToken(null);
      onSessionLost();
      throw err;
    }
    const json = await send(path, options);
    return options.withMeta ? { data: json.data, meta: json.meta } : json.data;
  }
}
