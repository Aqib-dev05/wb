// Single place that knows where the backend lives.
//
// VITE_API_URL = origin of the API server, e.g. "https://api.example.com" (no trailing slash,
// no "/api" suffix). Leave it empty to use the same origin as the page: in development the Vite
// proxy forwards /api and /socket.io to the server, and in production a reverse proxy can do
// the same. Vite inlines VITE_* values at build time, so changing it needs a rebuild.
//
// `import.meta.env` is optional-chained so this file can also be imported by `node --test`.
const raw = (import.meta.env?.VITE_API_URL ?? '').trim();

export const API_ORIGIN = raw.replace(/\/+$/, '');
export const API_BASE = `${API_ORIGIN}/api`;
/** First argument for socket.io-client's `io()`; undefined = same origin as the page. */
export const SOCKET_URL = API_ORIGIN || undefined;
